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
 */
import { metaGet, MetaNotConfiguredError, type MetaPage } from './client';

export type PageCheckResult =
  | { ok: true; page_name: string; page_id: string }
  | { ok: false; message_th: string };

export async function verifyPageConnection(page: MetaPage): Promise<PageCheckResult> {
  try {
    // ถามข้อมูลพื้นฐานของเพจ — เบาที่สุดและใช้ได้ทั้ง Messenger และ Instagram
    const result = await metaGet(page, page.page_id, { fields: 'id,name' });

    if (!result.ok) {
      return { ok: false, message_th: result.error.message_th };
    }

    const id = typeof result.data.id === 'string' ? result.data.id : page.page_id;
    const name = typeof result.data.name === 'string' ? result.data.name : '(ไม่ทราบชื่อ)';

    if (id !== page.page_id) {
      return {
        ok: false,
        message_th: `token นี้เป็นของเพจ id ${id} ไม่ใช่ ${page.page_id} — คัดลอกมาผิดเพจหรือเปล่า`,
      };
    }

    return { ok: true, page_name: name, page_id: id };
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
