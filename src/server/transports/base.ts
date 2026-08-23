import 'server-only';
/**
 * ส่วนที่ adapter ทุกตัวใช้ร่วมกัน
 * ห้ามให้ adapter ตัวใดเรียก Meta เอง — ต้องผ่าน sendToMeta() ตัวเดียวกันหมด
 */
import { sendToMeta, type MetaPage, type MetaSendPayload, type MetaSendResult } from '@/server/meta/client';
import type { SendContent, SendContext } from '@/server/policy/types';

/** ทุก adapter ยิงผ่านตัวนี้ */
export function dispatch(page: MetaPage, payload: MetaSendPayload): Promise<MetaSendResult> {
  return sendToMeta(page, payload);
}

/**
 * แปลงเนื้อหาเป็นก้อน message ของ Meta
 * รูปภาพ : ใช้ attachment_id ที่อัปโหลดไว้แล้วเป็นหลัก (สเปก 6.2)
 *          เพราะเร็วกว่าและไม่พังจากลิงก์เสีย
 * ลูกค้าเห็นเป็นรูปภาพปกติ ไม่เห็นลิงก์หรือ ID
 */
export function buildMessageBody(content: SendContent): Record<string, unknown> | null {
  if (content.text && content.text.trim()) {
    return { text: content.text };
  }
  const image = content.images?.[0];
  if (image?.meta_attachment_id) {
    return { attachment: { type: 'image', payload: { attachment_id: image.meta_attachment_id } } };
  }
  if (image?.url) {
    return { attachment: { type: 'image', payload: { url: image.url, is_reusable: true } } };
  }
  return null;
}

/** โครง payload พื้นฐานที่ทุกช่องทางใช้เหมือนกัน */
export function baseEnvelope(recipientPsid: string): Record<string, unknown> {
  return { recipient: { id: recipientPsid } };
}

/** ข้อความว่างเปล่า = ไม่ต้องส่ง */
export function requireBody(ctx: SendContext): Record<string, unknown> | null {
  return buildMessageBody(ctx.content);
}
