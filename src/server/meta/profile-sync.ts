import 'server-only';
/**
 * เติมชื่อ/รูปลูกค้า พร้อม "กลับมาลองใหม่ได้" (แก้ D-33)
 * ===========================================================================
 * 🔴 บทเรียนที่ทำให้ต้องมีไฟล์นี้
 *
 *    โค้ดเดิมอยู่ใน processor.ts และเขียนไว้แบบนี้ :
 *
 *      if (ดึงมาแล้ว) return;          ← เช็คจาก profile_synced_at
 *      ...
 *      update { profile_synced_at: now() }   ← จด "ทุกครั้ง" แม้ดึงไม่สำเร็จ
 *
 *    ตั้งใจดี (ไม่อยากวนยิงถาม Meta ทุกข้อความ) แต่เหมารวม
 *    "ล้มเหลว" ไปปนกับ "สำเร็จ" → กลายเป็น **ยอมแพ้ถาวร**
 *
 *    ผลจริงที่เจอ : ลิสต์แชทเป็น "ลูกค้า xxxxxx" ทั้งหมด
 *    และต่อให้เจ้าของร้านไปแก้สิทธิ์ Meta ให้ถูกแล้ว ก็ไม่มีอะไรกลับมาดึงใหม่
 *
 * ⭐ วิธีคิดใหม่ : "ยังไม่ได้ชื่อ" ไม่ใช่ "ไม่มีวันได้ชื่อ"
 *    สาเหตุที่พบบ่อยที่สุดคือสิทธิ์ยังไม่ครบ ซึ่งแก้ทีหลังได้
 *    ระบบจึงต้องกลับมาถามใหม่เป็นระยะ แต่ต้องห่างขึ้นเรื่อย ๆ ไม่ใช่รัวทุกข้อความ
 *    (จังหวะการรอทั้งหมดอยู่ใน claim_profile_sync ที่ฐานข้อมูล)
 *
 * ⚠️ ทุกฟังก์ชันในนี้ต้องไม่โยน error ออกไป
 *    ไม่รู้ชื่อลูกค้ายังพอทน แต่ข้อความลูกค้าหายไม่ได้
 */
import { db } from '@/lib/supabase/admin';
import { fetchCustomerProfileDetailed } from './profile';
import type { MetaPage } from './client';

/**
 * ลองได้กี่ครั้งก่อนหยุดถามเอง
 * ⭐ ตั้งไว้ค่อนข้างสูงโดยตั้งใจ เพราะครั้งท้าย ๆ ห่างกัน 24 ชั่วโมง
 *    = ระบบจะยังถามให้อีกหลายวัน เผื่อเจ้าของร้านเพิ่งไปแก้สิทธิ์
 *    ครบแล้วยังไม่ได้ = กดปุ่ม "ลองดึงชื่ออีกครั้ง" ในหน้าแชทได้เสมอ
 */
export const MAX_PROFILE_ATTEMPTS = 8;

export type ProfileSyncOutcome =
  | { kind: 'skipped' }
  | { kind: 'synced'; name: string | null; pic: boolean }
  | { kind: 'failed'; reason_th: string };

/**
 * เติมโปรไฟล์ให้ลูกค้าคนหนึ่ง ถ้าถึงเวลาแล้ว
 *
 * ⚠️ ฐานข้อมูลเป็นคนตัดสินว่า "ถึงเวลาหรือยัง" ไม่ใช่โค้ดนี้
 *    เพราะสอง worker อาจทำงานพร้อมกัน ถ้าตัดสินในโค้ดจะยิงถาม Meta ซ้อนกัน
 */
export async function syncCustomerProfile(
  page: MetaPage,
  customerId: string,
  psid: string,
): Promise<ProfileSyncOutcome> {
  try {
    if (!page.access_token) return { kind: 'skipped' };

    const { data, error } = await db().rpc('claim_profile_sync', {
      p_customer_id: customerId,
      p_max_attempts: MAX_PROFILE_ATTEMPTS,
    });
    if (error) {
      console.warn(`[profile] จองสิทธิ์ดึงโปรไฟล์ไม่สำเร็จ: ${error.message}`);
      return { kind: 'skipped' };
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { claimed: boolean; attempt: number }
      | undefined;
    if (!row?.claimed) return { kind: 'skipped' };

    const result = await fetchCustomerProfileDetailed(page, psid);

    if (result.ok) {
      await db().rpc('finish_profile_sync', {
        p_customer_id: customerId,
        p_name: result.profile.name,
        p_pic_url: result.profile.profile_pic_url,
        p_error_kind: null,
        p_error_code: null,
        p_error_th: null,
      });
      // username ไม่ใช่ส่วนตัดสินว่า sync สำเร็จหรือไม่ จึงเก็บแยกจาก RPC เดิม
      // เพื่อให้ migration นี้ย้อนหลังเข้ากับ worker รุ่นก่อนหน้าได้โดยไม่เปลี่ยน signature ของ RPC
      if (result.profile.username) {
        const { error: usernameError } = await db()
          .from('customers')
          .update({ username: result.profile.username })
          .eq('id', customerId);
        if (usernameError) console.warn(`[profile] บันทึก username ไม่สำเร็จ: ${usernameError.message}`);
      }
      return {
        kind: 'synced',
        name: result.profile.name,
        pic: Boolean(result.profile.profile_pic_url),
      };
    }

    /**
     * ⚠️ จดเหตุผลเป็นภาษาไทยที่ไล่ปัญหาต่อได้จริง
     *    ห้ามจดแค่ "ดึงไม่สำเร็จ" เพราะอ่านแล้วไม่รู้ว่าต้องไปแก้อะไร
     * 🔴 และห้ามมี token / ความลับใด ๆ ปนอยู่ในข้อความนี้เด็ดขาด
     *    เพราะมันจะถูกส่งไปแสดงบนหน้าเว็บ
     */
    await db().rpc('finish_profile_sync', {
      p_customer_id: customerId,
      p_name: null,
      p_pic_url: null,
      p_error_kind: result.error.kind,
      p_error_code: result.error.code,
      p_error_th: result.reason_th,
    });

    return { kind: 'failed', reason_th: result.reason_th };
  } catch (err) {
    console.warn('[profile] เติมโปรไฟล์ลูกค้าไม่สำเร็จ (ข้ามไป):', err);
    return { kind: 'skipped' };
  }
}

/**
 * ปุ่ม "ลองดึงชื่ออีกครั้ง" — ล้างจำนวนครั้งที่พลาด แล้วดึงเดี๋ยวนี้
 *
 * ⭐ มีไว้เพื่อกรณีเดียวที่สำคัญมาก :
 *    เจ้าของร้านเพิ่งแก้สิทธิ์ Meta เสร็จ แล้วอยากเห็นผลทันที
 *    ไม่ต้องรอจังหวะ 24 ชั่วโมงของระบบ
 */
export async function refreshCustomerProfile(
  page: MetaPage,
  customerId: string,
  psid: string,
): Promise<ProfileSyncOutcome> {
  const { error } = await db().rpc('reset_profile_sync', { p_customer_id: customerId });
  if (error) return { kind: 'failed', reason_th: `ล้างสถานะเดิมไม่สำเร็จ: ${error.message}` };
  return syncCustomerProfile(page, customerId, psid);
}
