import 'server-only';
/**
 * ตัวประมวลผลคิว — เอาเหตุการณ์จาก webhook ไปบันทึกลงฐานข้อมูล
 * ===========================================================================
 * ทำงานทีละงานในคิว งานหนึ่งอาจมีหลายเหตุการณ์
 *
 * หลักการที่ยึด :
 *   1. เหตุการณ์หนึ่งพัง ต้องไม่ทำให้เหตุการณ์อื่นในก้อนเดียวกันหาย
 *   2. ความผิดที่ "ลองใหม่ไปก็เหมือนเดิม" ต้องยอมแพ้ทันที ไม่วนซ้ำ
 *      (payload พัง / ยังไม่ได้เชื่อมเพจนี้)
 *   3. ความผิดชั่วคราว (ฐานข้อมูลสะดุด) ให้เอากลับเข้าคิวไปลองใหม่
 *   4. การกันข้อความซ้ำ ให้ฐานข้อมูลเป็นคนตัดสิน ไม่ใช่โค้ดนี้
 */
import { db } from '@/lib/supabase/admin';
import { syncCustomerProfile } from '@/server/meta/profile-sync';
import type { MetaPage } from '@/server/meta/client';
import type { Platform } from '@/types/db';
import { parseWebhookPayload } from './parse';
import { runAutoReply } from '@/server/autoreply/runner';
import { captureInboundMedia } from '@/server/storage/media';
import { claimJobs, finishJob, nextStatusAfterFailure, type QueueJob } from './queue';
import type { EchoMessageEvent, IngestEvent, InboundMessageEvent } from './types';
import { getFilterWords, saveIncomingComment } from '@/server/comments/service';
import { dispatchNotification } from '@/server/notify/dispatch';

/** สรุปผลของการทำงานหนึ่งรอบ — ใช้ตอบกลับหน้าจอและใช้ในชุดทดสอบ */
export type ProcessSummary = {
  jobs: number;
  inbound_saved: number;
  echo_saved: number;
  duplicates: number;
  ignored: number;
  unknown_page: number;
  failed_jobs: number;
  /** ตอบอัตโนมัติสำเร็จกี่ครั้ง (รอบ 6) */
  auto_replied: number;
  /** เข้าเงื่อนไขแต่ Policy Engine ไม่อนุญาต */
  auto_blocked: number;
  /** ไฟล์แนบที่เก็บลงที่เก็บถาวรได้แล้ว (D-17) */
  media_stored: number;
  /** ไฟล์แนบที่เก็บไม่ได้ — รวมกรณีลิงก์หมดอายุ ซึ่งกู้ไม่ได้ */
  media_failed: number;
  /** คอมเมนต์ที่บันทึกใหม่ (รอบ 9) — ⚠️ ไม่มีการตอบอัตโนมัติใด ๆ */
  comments_saved: number;
  /** คอมเมนต์ที่เข้าคำกรอง — ใช้ตัดสินว่าจะแจ้งเตือนไหม */
  comments_flagged: number;
  /** แจ้งเตือนที่เข้าคิวได้จริงในรอบนี้ (รอบ 10) */
  notifications_queued: number;
};

const EMPTY_SUMMARY: ProcessSummary = {
  jobs: 0,
  inbound_saved: 0,
  echo_saved: 0,
  duplicates: 0,
  ignored: 0,
  unknown_page: 0,
  failed_jobs: 0,
  auto_replied: 0,
  auto_blocked: 0,
  media_stored: 0,
  media_failed: 0,
  comments_saved: 0,
  comments_flagged: 0,
  notifications_queued: 0,
};

/** ฟิลด์ตัวเลขทุกตัวต้องอยู่ในรายการนี้ — เพิ่มฟิลด์แล้ว TypeScript จะบังคับให้อัปเดตรายการ */
const SUMMARY_COUNTERS = Object.keys(EMPTY_SUMMARY) as Array<keyof ProcessSummary>;

export function mergeProcessSummary(target: ProcessSummary, source: ProcessSummary): void {
  for (const key of SUMMARY_COUNTERS) target[key] += source[key];
}

/** ความผิดที่ลองใหม่ไปก็ไม่มีวันหาย */
class PermanentJobError extends Error {}

/**
 * รหัสข้อผิดพลาดของ PostgreSQL ที่ "ลองใหม่ไปก็เหมือนเดิม"
 *   22P02 = ค่าที่ส่งมาไม่ตรงชนิด/ไม่ตรง enum
 *   23503 = อ้างถึงแถวที่ไม่มีอยู่ (foreign key)
 *   23514 = ผิดกฎ check constraint
 *   22001 = ข้อความยาวเกินขนาดคอลัมน์
 * ของพวกนี้แปลว่าข้อมูลที่เข้ามาผิดรูป ไม่ใช่ระบบสะดุด — ต้องยอมแพ้ทันที
 * ไม่งั้นจะวนลองใหม่จนครบ 5 รอบแล้วไปบังคิวของข้อความจริง
 */
const PERMANENT_PG_CODES = new Set(['22P02', '23503', '23514', '22001']);

function raiseDbError(prefix: string, error: { message: string; code?: string }): never {
  const text = `${prefix}: ${error.message}`;
  if (error.code && PERMANENT_PG_CODES.has(error.code)) throw new PermanentJobError(text);
  throw new Error(text);
}

/* ------------------------------------------------------------------------ */
/* หาเพจในฐานข้อมูลจาก id ฝั่ง Meta                                            */
/* ------------------------------------------------------------------------ */

type PageRow = MetaPage & { is_active: boolean };

/**
 * จำเพจไว้ในหน่วยความจำระหว่างรอบทำงานเดียว
 * (ข้อความ 50 ข้อความจากเพจเดียวกัน ไม่ควรถาม 50 ครั้ง)
 * ⚠️ ตั้งใจไม่จำข้ามรอบ เพราะถ้าเจ้าของปิดเพจ ต้องมีผลทันทีในรอบถัดไป
 */
type PageCache = Map<string, PageRow | null>;

async function findPage(cache: PageCache, platform: Platform, pageMetaId: string): Promise<PageRow | null> {
  const key = `${platform}:${pageMetaId}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const { data, error } = await db()
    .from('pages')
    .select('id,platform,page_id,access_token,is_active')
    .eq('platform', platform)
    .eq('page_id', pageMetaId)
    .maybeSingle();

  // อ่านฐานข้อมูลไม่ได้ = ความผิดชั่วคราว ต้องโยนออกไปให้ลองใหม่
  if (error) throw new Error(`อ่านข้อมูลเพจไม่สำเร็จ: ${error.message}`);

  const row = (data as PageRow | null) ?? null;
  cache.set(key, row);
  return row;
}

/* ------------------------------------------------------------------------ */
/* บันทึกเหตุการณ์                                                             */
/* ------------------------------------------------------------------------ */

type IngestRow = { message_id: string | null; conversation_id: string; customer_id: string; duplicate: boolean };

async function saveInbound(page: PageRow, ev: InboundMessageEvent): Promise<IngestRow> {
  const { data, error } = await db().rpc('ingest_inbound_message', {
    p_page_id: page.id,
    p_psid: ev.psid,
    p_platform: ev.platform,
    p_meta_message_id: ev.meta_message_id,
    p_text: ev.text,
    p_attachments: ev.attachments,
    p_sent_at: ev.sent_at,
    p_referral_source: ev.referral.source,
    p_referral_ad_id: ev.referral.ad_id,
    p_referral_post_id: ev.referral.post_id,
    p_referral_ref: ev.referral.ref,
  });
  if (error) raiseDbError('บันทึกข้อความขาเข้าไม่สำเร็จ', error);
  return firstRow(data);
}

async function saveEcho(page: PageRow, ev: EchoMessageEvent): Promise<IngestRow> {
  const { data, error } = await db().rpc('ingest_echo_message', {
    p_page_id: page.id,
    p_psid: ev.psid,
    p_platform: ev.platform,
    p_meta_message_id: ev.meta_message_id,
    p_text: ev.text,
    p_attachments: ev.attachments,
    p_sent_at: ev.sent_at,
  });
  if (error) raiseDbError('บันทึกข้อความขาออก (echo) ไม่สำเร็จ', error);
  return firstRow(data);
}

function firstRow(data: unknown): IngestRow {
  const rows = (Array.isArray(data) ? data : [data]) as IngestRow[];
  const row = rows[0];
  if (!row) throw new Error('ฐานข้อมูลไม่ได้คืนผลของการบันทึกข้อความกลับมา');
  return row;
}

/* ------------------------------------------------------------------------ */
/* เติมชื่อ/รูปโปรไฟล์ลูกค้า                                                     */
/* ------------------------------------------------------------------------ */

/**
 * ดึงโปรไฟล์เฉพาะลูกค้าที่ยังไม่เคยดึง
 * ⚠️ ล้มเหลวได้ ห้ามทำให้ทั้งงานพัง — ข้อความสำคัญกว่าชื่อ
 */
/**
 * เติมชื่อ/รูปลูกค้า
 *
 * 🔴 เดิมโค้ดตรงนี้จด profile_synced_at "ทุกครั้งแม้ดึงไม่สำเร็จ"
 *    แล้วรอบถัดไปเช็คว่าเคยจดแล้วก็ข้าม → กลายเป็นยอมแพ้ถาวร (D-33)
 *    ตอนนี้ย้ายการตัดสินใจ "ถึงเวลาลองใหม่หรือยัง" ไปไว้ที่ฐานข้อมูลแทน
 *    (claim_profile_sync ใน migration 0014) ซึ่งกันสอง worker ยิงซ้อนกันได้ด้วย
 */
async function syncProfileIfNeeded(page: PageRow, customerId: string, psid: string): Promise<void> {
  await syncCustomerProfile(page, customerId, psid);
}

/* ------------------------------------------------------------------------ */
/* เก็บไฟล์แนบไว้เองอย่างถาวร (D-17)                                            */
/* ------------------------------------------------------------------------ */

/**
 * ดาวน์โหลดไฟล์ที่ลูกค้าส่งมาเก็บไว้เอง ก่อนลิงก์ของ Meta จะหมดอายุ
 *
 * 🔴 ทำก่อนตอบอัตโนมัติโดยตั้งใจ — ลิงก์กำลังเดินนาฬิกาหมดอายุอยู่
 *    ส่วนการตอบอัตโนมัติรอได้อีกไม่กี่วินาที
 *
 * ⚠️ ห่อ try/catch เสมอ : รูปหายยังพอทน แต่ข้อความลูกค้าหายไม่ได้
 */
async function maybeCaptureMedia(
  page: PageRow,
  row: IngestRow,
  ev: InboundMessageEvent,
  summary: ProcessSummary,
): Promise<void> {
  if (!row.message_id || ev.attachments.length === 0) return;

  try {
    const result = await captureInboundMedia({
      message_id: row.message_id,
      conversation_id: row.conversation_id,
      page_id: page.id,
      attachments: ev.attachments,
    });
    summary.media_stored += result.stored;
    summary.media_failed += result.failed;
  } catch (err) {
    console.error('[ingest] เก็บไฟล์แนบไม่สำเร็จ (ข้ามไป ข้อความลูกค้ายังอยู่ครบ):', err);
  }
}

/* ------------------------------------------------------------------------ */
/* ตอบอัตโนมัติด้วยคีย์เวิร์ด (รอบ 6)                                           */
/* ------------------------------------------------------------------------ */

/**
 * เรียกตัวตอบอัตโนมัติสำหรับข้อความขาเข้าที่ "ใหม่จริง" เท่านั้น
 *
 * 🔴 เงื่อนไขที่ต้องครบก่อนถึงจะพิจารณาตอบ :
 *    • ต้องเป็นข้อความขาเข้า (ไม่ใช่ echo จากที่แอดมินตอบใน Business Suite)
 *    • ต้องไม่ใช่ข้อความซ้ำ — ตรวจไปแล้วที่ชั้นบน (row.duplicate)
 *    • ต้องมี message_id จริง เพราะเป็นกุญแจกันตอบซ้ำ
 *
 * ⚠️ ห่อด้วย try/catch เสมอ
 *    ถ้าตัวตอบอัตโนมัติพัง ต้องไม่ทำให้ข้อความของลูกค้าหายจากอินบ็อกซ์
 *    ข้อความของลูกค้าสำคัญกว่าคำตอบอัตโนมัติเสมอ
 */
async function maybeAutoReply(
  page: PageRow,
  row: IngestRow,
  ev: InboundMessageEvent,
  summary: ProcessSummary,
): Promise<void> {
  if (!row.message_id) return;

  try {
    const outcome = await runAutoReply({
      message_id: row.message_id,
      conversation_id: row.conversation_id,
      page_id: page.id,
      text: ev.text,
    });

    if (outcome.kind === 'sent') summary.auto_replied += 1;
    else if (outcome.kind === 'blocked') summary.auto_blocked += 1;
  } catch (err) {
    console.error('[ingest] ตอบอัตโนมัติล้มเหลว (ข้ามไป ข้อความลูกค้ายังอยู่ครบ):', err);
  }
}

/* ------------------------------------------------------------------------ */
/* แจ้งเตือน (รอบ 10)                                                         */
/* ------------------------------------------------------------------------ */

/**
 * แจ้งเตือนแอดมินว่ามีข้อความใหม่จากลูกค้า
 *
 * 🔴 "ทักใหม่" กับ "ตอบกลับ" ต่างกันที่ว่ามีคนรับแชทนี้ไว้หรือยัง
 *    • ยังไม่มีใครรับ → new_chat  → บอกทุกคนที่ดูเพจนั้น (ไม่งั้นไม่มีใครรู้)
 *    • มีคนรับแล้ว    → reply     → บอกเฉพาะคนนั้น (ไม่งั้นทุกคนโดนกวนเปล่า ๆ)
 *
 * ⚠️ ห่อ try/catch เสมอ — แจ้งเตือนพังต้องไม่ทำให้ข้อความของลูกค้าหาย
 */
async function maybeNotifyInbound(
  page: PageRow,
  row: IngestRow,
  ev: InboundMessageEvent,
  summary: ProcessSummary,
): Promise<void> {
  if (!row.message_id) return;

  try {
    const { data } = await db()
      .from('conversations')
      .select('id,assigned_admin_id,customer_id')
      .eq('id', row.conversation_id)
      .maybeSingle();

    const conv = data as { assigned_admin_id: string | null; customer_id: string } | null;
    if (!conv) return;

    const { data: cust } = await db()
      .from('customers')
      .select('name')
      .eq('id', conv.customer_id)
      .maybeSingle();
    const who = ((cust as { name: string | null } | null)?.name) || 'ลูกค้า';

    const assigned = conv.assigned_admin_id;
    const text = (ev.text ?? '').replace(/\s+/g, ' ').trim();
    const body = text
      ? (text.length > 80 ? `${text.slice(0, 80)}…` : text)
      : (ev.attachments.length > 0 ? '📎 ส่งไฟล์แนบมา' : '(ไม่มีข้อความ)');

    const result = await dispatchNotification({
      event: assigned ? 'reply' : 'new_chat',
      page_id: page.id,
      /**
       * 🔴 ต้องมี message_id อยู่ในกุญแจกันซ้ำ
       *    ห้องแชทหนึ่งห้องอยู่กับลูกค้าคนนั้นตลอดชีวิต (unique บน customer_id)
       *    ถ้าใช้แค่ห้อง ลูกค้าเก่าที่กลับมาทักอีกจะไม่มีใครได้รับแจ้งเตือนเลย
       */
      subject_id: `${row.conversation_id}:${row.message_id}`,
      conversation_id: row.conversation_id,
      assigned_admin_id: assigned,
      title: assigned ? `💬 ${who} ตอบกลับ` : `🆕 ${who} ทักเข้ามา`,
      body,
      link: `/inbox?c=${row.conversation_id}`,
    });
    summary.notifications_queued += result.queued;
  } catch (err) {
    console.error('[ingest] แจ้งเตือนข้อความใหม่ไม่สำเร็จ (ข้ามไป ข้อความลูกค้ายังอยู่ครบ):', err);
  }
}

/* ------------------------------------------------------------------------ */
/* คอมเมนต์ (รอบ 9)                                                           */
/* ------------------------------------------------------------------------ */

/** คำกรองอ่านครั้งเดียวต่อการประมวลผลหนึ่งรอบ ไม่ใช่ต่อคอมเมนต์ */
let filterWordsCache: string[] | null = null;

/**
 * บันทึกคอมเมนต์ที่เข้ามา
 *
 * ⚠️ ต้องไม่โยน error ออกไป — คอมเมนต์พังต้องไม่ทำให้ข้อความของลูกค้าในคิวเดียวกันพัง
 * 🔴 และต้องไม่ตอบอะไรกลับไปทั้งสิ้น
 */
async function handleComment(
  page: PageRow,
  ev: Extract<IngestEvent, { kind: 'comment' }>,
  summary: ProcessSummary,
): Promise<void> {
  try {
    if (filterWordsCache === null) filterWordsCache = await getFilterWords();

    const saved = await saveIncomingComment(
      {
        page_id: page.id,
        comment_id: ev.comment_id,
        post_id: ev.post_id,
        parent_comment_id: ev.parent_comment_id,
        from_id: ev.from_id,
        from_name: ev.from_name,
        message: ev.message,
        permalink: ev.permalink,
        attachment_url: ev.attachment_url,
        is_from_page: ev.is_from_page,
        commented_at: ev.commented_at,
        raw: ev.raw,
      },
      filterWordsCache,
    );

    if (saved.duplicate) {
      summary.duplicates += 1;
      return;
    }

    summary.comments_saved += 1;
    if (!saved.matched) return;

    summary.comments_flagged += 1;

    /**
     * ⭐ แจ้งเตือนเฉพาะคอมเมนต์ที่ "เข้าคำกรอง" เท่านั้น
     *    โพสต์ที่ยิงแอดอยู่มีคอมเมนต์ได้เป็นพัน ถ้าแจ้งทุกอันแอดมินปิดแจ้งเตือนทิ้งแน่
     *    และ 🔴 แจ้งเตือนอย่างเดียว ห้ามตอบอัตโนมัติ (สเปก 5.5)
     */
    if (saved.id) {
      const result = await dispatchNotification({
        event: 'new_comment',
        page_id: page.id,
        // comment_id ของ Meta ไม่ซ้ำอยู่แล้ว ใช้เป็นกุญแจกันซ้ำได้ตรง ๆ
        subject_id: saved.id,
        conversation_id: null,
        title: `💭 คอมเมนต์เข้าคำว่า "${saved.matched}"`,
        body: `${ev.from_name || 'ผู้ใช้'}: ${(ev.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || '(ไม่มีข้อความ)'}`,
        link: '/comments',
      });
      summary.notifications_queued += result.queued;
    }
  } catch (err) {
    summary.ignored += 1;
    console.error('[ingest] บันทึกคอมเมนต์ไม่สำเร็จ (ข้ามไป ข้อความอื่นยังทำงานต่อ):', err);
  }
}

/* ------------------------------------------------------------------------ */
/* ทำงานหนึ่งชิ้น                                                              */
/* ------------------------------------------------------------------------ */

async function runJob(job: QueueJob, cache: PageCache, summary: ProcessSummary): Promise<void> {
  const events = parseWebhookPayload(job.payload);

  for (const ev of events) {
    if (ev.kind === 'ignored') {
      summary.ignored += 1;
      continue;
    }

    const page = await findPage(cache, ev.platform, ev.page_meta_id);

    if (!page) {
      // Meta ยิงมาจากเพจที่เรายังไม่ได้เชื่อม — ลองใหม่ไปก็เหมือนเดิม
      summary.unknown_page += 1;
      console.warn(
        `[ingest] ได้รับข้อความจากเพจที่ยังไม่ได้เชื่อมในระบบ (${ev.platform} id=${ev.page_meta_id}) — ข้ามไป`,
      );
      continue;
    }

    if (!page.is_active) {
      summary.ignored += 1;
      continue;
    }

    /**
     * ⭐ คอมเมนต์เดินคนละสายกับข้อความโดยสิ้นเชิง
     *    🔴 บันทึกอย่างเดียว ไม่ตอบอัตโนมัติเด็ดขาด (สเปก 5.5)
     *       แอดมินต้องกดเองทุกครั้ง ทั้งตอบใต้โพสต์และทักส่วนตัว
     */
    if (ev.kind === 'comment') {
      await handleComment(page, ev, summary);
      continue;
    }

    const row = ev.kind === 'inbound_message' ? await saveInbound(page, ev) : await saveEcho(page, ev);

    if (row.duplicate) {
      summary.duplicates += 1;
      continue;
    }

    if (ev.kind === 'inbound_message') {
      summary.inbound_saved += 1;
      await syncProfileIfNeeded(page, row.customer_id, ev.psid);
      // ⭐ เก็บไฟล์ "ก่อน" ทำอย่างอื่น เพราะลิงก์ของ Meta เดินนาฬิกาหมดอายุอยู่
      await maybeCaptureMedia(page, row, ev, summary);
      await maybeAutoReply(page, row, ev, summary);
      /**
       * ⭐ แจ้งเตือน "หลัง" ตอบอัตโนมัติโดยตั้งใจ
       *    ถ้าบอทตอบไปแล้ว แอดมินก็ยังควรรู้ว่ามีคนทักอยู่ดี
       *    แต่ต้องไม่ให้แจ้งเตือนไปขวางการตอบอัตโนมัติที่ต้องเร็ว
       */
      await maybeNotifyInbound(page, row, ev, summary);
    } else {
      summary.echo_saved += 1;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* ทำงานหนึ่งรอบ                                                               */
/* ------------------------------------------------------------------------ */

/**
 * หยิบงานจากคิวมาทำสูงสุด `limit` ชิ้น
 * เรียกได้จาก 3 ที่ : ทันทีหลังตอบ webhook / worker ที่วนเรียก / หน้าจอสั่งเอง
 */
export async function processWebhookBatch(limit = 20): Promise<ProcessSummary> {
  const summary: ProcessSummary = { ...EMPTY_SUMMARY };
  const cache: PageCache = new Map();

  const jobs = await claimJobs(limit);
  summary.jobs = jobs.length;

  for (const job of jobs) {
    try {
      await runJob(job, cache, summary);
      await finishJob(job.id, 'done', null);
    } catch (err) {
      const permanent = err instanceof PermanentJobError;
      const message = err instanceof Error ? err.message : String(err);
      const next = nextStatusAfterFailure(job.attempts, permanent);
      summary.failed_jobs += 1;
      console.error(`[ingest] งานคิว #${job.id} ล้มเหลว (ครั้งที่ ${job.attempts}) → ${next}: ${message}`);
      await finishJob(job.id, next, message.slice(0, 500));
    }
  }

  return summary;
}

/**
 * ทำจนกว่าคิวจะหมด — ใช้ในสคริปต์ worker และในชุดทดสอบ
 * มีเพดานรอบไว้กันวนไม่รู้จบถ้ามีงานที่พังแล้วกลับเข้าคิวตลอด
 */
export async function drainWebhookQueue(maxRounds = 50, limit = 20): Promise<ProcessSummary> {
  const total: ProcessSummary = { ...EMPTY_SUMMARY };
  for (let i = 0; i < maxRounds; i += 1) {
    const round = await processWebhookBatch(limit);
    mergeProcessSummary(total, round);
    if (round.jobs === 0) break;
  }
  return total;
}
