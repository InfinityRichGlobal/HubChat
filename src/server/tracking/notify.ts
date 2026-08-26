import 'server-only';
/**
 * แจ้งลูกค้าว่าจัดส่งแล้ว (รอบ 8 — สเปกหัวข้อ 5.8)
 * ===========================================================================
 * 🔴 นี่คือจุดที่สองในระบบที่ "ส่งข้อความหาลูกค้าโดยไม่มีคนพิมพ์เอง"
 *    (จุดแรกคือบอทคีย์เวิร์ด src/server/autoreply/runner.ts)
 *    กฎเหล็กเหมือนกันทุกข้อ และเข้มกว่าเพราะเป็นการส่งทีละหลายร้อยคน :
 *
 *   1. ยิง Meta เองไม่ได้ — ผ่าน sendMessage() เท่านั้น
 *      Policy Engine เป็นคนตัดสินว่าส่งได้ไหม ไม่ใช่ไฟล์นี้
 *
 *   2. ใช้ bulkJobProvenance() ซึ่ง human_authored = false เสมอ
 *      → HUMAN_AGENT ถูกตัดออกโดยอัตโนมัติ
 *      → ถึงแอดมินจะกดยืนยันเอง ก็ไม่ใช่ "คนพิมพ์ข้อความนี้"
 *
 *   3. ⭐ จองสิทธิ์กับฐานข้อมูลก่อนส่งเสมอ
 *      unique (order_id, event) + claim → หนึ่งออเดอร์แจ้งได้ครั้งเดียวตลอดกาล
 *
 *   4. ⚠️ "ไม่ทราบผล" ห้ามลองใหม่อัตโนมัติเด็ดขาด
 *      และต้องถือว่า "แจ้งไปแล้ว" เพื่อไม่ให้รอบไหนหยิบไปส่งซ้ำ
 *
 *   5. ⭐ ทยอยส่ง ไม่กระแทก Meta พร้อมกัน
 *      ส่งทีละข้อความ เว้นจังหวะตามโควตา — ยิงรัวคือทางลัดสู่การโดนจำกัดทั้งเพจ
 *
 *   6. เนื้อข้อความประกอบที่นี่ ฝั่งเบราว์เซอร์กำหนดไม่ได้
 */
import { db } from '@/lib/supabase/admin';
import { sendMessage } from '@/server/messaging/send-message';
import { bulkJobProvenance } from '@/server/messaging/provenance';
import { buildTrackingMessage } from './message';

/** สเปก 5.8 : ทยอยส่ง 10 ข้อความ/นาที */
export const DEFAULT_RATE_PER_MINUTE = 10;

/** ช่วงเวลาที่ไม่รบกวนลูกค้า (สเปก 5.8 : quiet hours 22:00-08:00) */
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 8;

/**
 * เพดานต่อการกดหนึ่งครั้ง
 *
 * 🔴 ต้องคำนวณจาก "เวลาที่คำขอมีให้" ไม่ใช่ตั้งเลขสวย ๆ
 *    เดิมตั้งไว้ 60 : 59 ช่อง × 6 วินาที = 354 วินาที
 *    แต่ route ตั้ง maxDuration = 300 → คำขอถูกตัดกลางทางทุกครั้ง
 *    เจ้าของร้านจะเห็น "ติดต่อเซิร์ฟเวอร์ไม่ได้" แทนสรุปผล
 *    และงานที่กำลังส่งอยู่จะค้างสถานะ claimed
 *
 *    40 ช่อง × 6 วินาที = 234 วินาที ซึ่งเหลือที่ให้การส่งจริงและการจดผล
 */
export const MAX_PER_RUN = 40;

/**
 * ⏱️ เพดานเวลาต่อรอบ — ตาข่ายชั้นสองที่ไม่ขึ้นกับความเร็วที่ตั้งไว้
 *    ถ้า Meta ตอบช้ากว่าปกติ ตัวนับช่องอย่างเดียวยังไม่พอ
 *    ครบเวลาแล้วต้องหยุดแล้วคืน remaining ไปให้กดต่อ ดีกว่าถูกตัดกลางทาง
 */
export const RUN_BUDGET_MS = 240_000;

/** งานที่ค้างสถานะ "กำลังส่ง" นานเกินนี้ ถือว่าไม่ทราบผล */
export const STALE_CLAIM_SECONDS = 600;

export type NotifyRunSummary = {
  attempted: number;
  sent: number;
  blocked: number;
  failed: number;
  unknown: number;
  skipped: number;
  /** ยังเหลือในคิวอีกไหม — หน้าเว็บใช้ตัดสินว่าจะกด "ส่งต่อ" ไหม */
  remaining: number;
  quiet_hours: boolean;
};

const EMPTY: NotifyRunSummary = {
  attempted: 0, sent: 0, blocked: 0, failed: 0, unknown: 0, skipped: 0,
  remaining: 0, quiet_hours: false,
};

/**
 * ตอนนี้อยู่ในช่วงเวลาห้ามรบกวนไหม
 * ⚠️ ใช้เวลาไทยเสมอ ไม่ใช่เวลาเซิร์ฟเวอร์ — เซิร์ฟเวอร์อาจอยู่คนละโซน
 */
export function isQuietHours(now: Date, tz = 'Asia/Bangkok'): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(now),
  );
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

type QueueRow = {
  id: string;
  order_id: string;
  conversation_id: string | null;
  payload: {
    order_no?: string;
    recipient?: string | null;
    tracking_no?: string;
    carrier?: string | null;
  };
};

async function finish(
  notificationId: string,
  status: 'sent' | 'blocked' | 'failed' | 'unknown' | 'skipped',
  fields: {
    message_text?: string | null;
    reason_code?: string | null;
    reason_th?: string | null;
    transport?: string | null;
    message_send_id?: string | null;
    meta_message_id?: string | null;
    fbtrace_id?: string | null;
    outcome_unknown?: boolean;
    error_text?: string | null;
  },
): Promise<void> {
  const { error } = await db().rpc('finish_fulfillment_notification', {
    p_notification_id: notificationId,
    p_status: status,
    p_message_text: fields.message_text ?? null,
    p_reason_code: fields.reason_code ?? null,
    p_reason_th: fields.reason_th ?? null,
    p_transport: fields.transport ?? null,
    p_message_send_id: fields.message_send_id ?? null,
    p_meta_message_id: fields.meta_message_id ?? null,
    p_fbtrace_id: fields.fbtrace_id ?? null,
    p_outcome_unknown: fields.outcome_unknown ?? false,
    p_error_text: fields.error_text ?? null,
  });
  // ⚠️ จดผลไม่ได้ = ต้องเห็นในล็อก แต่ห้ามโยนต่อ เพราะข้อความอาจส่งไปแล้ว
  //    ถ้าโยน ผู้เรียกอาจตีความว่าล้มเหลวแล้วสั่งส่งใหม่
  if (error) {
    console.error(`[tracking-notify] จดผลไม่สำเร็จ (notification=${notificationId}): ${error.message}`);
  }
}

/**
 * เก็บกวาดงานที่ค้างสถานะ "กำลังส่ง"
 * ⚠️ ยกให้เป็น "ไม่ทราบผล" ไม่ใช่ดึงกลับมาส่งใหม่ — ดูเหตุผลเต็มใน migration 0011
 */
async function sweepStaleClaims(): Promise<void> {
  const { data, error } = await db().rpc('expire_stale_notification_claims', {
    p_older_than_seconds: STALE_CLAIM_SECONDS,
  });
  if (error) {
    console.error(`[tracking-notify] เก็บกวาดงานค้างไม่สำเร็จ: ${error.message}`);
    return;
  }
  const n = typeof data === 'number' ? data : 0;
  if (n > 0) {
    console.warn(`[tracking-notify] ⚠️ ยกงานที่ค้างกลางทาง ${n} รายการเป็น "ไม่ทราบผล"`);
  }
}

export type RunOptions = {
  /** จำกัดจำนวนต่อการกดหนึ่งครั้ง */
  limit?: number;
  ratePerMinute?: number;
  /** ฉีดเวลาเข้ามาเพื่อทดสอบ quiet hours ได้ */
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
  /** ข้ามด่านเวลาห้ามรบกวน — ใช้เฉพาะตอนแอดมินยืนยันว่าจะส่งเดี๋ยวนี้จริง ๆ */
  ignoreQuietHours?: boolean;
  /** เพดานเวลาต่อรอบ (มิลลิวินาที) — ครบแล้วหยุดแล้วคืน remaining ให้กดต่อ */
  budgetMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * ส่งคิวแจ้งเลขพัสดุของรอบนำเข้าหนึ่งรอบ
 *
 * @param importId ถ้าไม่ส่งมา = ส่งทุกงานที่ค้างคิวอยู่ (ใช้กับ scheduler ในอนาคต)
 */
export async function runNotificationQueue(
  approvedByAdminId: string | null,
  importId: string | null,
  options: RunOptions = {},
): Promise<NotifyRunSummary> {
  const now = options.now ?? new Date();
  const summary: NotifyRunSummary = { ...EMPTY };

  if (!options.ignoreQuietHours && isQuietHours(now)) {
    // ⭐ ไม่ใช่ความผิดพลาด — คิวยังอยู่ครบ ไว้ส่งตอนเช้า
    summary.quiet_hours = true;
    summary.remaining = await countQueued(importId);
    return summary;
  }

  // ⭐ เก็บกวาดงานค้างก่อนเสมอ ไม่งั้นจะมีแถวที่ไม่มีวันถูกหยิบอีกเลย
  await sweepStaleClaims();

  const limit = Math.min(Math.max(options.limit ?? MAX_PER_RUN, 1), MAX_PER_RUN);
  const rate = Math.max(1, options.ratePerMinute ?? DEFAULT_RATE_PER_MINUTE);
  const gapMs = Math.ceil(60_000 / rate);
  const sleep = options.sleep ?? defaultSleep;

  let query = db()
    .from('fulfillment_notifications')
    .select('id,order_id,conversation_id,payload')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (importId) query = query.eq('import_id', importId);

  const { data, error } = await query;
  if (error) throw new Error(`อ่านคิวแจ้งเลขพัสดุไม่สำเร็จ: ${error.message}`);

  await processJobs((data ?? []) as QueueRow[], approvedByAdminId, summary, gapMs, sleep, options.budgetMs);

  // อัปเดตตัวนับบนรอบนำเข้า ให้หน้าเว็บอ่านย้อนหลังได้โดยไม่ต้องนับเอง
  if (importId) await refreshImportCounters(importId);

  summary.remaining = await countQueued(importId);
  return summary;
}

/**
 * ส่งงานที่ระบุมาเป็นรายชิ้น — ใช้ตอนแจ้งออเดอร์ใบเดียวจากหน้าออเดอร์
 * ⭐ ใช้ตัวประมวลผลตัวเดียวกับงานเป็นชุด จึงไม่มี "เส้นทางส่งเส้นที่สอง" ให้ดูแล
 */
export async function runNotificationQueueForIds(
  ids: string[],
  approvedByAdminId: string | null,
  options: RunOptions = {},
): Promise<NotifyRunSummary> {
  const summary: NotifyRunSummary = { ...EMPTY };
  if (ids.length === 0) return summary;

  const now = options.now ?? new Date();
  if (!options.ignoreQuietHours && isQuietHours(now)) {
    summary.quiet_hours = true;
    summary.remaining = ids.length;
    return summary;
  }

  const rate = Math.max(1, options.ratePerMinute ?? DEFAULT_RATE_PER_MINUTE);
  const gapMs = Math.ceil(60_000 / rate);
  const sleep = options.sleep ?? defaultSleep;

  const { data } = await db()
    .from('fulfillment_notifications')
    .select('id,order_id,conversation_id,payload')
    .in('id', ids.slice(0, MAX_PER_RUN))
    .eq('status', 'queued');

  const jobs = (data ?? []) as QueueRow[];
  await processJobs(jobs, approvedByAdminId, summary, gapMs, sleep, options.budgetMs);
  // ตัวนับของรอบนำเข้าให้ผู้เรียกเป็นคนสั่งอัปเดต (รู้ดีกว่าว่าเกี่ยวกับรอบไหน)
  return summary;
}

/** ตัวประมวลผลจริง — ที่เดียวในระบบที่แปลง "งานในคิว" เป็น "การส่งข้อความ" */
async function processJobs(
  queue: QueueRow[],
  approvedByAdminId: string | null,
  summary: NotifyRunSummary,
  gapMs: number,
  sleep: (ms: number) => Promise<void>,
  budgetMs = RUN_BUDGET_MS,
): Promise<void> {
  const startedAt = Date.now();

  for (let i = 0; i < queue.length; i += 1) {
    const job = queue[i];

    /**
     * ⏱️ ครบเวลาที่คำขอนี้มีให้ → หยุดตรงนี้แล้วคืนที่เหลือให้กดต่อ
     *    ดีกว่าถูกเซิร์ฟเวอร์ตัดกลางทาง ซึ่งจะทำให้งานที่กำลังส่งค้างสถานะ
     */
    if (i > 0 && Date.now() - startedAt + gapMs > budgetMs) {
      console.log(`[tracking-notify] ครบเวลาต่อรอบแล้ว หยุดที่ ${i}/${queue.length} — กดส่งต่อได้`);
      break;
    }

    /**
     * ⭐ เว้นจังหวะ "ก่อน" ยิงตัวถัดไป ไม่ใช่หลัง
     *    ตัวแรกจึงออกทันที และตัวที่ 2 เป็นต้นไปถึงจะรอ
     *    (ถ้ารอหลังยิงตัวสุดท้าย จะเสียเวลาเปล่าโดยไม่ได้อะไร)
     */
    if (i > 0) await sleep(gapMs);

    summary.attempted += 1;

    // ---- จองสิทธิ์ก่อนเสมอ ----
    const { data: claimData, error: claimErr } = await db().rpc('claim_fulfillment_notification', {
      p_notification_id: job.id,
    });
    if (claimErr) {
      summary.failed += 1;
      console.error(`[tracking-notify] จองสิทธิ์ไม่สำเร็จ (${job.id}): ${claimErr.message}`);
      continue;
    }
    const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as
      | { won: boolean }
      | undefined;
    if (!claim?.won) {
      // มีคนอื่นถือสิทธิ์อยู่ หรือทำไปแล้ว — ไม่ใช่ความผิดพลาด
      summary.skipped += 1;
      continue;
    }

    // ---- ต้องมีห้องแชท ไม่งั้นส่งหาใครไม่ได้ ----
    if (!job.conversation_id) {
      await finish(job.id, 'skipped', {
        reason_th: 'ออเดอร์ใบนี้ไม่ได้ผูกกับห้องแชท จึงส่งข้อความหาลูกค้าไม่ได้',
      });
      summary.skipped += 1;
      continue;
    }

    /**
     * 🔴 อ่านค่าจริงของออเดอร์ "ตอนจะส่ง" เสมอ — ห้ามเชื่อสำเนาในคิว
     *
     *    สำเนาใน payload ถูกถ่ายไว้ตอนเข้าคิว ซึ่งอาจเก่าไปแล้ว :
     *      • ไฟล์เดียวมีสองแถวชี้ออเดอร์เดียวกัน (ของหลายกล่อง)
     *        แถวหลังทับเลขพัสดุ แต่คิวยังถือเลขของแถวแรกอยู่
     *      • แอดมินเห็นว่าเลขผิด แล้วแก้เองในหน้าออเดอร์ก่อนกดส่ง
     *
     *    ทั้งสองกรณีถ้าเชื่อสำเนา ลูกค้าจะได้ "เลขพัสดุของพัสดุอีกกล่อง"
     *    ซึ่งเป็นความผิดพลาดที่แก้ไม่ได้และเสียความเชื่อถือที่สุด
     */
    const { data: liveData } = await db()
      .from('orders')
      .select('order_no,recipient_name,tracking_no,shipping_carrier,status')
      .eq('id', job.order_id)
      .maybeSingle();

    const live = liveData as {
      order_no: string;
      recipient_name: string | null;
      tracking_no: string | null;
      shipping_carrier: string | null;
      status: string;
    } | null;

    if (!live) {
      await finish(job.id, 'skipped', { reason_th: 'ไม่พบออเดอร์ของงานแจ้งนี้แล้ว' });
      summary.skipped += 1;
      continue;
    }

    if (!live.tracking_no) {
      await finish(job.id, 'skipped', {
        reason_th: 'ตอนนี้ออเดอร์ไม่มีเลขพัสดุแล้ว จึงไม่แจ้งลูกค้า',
      });
      summary.skipped += 1;
      continue;
    }

    if (live.status === 'cancelled' || live.status === 'returned') {
      await finish(job.id, 'skipped', {
        reason_th: 'ออเดอร์ถูกยกเลิก/ตีกลับหลังเข้าคิวแล้ว จึงไม่แจ้งจัดส่ง',
      });
      summary.skipped += 1;
      continue;
    }

    // จดไว้ให้เห็นชัดว่าเลขเปลี่ยนไปจากตอนเข้าคิว (ตรวจย้อนหลังได้)
    const queuedTracking = job.payload?.tracking_no;
    if (queuedTracking && queuedTracking !== live.tracking_no) {
      console.warn(
        `[tracking-notify] เลขพัสดุเปลี่ยนหลังเข้าคิว (order=${job.order_id}) ` +
          `${queuedTracking} → ${live.tracking_no} — ใช้ค่าล่าสุดในการแจ้ง`,
      );
    }

    // ⭐ ข้อความประกอบฝั่งเซิร์ฟเวอร์ทั้งหมด จากค่าจริงล่าสุด
    const text = buildTrackingMessage({
      order_no: live.order_no,
      recipient: live.recipient_name,
      tracking_no: live.tracking_no,
      carrier: live.shipping_carrier,
    });

    try {
      const result = await sendMessage(
        {
          conversation_id: job.conversation_id,
          // ⭐ มาจากบริบท ไม่ได้เดาจากเนื้อข้อความ
          message_type: 'shipping_update',
          provenance: bulkJobProvenance(approvedByAdminId),
          content: { text },
          // กุญแจกันซ้ำผูกกับ "งานแจ้งชิ้นนี้" ไม่ใช่เวลาปัจจุบัน
          idempotency_key: `fulfillment:${job.id}`,
        },
        // ⚠️ งานเป็นชุด : ลองครั้งเดียวพอ
        //    ลูกค้าไม่ได้รออยู่ และการลองซ้ำเพิ่มโอกาสส่งซ้ำ
        { maxRetries: 1 },
      );

      if (result.sent) {
        await finish(job.id, 'sent', {
          message_text: text,
          reason_code: result.reason_code,
          reason_th: result.reason_th,
          transport: result.decision.transport ?? null,
          message_send_id: result.message_send_id,
          meta_message_id: result.meta_message_id,
          fbtrace_id: result.fbtrace_id,
        });
        summary.sent += 1;
        continue;
      }

      if (result.outcome_unknown) {
        // 🔴 ยิงไปแล้วไม่รู้ผล — จดว่า unknown แล้วหยุด
        //    finish_fulfillment_notification จะตั้ง tracking_notified_at ให้ด้วย
        //    เพื่อไม่ให้รอบไหนหยิบไปส่งซ้ำ (ยอมส่งขาด ดีกว่าส่งซ้ำ)
        await finish(job.id, 'unknown', {
          message_text: text,
          reason_code: result.reason_code,
          reason_th: result.reason_th,
          transport: result.decision.transport ?? null,
          message_send_id: result.message_send_id,
          fbtrace_id: result.fbtrace_id,
          outcome_unknown: true,
        });
        summary.unknown += 1;
        console.warn(
          `[tracking-notify] ⚠️ ไม่ทราบผลการส่ง (notification=${job.id} order=${job.order_id}) — ไม่ลองใหม่โดยตั้งใจ`,
        );
        continue;
      }

      // Policy Engine ไม่อนุญาต = พฤติกรรมปกติ ไม่ใช่ความผิดพลาด
      // ⭐ ห้ามฝืนส่ง ต้องจดว่า "ยังไม่ได้แจ้ง" แล้วให้แอดมินตามเอง
      await finish(job.id, 'blocked', {
        message_text: text,
        reason_code: result.reason_code,
        reason_th: result.reason_th,
        transport: result.decision.transport ?? null,
      });
      summary.blocked += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await finish(job.id, 'failed', { message_text: text, error_text: message });
      summary.failed += 1;
      console.error(`[tracking-notify] ส่งไม่สำเร็จ (notification=${job.id}): ${message}`);
    }
  }
}

async function countQueued(importId: string | null): Promise<number> {
  let q = db()
    .from('fulfillment_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'queued');
  if (importId) q = q.eq('import_id', importId);
  const { count } = await q;
  return count ?? 0;
}

async function refreshImportCounters(importId: string): Promise<void> {
  const { data } = await db()
    .from('fulfillment_notifications')
    .select('status')
    .eq('import_id', importId)
    .limit(5000);

  const rows = (data ?? []) as Array<{ status: string }>;
  const notified = rows.filter((r) => r.status === 'sent' || r.status === 'unknown').length;
  const blocked = rows.filter((r) => r.status === 'blocked').length;

  await db()
    .from('tracking_imports')
    .update({ notified_count: notified, blocked_count: blocked })
    .eq('id', importId);
}

/* ------------------------------------------------------------------------ */
/* แจ้งลูกค้าทีละใบ (ใช้จากหน้าออเดอร์)                                          */
/* ------------------------------------------------------------------------ */

export const BASE_EVENT = 'shipping_update';

export class NotifyRefusedError extends Error {
  constructor(public message_th: string, public code: string) {
    super(message_th);
    this.name = 'NotifyRefusedError';
  }
}

export type RequestNotifyInput = {
  order_id: string;
  admin_id: string;
  /** เจ้าของร้านเท่านั้นที่ส่งซ้ำได้ */
  is_owner: boolean;
  /**
   * 🔴 ยอมรับความเสี่ยงว่าลูกค้าอาจได้ข้อความสองครั้ง
   *    ต้องเป็น true เท่านั้นถึงจะส่งซ้ำทับของที่ 'sent' หรือ 'unknown' ได้
   */
  acknowledged_duplicate_risk?: boolean;
};

/**
 * ขอแจ้งลูกค้าสำหรับออเดอร์ใบเดียว
 *
 * 🔴 นี่คือส่วนที่ออกแบบมาเฉพาะทางตามข้อกำหนด "ห้ามมีปุ่ม retry ง่าย ๆ" :
 *
 *   สถานะเดิม            | กดแจ้งอีกครั้งได้ไหม
 *   --------------------|--------------------------------------------------
 *   ยังไม่เคยแจ้ง        | ได้ (เข้าคิวปกติ)
 *   queued / claimed    | ไม่ต้อง — มีคิวอยู่แล้ว
 *   blocked / failed    | ได้ เพราะ "รู้แน่ว่าไม่ถึงลูกค้า"
 *   skipped             | ได้
 *   sent                | ต้องเป็นเจ้าของร้าน + ติ๊กยอมรับความเสี่ยงซ้ำ
 *   unknown             | ⚠️ เหมือน sent — เพราะข้อความอาจถึงลูกค้าไปแล้ว
 *                       |    ต้องไปเปิด Messenger ดูก่อนเสมอ
 *
 * การส่งซ้ำจะสร้าง "เหตุการณ์ใหม่" (shipping_update#2, #3 …) ไม่ใช่ทับของเดิม
 * เพื่อให้ประวัติการส่งทุกครั้งยังอยู่ครบ ตรวจย้อนหลังได้
 */
export async function requestOrderNotification(
  input: RequestNotifyInput,
): Promise<{ notification_id: string; event: string; created: boolean }> {
  const { data: orderData } = await db()
    .from('orders')
    .select('id,order_no,recipient_name,tracking_no,shipping_carrier,conversation_id,status')
    .eq('id', input.order_id)
    .maybeSingle();

  if (!orderData) throw new NotifyRefusedError('ไม่พบออเดอร์นี้', 'not_found');
  const order = orderData as {
    id: string; order_no: string; recipient_name: string | null;
    tracking_no: string | null; shipping_carrier: string | null;
    conversation_id: string | null; status: string;
  };

  if (!order.tracking_no) {
    throw new NotifyRefusedError('ออเดอร์นี้ยังไม่มีเลขพัสดุ จึงยังแจ้งลูกค้าไม่ได้', 'no_tracking');
  }
  if (!order.conversation_id) {
    throw new NotifyRefusedError('ออเดอร์นี้ไม่ได้ผูกกับห้องแชท จึงส่งข้อความหาลูกค้าไม่ได้', 'no_conversation');
  }
  if (order.status === 'cancelled' || order.status === 'returned') {
    throw new NotifyRefusedError('ออเดอร์ถูกยกเลิก/ตีกลับแล้ว ไม่ควรแจ้งจัดส่ง', 'closed');
  }

  const existing = await getOrderNotifications(order.id);
  const live = existing.filter((n) => n.status !== 'skipped');

  const pending = live.find((n) => n.status === 'queued' || n.status === 'claimed');
  if (pending) {
    /**
     * ⚠️ ค้างที่ 'claimed' นานผิดปกติ = โปรเซสที่ถือสิทธิ์ตายไปแล้ว
     *    เก็บกวาดก่อน (ยกเป็น "ไม่ทราบผล") แล้วค่อยตัดสินใหม่
     *    ไม่งั้นออเดอร์นั้นจะค้าง "กำลังส่ง" ตลอดกาลโดยไม่มีทางออก
     */
    if (pending.status === 'claimed') {
      await sweepStaleClaims();
      const after = await getOrderNotifications(order.id);
      const stillPending = after.find((n) => n.status === 'queued' || n.status === 'claimed');
      if (stillPending) {
        return { notification_id: stillPending.id, event: stillPending.event, created: false };
      }
      // ถูกยกเป็น unknown แล้ว → ตกไปเข้าเส้นทาง "ต้องติ๊กยอมรับความเสี่ยง" ข้างล่าง
      return requestOrderNotification(input);
    }
    return { notification_id: pending.id, event: pending.event, created: false };
  }

  const risky = live.filter((n) => n.status === 'sent' || n.status === 'unknown');
  if (risky.length > 0) {
    if (!input.is_owner) {
      throw new NotifyRefusedError(
        'ออเดอร์นี้เคยแจ้งไปแล้ว — ส่งซ้ำได้เฉพาะเจ้าของร้านเท่านั้น',
        'already_notified',
      );
    }
    if (!input.acknowledged_duplicate_risk) {
      const unknown = risky.some((n) => n.status === 'unknown');
      throw new NotifyRefusedError(
        unknown
          ? '⚠️ ครั้งก่อนยิงออกไปแล้วแต่ไม่ทราบผล — ข้อความอาจถึงลูกค้าไปแล้ว ' +
            'ให้เปิด Messenger ดูก่อน แล้วค่อยติ๊กยืนยันว่ายอมรับความเสี่ยงที่ลูกค้าอาจได้ซ้ำ'
          : 'ออเดอร์นี้แจ้งลูกค้าไปแล้ว — ถ้าจะส่งซ้ำต้องติ๊กยืนยันว่ายอมรับความเสี่ยงที่ลูกค้าจะได้ข้อความสองครั้ง',
        unknown ? 'outcome_unknown' : 'already_sent',
      );
    }
  }

  // เหตุการณ์ใหม่ = ประวัติเดิมไม่หาย
  const event = existing.length === 0 ? BASE_EVENT : `${BASE_EVENT}#${existing.length + 1}`;

  const { data, error } = await db().rpc('queue_fulfillment_notification', {
    p_order_id: order.id,
    p_event: event,
    p_import_id: null,
    p_import_row_id: null,
    p_payload: {
      order_no: order.order_no,
      recipient: order.recipient_name,
      tracking_no: order.tracking_no,
      carrier: order.shipping_carrier,
    },
    p_admin_id: input.admin_id,
  });
  if (error) throw new Error(`เข้าคิวแจ้งลูกค้าไม่สำเร็จ: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { notification_id: string; created: boolean }
    | undefined;
  if (!row?.notification_id) throw new Error('ฐานข้อมูลไม่ได้คืนผลการเข้าคิวกลับมา');

  return { notification_id: row.notification_id, event, created: row.created };
}

/** ส่งงานแจ้งชิ้นเดียวทันที (ใช้ต่อจาก requestOrderNotification) */
export async function runSingleNotification(
  notificationId: string,
  approvedByAdminId: string | null,
  options: RunOptions = {},
): Promise<NotifyRunSummary> {
  const summary: NotifyRunSummary = { ...EMPTY };
  const now = options.now ?? new Date();

  if (!options.ignoreQuietHours && isQuietHours(now)) {
    summary.quiet_hours = true;
    summary.remaining = 1;
    return summary;
  }

  const { data } = await db()
    .from('fulfillment_notifications')
    .select('id,import_id,status')
    .eq('id', notificationId)
    .maybeSingle();

  const row = data as { id: string; import_id: string | null; status: string } | null;
  if (!row || row.status !== 'queued') {
    // ไม่ใช่ความผิดพลาด — อาจมีคนอื่นส่งไปแล้ว หรือถูกจองสิทธิ์อยู่
    summary.skipped = 1;
    return summary;
  }

  // ใช้ตัวรันตัวเดียวกับงานเป็นชุด เพื่อไม่ให้มี "เส้นทางส่งเส้นที่สอง"
  const result = await runNotificationQueueForIds([notificationId], approvedByAdminId, options);
  if (row.import_id) await refreshImportCounters(row.import_id);
  return result;
}

/* ------------------------------------------------------------------------ */
/* อ่านสถานะการแจ้ง (ใช้ในหน้าออเดอร์)                                          */
/* ------------------------------------------------------------------------ */

export type NotificationView = {
  id: string;
  order_id: string;
  event: string;
  status: string;
  message_text: string | null;
  policy_reason_th: string | null;
  selected_transport: string | null;
  outcome_unknown: boolean;
  meta_message_id: string | null;
  fbtrace_id: string | null;
  error_text: string | null;
  created_at: string;
  finished_at: string | null;
};

const NOTIFY_COLUMNS =
  'id,order_id,event,status,message_text,policy_reason_th,selected_transport,' +
  'outcome_unknown,meta_message_id,fbtrace_id,error_text,created_at,finished_at';

export async function getOrderNotifications(orderId: string): Promise<NotificationView[]> {
  const { data } = await db()
    .from('fulfillment_notifications')
    .select(NOTIFY_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .overrideTypes<NotificationView[], { merge: false }>();
  return data ?? [];
}

export async function listImportNotifications(importId: string): Promise<NotificationView[]> {
  const { data } = await db()
    .from('fulfillment_notifications')
    .select(NOTIFY_COLUMNS)
    .eq('import_id', importId)
    .order('created_at', { ascending: true })
    .limit(5000)
    .overrideTypes<NotificationView[], { merge: false }>();
  return data ?? [];
}
