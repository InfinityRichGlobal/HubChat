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

export type MetaProfile = {
  name: string | null;
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
 * @returns โปรไฟล์เท่าที่ได้ หรือ null เมื่อดึงไม่ได้ (ซึ่งเป็นเรื่องปกติ)
 */
export async function fetchCustomerProfile(page: MetaPage, psid: string): Promise<MetaProfile | null> {
  const result = await metaGet(page, psid, { fields: FIELDS[page.platform] });

  if (!result.ok) {
    // ไม่ throw โดยตั้งใจ — การไม่รู้ชื่อลูกค้าต้องไม่ทำให้ข้อความหาย
    console.warn(
      `[meta/profile] ดึงโปรไฟล์ไม่ได้ (psid=${psid}, ${result.error.kind}): ${result.error.message_th}`,
    );
    return null;
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

  if (name === null && pic === null) return null;
  return { name, profile_pic_url: pic };
}
