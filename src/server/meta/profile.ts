import 'server-only';
/**
 * ดึงชื่อและรูปโปรไฟล์ของลูกค้าจาก Meta
 * ===========================================================================
 * ทำไมต้องมี : webhook ส่งมาแค่ psid (ตัวเลขยาว ๆ) ไม่ได้ส่งชื่อมาด้วย
 *              ถ้าไม่ดึง แอดมินจะเห็นลิสต์แชทเป็นตัวเลขล้วน ใช้งานไม่ได้จริง
 *
 * ⚠️ ไฟล์นี้ "อ่านอย่างเดียว" — ไม่มีการส่งข้อความใด ๆ
 *    จึงไม่เกี่ยวกับ Message Policy Engine และไม่ต้องผ่าน sendMessage()
 *
 * ⚠️ ล้มเหลวได้เป็นปกติ และต้องไม่ทำให้ข้อความหาย :
 *    • ลูกค้าตั้งค่าความเป็นส่วนตัวไม่ให้เพจเห็นชื่อ
 *    • token ยังไม่มีสิทธิ์ที่ต้องใช้
 *    • Instagram กับ Messenger คืนฟิลด์คนละชื่อ
 *    → ผู้เรียกต้องถือว่า "ไม่ได้ชื่อ" เป็นเรื่องปกติเสมอ
 */
import { metaGet, type MetaPage } from './client';
import type { MetaErrorInfo } from './errors';

export type MetaProfile = {
  name: string | null;
  username: string | null;
  profile_pic_url: string | null;
};

/** ฟิลด์ที่ขอ — Messenger กับ Instagram ไม่เหมือนกัน ห้ามใช้ชุดเดียวกัน */
const FIELDS: Record<'facebook' | 'instagram', string> = {
  facebook: 'first_name,last_name,profile_pic',
  instagram: 'name,username,profile_pic',
};

function joinName(first: unknown, last: unknown): string | null {
  const parts = [first, last].filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  const joined = parts.join(' ').trim();
  return joined.length > 0 ? joined : null;
}

/**
 * ใช้แทน error จริง เมื่อ Meta ตอบ 200 แต่ไม่มีข้อมูลโปรไฟล์ให้เลย
 * จัดเป็น policy เพราะเป็นสิทธิ์ของลูกค้าที่จะไม่ให้เห็น ไม่ใช่ความผิดพลาดที่แก้ได้
 */
const EMPTY_PROFILE_ERROR: MetaErrorInfo = {
  kind: 'policy',
  code: null,
  subcode: null,
  message: 'profile fields empty',
  fbtrace_id: null,
  message_th: 'ไม่มีข้อมูลโปรไฟล์ให้',
  window_actually_closed: false,
};

export type ProfileFetchResult =
  | { ok: true; profile: MetaProfile }
  | { ok: false; error: MetaErrorInfo; reason_th: string };

/**
 * ⭐ แปลเหตุผลที่ดึงไม่ได้ ให้เป็นภาษาที่ "บอกว่าต้องไปทำอะไรต่อ"
 *
 * 🔴 นี่คือส่วนที่ D-33 ขาดไปทั้งหมด
 *    เดิมได้แค่ log ว่า "ดึงโปรไฟล์ไม่ได้ ... permanent" ซึ่งอ่านแล้วไม่รู้เลยว่า
 *    เป็นเพราะขาดสิทธิ์ / ลูกค้าตั้งค่าความเป็นส่วนตัว / หรือ token หมดอายุ
 *    เจ้าของร้านจึงไล่ปัญหาต่อไม่ได้ แล้วเรื่องก็ค้างมาหลายรอบ
 *
 * ⚠️ ข้อความที่คืนจากฟังก์ชันนี้จะถูกเก็บลงฐานข้อมูลและแสดงบนหน้าเว็บ
 *    จึงห้ามมี token / app secret / ความลับใด ๆ ปนเด็ดขาด
 *    (ใช้เฉพาะ code + ข้อความอธิบายของเราเอง ไม่เอาข้อความดิบจาก Meta มาแปะทั้งก้อน)
 */
export function explainProfileError(err: MetaErrorInfo, platform: 'facebook' | 'instagram'): string {
  const where = platform === 'instagram' ? 'Instagram' : 'Facebook';

  // 190 = token ใช้ไม่ได้แล้ว — เจ้าของร้านต้องไปสร้าง token ใหม่
  if (err.code === 190) {
    return `token ของเพจ ${where} ใช้ไม่ได้แล้ว — ต้องสร้างใหม่ที่ ตั้งค่า → จัดการเพจ`;
  }

  /**
   * 10 / 200 / 803 = กลุ่ม "สิทธิ์ไม่พอ" ซึ่งเป็นสาเหตุที่พบบ่อยที่สุดของ D-33
   * ต้องบอกชื่อสิทธิ์ให้ชัด ไม่งั้นเจ้าของร้านไม่รู้ว่าจะไปติ๊กอะไร
   */
  if (err.code === 10 || err.code === 200 || err.code === 803) {
    return platform === 'instagram'
      ? 'token ยังไม่มีสิทธิ์อ่านโปรไฟล์ผู้ใช้ Instagram — ตรวจสิทธิ์ instagram_manage_messages ตอนสร้าง token'
      : 'token ยังไม่มีสิทธิ์อ่านโปรไฟล์ผู้ใช้ — ตรวจสิทธิ์ pages_messaging ตอนสร้าง token';
  }

  /**
   * ⭐ 100 = "ขอฟิลด์ที่ไม่มีสิทธิ์เห็น" ซึ่ง Meta ใช้กับกรณีความเป็นส่วนตัวด้วย
   *    ลูกค้าบางคนตั้งค่าไม่ให้เพจเห็นชื่อ ซึ่งเป็นสิทธิ์ของเขา ไม่ใช่ความผิดพลาดของเรา
   *    ต้องแยกให้ออกจาก "สิทธิ์ token ไม่พอ" ไม่งั้นเจ้าของร้านจะไล่แก้ token ไม่จบ
   */
  if (err.code === 100) {
    return `${where} ไม่คืนชื่อลูกค้ารายนี้มา — อาจเป็นการตั้งค่าความเป็นส่วนตัวของลูกค้าเอง หรือ token ยังขาดสิทธิ์`;
  }

  if (err.kind === 'transient') {
    return `ติดต่อ ${where} ไม่ได้ชั่วคราว — ระบบจะลองใหม่ให้เอง`;
  }

  return `ดึงชื่อจาก ${where} ไม่สำเร็จ (รหัส ${err.code ?? '-'})`;
}

/**
 * ดึงโปรไฟล์แบบ "บอกเหตุผลด้วยเมื่อไม่สำเร็จ"
 *
 * ⚠️ ผู้เรียกต้องถือว่า "ไม่ได้ชื่อ" เป็นเรื่องปกติเสมอ
 *    แต่ตอนนี้จะรู้ด้วยว่าไม่ได้เพราะอะไร และควรลองใหม่ไหม
 */
export async function fetchCustomerProfileDetailed(
  page: MetaPage,
  psid: string,
): Promise<ProfileFetchResult> {
  const result = await metaGet(page, psid, { fields: FIELDS[page.platform] });

  if (!result.ok) {
    const reason_th = explainProfileError(result.error, page.platform);
    console.warn('[meta/profile] ดึงโปรไฟล์ไม่ได้', {
      psid,
      platform: page.platform,
      kind: result.error.kind,
      code: result.error.code,
      subcode: result.error.subcode,
      message: result.error.message,
      fbtrace_id: result.error.fbtrace_id,
      reason_th,
    });
    return { ok: false, error: result.error, reason_th };
  }

  const d = result.data;

  const name =
    page.platform === 'facebook'
      ? joinName(d.first_name, d.last_name)
      : (typeof d.name === 'string' && d.name.trim().length > 0
          ? d.name.trim()
          : typeof d.username === 'string' && d.username.trim().length > 0
            ? d.username.trim()
            : null);

  const pic = typeof d.profile_pic === 'string' && d.profile_pic.length > 0 ? d.profile_pic : null;
  const username =
    page.platform === 'instagram' && typeof d.username === 'string' && d.username.trim().length > 0
      ? d.username.trim().replace(/^@/, '')
      : null;

  /**
   * ⚠️ Meta ตอบ 200 แต่ไม่มีทั้งชื่อและรูป = ยังถือว่า "ยังไม่ได้ข้อมูล"
   *    ต้องนับเป็นล้มเหลว เพื่อให้ระบบกลับมาลองใหม่ตามจังหวะ
   *    ไม่ใช่ตีตราว่าสำเร็จแล้วปล่อยให้ค้างเป็น "ลูกค้า xxxxxx" ตลอดกาล
   */
  if (name === null && pic === null) {
    return {
      ok: false,
      error: EMPTY_PROFILE_ERROR,
      reason_th: `${page.platform === 'instagram' ? 'Instagram' : 'Facebook'} ตอบกลับมาแต่ไม่มีชื่อและรูป — อาจเป็นการตั้งค่าความเป็นส่วนตัวของลูกค้า`,
    };
  }

  return { ok: true, profile: { name, username, profile_pic_url: pic } };
}

/**
 * @deprecated ใช้ fetchCustomerProfileDetailed แทน — ตัวนี้ทิ้งเหตุผลที่ล้มเหลวไป
 *             ซึ่งเป็นสาเหตุที่ D-33 ไล่ปัญหาไม่ได้อยู่หลายรอบ
 * @returns โปรไฟล์เท่าที่ได้ หรือ null เมื่อดึงไม่ได้
 */
export async function fetchCustomerProfile(page: MetaPage, psid: string): Promise<MetaProfile | null> {
  const r = await fetchCustomerProfileDetailed(page, psid);
  return r.ok ? r.profile : null;
}
