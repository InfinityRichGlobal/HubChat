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
import { fetchCustomerProfile } from '@/server/meta/profile';
import type { MetaPage } from '@/server/meta/client';
import type { Platform } from '@/types/db';
import { parseWebhookPayload } from './parse';
import { runAutoReply } from '@/server/autoreply/runner';
import { captureInboundMedia } from '@/server/storage/media';
import { claimJobs, finishJob, nextStatusAfterFailure, type QueueJob } from './queue';
import type { EchoMessageEvent, InboundMessageEvent } from './types';

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
};

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
async function syncProfileIfNeeded(page: PageRow, customerId: string, psid: string): Promise<void> {
  try {
    const { data } = await db()
      .from('customers')
      .select('id,profile_synced_at')
      .eq('id', customerId)
      .maybeSingle();

    if (!data || (data as { profile_synced_at: string | null }).profile_synced_at) return;
    if (!page.access_token) return; // ยังไม่ได้ใส่ token ของเพจนี้

    const profile = await fetchCustomerProfile(page, psid);

    // จดเวลาไว้เสมอแม้ดึงไม่ได้ — ไม่งั้นจะวนยิงถาม Meta ทุกข้อความไม่จบ
    await db()
      .from('customers')
      .update({
        ...(profile?.name ? { name: profile.name } : {}),
        ...(profile?.profile_pic_url ? { profile_pic_url: profile.profile_pic_url } : {}),
        profile_synced_at: new Date().toISOString(),
      })
      .eq('id', customerId);
  } catch (err) {
    console.warn('[ingest] เติมโปรไฟล์ลูกค้าไม่สำเร็จ (ข้ามไป):', err);
  }
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
    total.jobs += round.jobs;
    total.inbound_saved += round.inbound_saved;
    total.echo_saved += round.echo_saved;
    total.duplicates += round.duplicates;
    total.ignored += round.ignored;
    total.unknown_page += round.unknown_page;
    total.failed_jobs += round.failed_jobs;
    total.auto_replied += round.auto_replied;
    total.auto_blocked += round.auto_blocked;
    total.media_stored += round.media_stored;
    total.media_failed += round.media_failed;
    if (round.jobs === 0) break;
  }
  return total;
}
