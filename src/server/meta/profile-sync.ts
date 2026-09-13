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

const COMMENT_PROFILE_CACHE_HOURS = 168;
const COMMENT_PROFILE_CACHE_MS = COMMENT_PROFILE_CACHE_HOURS * 3600 * 1000;

/**
 * เติมข้อมูลโปรไฟล์/รูป Avatar ของผู้คอมเมนต์ (ทั้ง Facebook และ Instagram)
 * มีระบบ Cache ตรวจสอบทั้งจากคอมเมนต์ก่อนหน้าและจากตาราง customers
 * เพื่อไม่ให้ยิง Meta ซ้ำซ้อน และไม่โยน error ออกมาขัดขวางการทำงานของคิว
 */
export async function syncCommentProfile(
  page: MetaPage,
  commentRowId: string,
  fromId: string,
  fromUsername?: string | null,
  fromName?: string | null,
): Promise<{ ok: boolean; name: string | null; username: string | null; pic_url: string | null }> {
  try {
    if (!commentRowId || !fromId) {
      return { ok: false, name: fromName ?? null, username: fromUsername ?? null, pic_url: null };
    }

    const now = Date.now();

    // 1. ตรวจสอบ Cache จากคอมเมนต์ก่อนหน้าที่เคยดึงรูปมาแล้ว
    const { data: cachedComments } = await db()
      .from('comments')
      .select('from_name, from_username, from_pic_url, profile_fetched_at')
      .eq('from_id', fromId)
      .not('from_pic_url', 'is', null)
      .order('profile_fetched_at', { ascending: false })
      .limit(1);

    const cachedComment = cachedComments?.[0];
    if (cachedComment?.from_pic_url && cachedComment.profile_fetched_at) {
      const fetchedTime = new Date(cachedComment.profile_fetched_at).getTime();
      if (now - fetchedTime < COMMENT_PROFILE_CACHE_MS) {
        const name = cachedComment.from_name || fromName || null;
        const username = cachedComment.from_username || fromUsername || null;
        const pic = cachedComment.from_pic_url;

        await db()
          .from('comments')
          .update({
            from_name: name,
            from_username: username,
            from_pic_url: pic,
            profile_fetched_at: new Date().toISOString(),
          })
          .eq('id', commentRowId);

        return { ok: true, name, username, pic_url: pic };
      }
    }

    // 2. ตรวจสอบ Cache จากตาราง customers (กรณีเคยคุยแชทมาก่อน)
    const { data: cachedCustomer } = await db()
      .from('customers')
      .select('name, username, profile_pic_url, profile_synced_at')
      .eq('customer_uid', fromId)
      .not('profile_pic_url', 'is', null)
      .maybeSingle();

    if (cachedCustomer?.profile_pic_url && cachedCustomer.profile_synced_at) {
      const fetchedTime = new Date(cachedCustomer.profile_synced_at).getTime();
      if (now - fetchedTime < COMMENT_PROFILE_CACHE_MS) {
        const name = cachedCustomer.name || fromName || null;
        const username = cachedCustomer.username || fromUsername || null;
        const pic = cachedCustomer.profile_pic_url;

        await db()
          .from('comments')
          .update({
            from_name: name,
            from_username: username,
            from_pic_url: pic,
            profile_fetched_at: new Date().toISOString(),
          })
          .eq('id', commentRowId);

        return { ok: true, name, username, pic_url: pic };
      }
    }

    // 3. ถ้าไม่มี Cache หรือหมดอายุ: ดึงจาก Meta API
    if (!page.access_token) {
      return { ok: false, name: fromName ?? null, username: fromUsername ?? null, pic_url: null };
    }

    const result = await fetchCustomerProfileDetailed(page, fromId);
    if (result.ok) {
      const resolvedName = result.profile.name || fromName || null;
      const resolvedUsername = result.profile.username || fromUsername || null;
      const resolvedPic = result.profile.profile_pic_url;

      await db()
        .from('comments')
        .update({
          from_name: resolvedName,
          from_username: resolvedUsername,
          from_pic_url: resolvedPic,
          profile_fetched_at: new Date().toISOString(),
        })
        .eq('id', commentRowId);

      return { ok: true, name: resolvedName, username: resolvedUsername, pic_url: resolvedPic };
    }

    // กรณีดึงไม่สำเร็จ: บันทึก profile_fetched_at ไว้เพื่อไม่ให้วนยิงซ้ำทุกข้อความ
    await db()
      .from('comments')
      .update({
        profile_fetched_at: new Date().toISOString(),
      })
      .eq('id', commentRowId);

    return { ok: false, name: fromName ?? null, username: fromUsername ?? null, pic_url: null };
  } catch (err) {
    console.warn('[profile-sync] เติมโปรไฟล์คอมเมนต์ไม่สำเร็จ (ข้ามไป):', err);
    return { ok: false, name: fromName ?? null, username: fromUsername ?? null, pic_url: null };
  }
}
