import 'server-only';
/**
 * คิวงาน webhook — ชั้นติดต่อฐานข้อมูล
 * ===========================================================================
 * ทำไมต้องมีคิว (สเปกหัวข้อ 6.3) :
 *   Meta ให้เวลาเราตอบ webhook สั้นมาก ตอบช้าเมื่อไหร่มันจะยิงซ้ำ
 *   ถ้าเราไปแกะข้อความ/ดาวน์โหลดรูป/เขียนฐานข้อมูลก่อนตอบ 200
 *   จังหวะที่คนทักเข้ามาพร้อมกันเยอะ ๆ ระบบจะตอบไม่ทัน แล้วข้อความจะซ้ำเป็นพรวน
 *
 *   ทางแก้คือ "รับของแล้ววางไว้ก่อน แล้วรีบตอบ" ที่เหลือค่อยทำทีหลัง
 */
import { db } from '@/lib/supabase/admin';
import type { QueueStatus } from '@/types/db';

export type QueueJob = {
  id: number;
  payload: unknown;
  attempts: number;
};

/** จำนวนครั้งที่ยอมให้ลองใหม่ก่อนยอมแพ้ */
export const MAX_ATTEMPTS = 5;

/** งานที่ค้างสถานะ "กำลังทำ" นานเกินนี้ ถือว่า worker ตายไปแล้ว ให้เอากลับมาทำใหม่ */
export const STALE_SECONDS = 360;

/**
 * วางงานลงคิว — ต้องเร็วที่สุด ทำอย่างอื่นน้อยที่สุด
 * @returns id ของงานในคิว
 */
export async function enqueueWebhook(payload: unknown): Promise<number> {
  const { data, error } = await db()
    .from('webhook_queue')
    .insert(splitWebhookPayload(payload).map((item) => ({ payload: item })))
    .select('id');

  if (error) throw new Error(`วางงานลงคิวไม่สำเร็จ: ${error.message}`);
  return Number((data as Array<{ id: number }>)[0].id);
}

/** หยิบงานมาทำแบบไม่ชนกับ worker ตัวอื่น */
export async function claimJobs(limit: number): Promise<QueueJob[]> {
  const { data, error } = await db().rpc('claim_webhook_jobs', {
    p_limit: limit,
    p_max_attempts: MAX_ATTEMPTS,
    p_stale_seconds: STALE_SECONDS,
  });

  if (error) throw new Error(`หยิบงานจากคิวไม่สำเร็จ: ${error.message}`);

  return ((data ?? []) as Array<{ id: number; payload: unknown; attempts: number }>).map((r) => ({
    id: Number(r.id),
    payload: r.payload,
    attempts: Number(r.attempts),
  }));
}

/** ปิดงาน — สำเร็จ / ล้มเหลวถาวร / เอากลับเข้าคิวเพื่อลองใหม่ */
export async function finishJob(id: number, status: QueueStatus, errorMessage: string | null, attempt: number): Promise<void> {
  const { data, error } = await db().rpc('finish_webhook_job_attempt', {
    p_id: id,
    p_attempt: attempt,
    p_status: status,
    p_error: errorMessage,
  });
  if (error) throw new Error(`ปิดงานในคิวไม่สำเร็จ: ${error.message}`);
  if (!data) throw new Error('สิทธิ์ประมวลผลงานหมดอายุแล้ว ไม่เขียนผลทับ worker ใหม่');
}

/**
 * ตัดสินว่างานที่พังควรลองใหม่หรือยอมแพ้
 * แยกออกมาเป็นฟังก์ชันเพราะเป็น "กฎ" ที่ต้องทดสอบได้ ไม่ควรซ่อนใน SQL
 *
 * ⚠️ ข้อผิดพลาดที่ลองใหม่ไปก็ไม่มีวันหาย (payload พัง / เพจไม่มีในระบบ)
 *    ต้องยอมแพ้ทันที ไม่งั้นจะวนลองใหม่ 5 รอบเปล่า ๆ แล้วบังคิวงานจริง
 */
export function nextStatusAfterFailure(attempts: number, permanent: boolean): QueueStatus {
  if (permanent) return 'failed';
  return attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
}

/** Split a delivery atomically into small jobs so one failed event cannot hold up others. */
export function splitWebhookPayload(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object' || !('entry' in payload) || !Array.isArray(payload.entry)) return [payload];
  const jobs: unknown[] = [];
  for (const raw of payload.entry) {
    if (!raw || typeof raw !== 'object') { jobs.push({ ...payload, entry: [raw] }); continue; }
    const entry = raw as Record<string, unknown>;
    const { messaging, changes, standby, ...base } = entry;
    let count = 0;
    for (const [field, items] of Object.entries({ changes, messaging, standby })) {
      if (!Array.isArray(items)) continue;
      for (const item of items) { jobs.push({ ...payload, entry: [{ ...base, [field]: [item] }] }); count += 1; }
    }
    if (!count) jobs.push({ ...payload, entry: [entry] });
  }
  return jobs.length ? jobs : [payload];
}
