import 'server-only';
/**
 * ส่วนที่ adapter ทุกตัวใช้ร่วมกัน
 * ห้ามให้ adapter ตัวใดเรียก Meta เอง — ต้องผ่าน sendToMeta() ตัวเดียวกันหมด
 */
import { sendToMeta, type MetaPage, type MetaSendPayload, type MetaSendResult } from '@/server/meta/client';
import type { SendContent, SendContext } from '@/server/policy/types';
import { policyConfig } from '@/server/policy/config';

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

/**
 * ⭐ ใส่ reply_to ลง payload — เฉพาะช่องทางที่ Meta รองรับจริง
 *
 * 🔴 กฎเหล็ก :
 *    ช่องทางที่เอกสารของ Meta ไม่ได้ระบุ reply_to ไว้ **ห้ามใส่**
 *    ไม่ใช่เพราะกลัว error แต่เพราะ :
 *      1. ยัดฟิลด์ที่ไม่มีในเอกสาร = เดา payload ซึ่งเป็นสิ่งที่ห้ามทำในโปรเจกต์นี้
 *      2. ถ้า Meta เงียบ ๆ ไม่สนใจฟิลด์นั้น เราจะบันทึกว่า "ตอบกลับแล้ว"
 *         ทั้งที่ลูกค้าไม่เห็นเส้นโยงอะไรเลย = โกหกตัวเองในประวัติข้อความ
 *
 *    ระบบยังตอบกลับได้ตามปกติ แค่เก็บความสัมพันธ์ไว้ฝั่งเราเอง
 *
 * @returns payload ที่อาจมี reply_to + ธงว่าใส่จริงไหม (เอาไปบันทึกลง DB)
 */
export function withReplyTo(
  payload: Record<string, unknown>,
  ctx: SendContext,
): { payload: Record<string, unknown>; native: boolean } {
  const mid = ctx.content.reply_to_meta_mid;
  if (!mid) return { payload, native: false };

  if (!policyConfig().native_reply[ctx.channel]) {
    return { payload, native: false };
  }

  return { payload: { ...payload, message: payload.message, reply_to: { mid } }, native: true };
}
