import 'server-only';
/**
 * ทดสอบว่า token ของเพจใช้งานได้จริงไหม
 * ===========================================================================
 * ใช้ตอนเจ้าของร้านกดปุ่ม "ทดสอบการเชื่อมต่อ" ในหน้าตั้งค่าเพจ
 *
 * ทำไมต้องมี : ถ้าคัดลอก token มาผิดหรือ token หมดอายุ
 *              เราต้องรู้ "ตอนตั้งค่า" ไม่ใช่ตอนลูกค้าทักมาแล้วตอบไม่ได้
 *
 * ⚠️ อ่านอย่างเดียว ไม่มีการส่งข้อความ จึงไม่เกี่ยวกับ Policy Engine
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 บทเรียนจากการใช้งานจริง (แก้หลังรอบ 4)
 *
 * เดิมตัวทดสอบถามว่า  GET /{page_id}?fields=id,name
 * ซึ่ง Meta บังคับว่าต้องมีสิทธิ์ `pages_read_engagement`
 * หรือฟีเจอร์ "Page Public Metadata Access" ที่ต้องยื่นขอเพิ่ม
 *
 * ผลคือ token ที่ "ส่งข้อความได้จริง" กลับถูกรายงานว่าใช้ไม่ได้
 * ทั้งที่ข้อความขาเข้าไหลเข้าระบบตามปกติอยู่แล้ว → เป็นการโกหกเจ้าของร้าน
 *
 * ตอนนี้เปลี่ยนไปถาม GET /me แทน
 * ด้วย Page Access Token คำว่า "me" หมายถึงตัวเพจเอง
 * และไม่ต้องใช้สิทธิ์เพิ่มเติมใด ๆ นอกจากตัว token เอง
 * ─────────────────────────────────────────────────────────────────────────
 */
import { metaGet, MetaNotConfiguredError, type MetaPage } from './client';

export type PageCheckResult =
  | { ok: true; page_name: string; page_id: string }
  | { ok: false; message_th: string };

/**
 * แปลง error ของ Meta ให้เป็นคำแนะนำที่ทำตามได้จริง
 * ⚠️ ข้อความเดิมของ Meta ยาวและเป็นภาษาอังกฤษล้วน เจ้าของร้านอ่านแล้วไม่รู้ต้องทำอะไร
 */
function explainMetaError(code: number | null, raw: string, fallback: string): string {
  if (code === 190) {
    return 'token หมดอายุหรือถูกยกเลิกแล้ว — สร้าง token ใหม่จาก Business Manager (คู่มือขั้นที่ 4)';
  }
  if (code === 100 && /pages_read_engagement|Page Public/i.test(raw)) {
    return (
      'token ใช้ส่งข้อความได้ แต่ยังขาดสิทธิ์ `pages_read_engagement` จึงอ่านชื่อเพจไม่ได้ — ' +
      'กลับไปเพิ่มสิทธิ์นี้ตอนสร้าง token (คู่มือขั้นที่ 4)'
    );
  }
  if (code === 100) {
    return 'Meta หาเพจนี้ไม่เจอ — ตรวจว่า Page ID ถูกต้อง และ token เป็นของเพจเดียวกัน';
  }
  if (code === 200 || code === 10) {
    return 'token ไม่มีสิทธิ์พอสำหรับเพจนี้ — ตรวจว่าให้สิทธิ์เพจครบตอนสร้าง token (คู่มือขั้นที่ 4 ข้อ 3)';
  }
  return fallback;
}

export async function verifyPageConnection(page: MetaPage): Promise<PageCheckResult> {
  try {
    /**
     * Messenger : ถาม /me — token ของเพจจะตอบข้อมูลเพจตัวเองกลับมา ไม่ต้องมีสิทธิ์เพิ่ม
     * Instagram : /me จะได้เพจ Facebook ที่ผูกอยู่ ไม่ใช่บัญชี IG
     *             จึงต้องถามด้วย id ของ IG ตรง ๆ (ใช้สิทธิ์ instagram_basic ที่มีอยู่แล้ว)
     */
    const isInstagram = page.platform === 'instagram';
    const path = isInstagram ? page.page_id : 'me';
    const fields = isInstagram ? 'id,username,name' : 'id,name';

    const result = await metaGet(page, path, { fields });

    if (!result.ok) {
      const err = result.error;
      // จดของดิบไว้ในล็อกเซิร์ฟเวอร์ ไว้ไล่ปัญหาย้อนหลัง
      console.error('[Meta page test]', {
        platform: page.platform,
        path,
        http_status: result.http_status,
        kind: err.kind,
        code: err.code,
        subcode: err.subcode,
        message: err.message,
        fbtrace_id: err.fbtrace_id,
      });

      return {
        ok: false,
        message_th: explainMetaError(err.code, err.message ?? '', err.message_th),
      };
    }

    const id = typeof result.data.id === 'string' ? result.data.id : null;
    const name =
      (typeof result.data.name === 'string' && result.data.name) ||
      (typeof result.data.username === 'string' && result.data.username) ||
      '(ไม่ทราบชื่อ)';

    if (id && id !== page.page_id) {
      return {
        ok: false,
        message_th: `token นี้เป็นของเพจ id ${id} ไม่ใช่ ${page.page_id} — คัดลอกมาผิดเพจหรือเปล่า`,
      };
    }

    return { ok: true, page_name: name, page_id: id ?? page.page_id };
  } catch (err) {
    if (err instanceof MetaNotConfiguredError) {
      return { ok: false, message_th: err.message };
    }
    // ถอดรหัส token ไม่ได้ = ENCRYPTION_KEY เปลี่ยนไปจากตอนที่บันทึก
    return {
      ok: false,
      message_th: 'ถอดรหัส token ของเพจไม่ได้ — ENCRYPTION_KEY อาจถูกเปลี่ยน ต้องใส่ token ใหม่อีกครั้ง',
    };
  }
}
