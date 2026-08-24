import 'server-only';
/**
 * ส่งรูปจากในห้องแชท (รอบ 6)
 * ===========================================================================
 * 🔴 เส้นทางนี้ต้องเดินตามสถาปัตยกรรมเดิมทุกขั้น :
 *
 *    UI → API route → (อัปโหลดรูปไป Meta) → sendMessage() → Policy Engine → transport
 *
 *    ไม่มีการยิง Meta ตรงจากเบราว์เซอร์
 *    ไม่มีการข้าม Policy Engine
 *    ไม่มีการเลือก transport เอง
 *
 * ⚠️ ลำดับสำคัญมาก : อัปโหลด "ก่อน" ถาม Policy Engine
 *    เพราะ Policy Engine ต้องได้ attachment_id ที่พร้อมส่งจริงไปตัดสิน
 *    การอัปโหลดไม่ได้ทำให้ลูกค้าเห็นอะไร จึงปลอดภัยที่จะทำก่อน
 *    (ถ้า Policy บล็อกทีหลัง รูปที่อัปไว้ก็แค่ค้างอยู่ที่ Meta เฉย ๆ ไม่มีใครเห็น)
 */
import { uploadImageForConversation, AttachmentError } from '@/server/meta/attachments';
import { sendMessage, type SendResult } from './send-message';
import type { Provenance } from './provenance';

/** ชนิดไฟล์ที่ยอมรับ — จำกัดตามที่ Meta รองรับจริง ไม่เปิดกว้างเกินจำเป็น */
export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

/**
 * เพดานขนาดไฟล์
 * Meta รับรูปได้ถึง 25MB แต่เราตั้งไว้ต่ำกว่าโดยตั้งใจ :
 *   • แอดมินส่วนใหญ่ถ่ายจากมือถือ ไฟล์ 8MB ก็เกินพอสำหรับรูปสินค้า
 *   • ยิ่งไฟล์ใหญ่ ยิ่งใช้เวลาอัปโหลดนาน แอดมินจะนึกว่าค้าง
 *   • กันคนเผลอลากไฟล์ผิดอันเข้ามา
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export class ImageSendError extends Error {
  constructor(public message_th: string) {
    super(message_th);
    this.name = 'ImageSendError';
  }
}

export function validateImage(file: { size: number; type: string }): string | null {
  if (!ALLOWED_IMAGE_MIMES.includes(file.type as (typeof ALLOWED_IMAGE_MIMES)[number])) {
    return 'รองรับเฉพาะรูปภาพ (JPG / PNG / GIF / WEBP)';
  }
  if (file.size <= 0) return 'ไฟล์ว่างเปล่า';
  if (file.size > MAX_IMAGE_BYTES) {
    return `ไฟล์ใหญ่เกินไป (สูงสุด ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} MB)`;
  }
  return null;
}

export type SendImageInput = {
  conversation_id: string;
  provenance: Provenance;
  file: { bytes: ArrayBuffer; mime: string; filename: string; size: number };
  idempotency_key?: string | null;
};

/**
 * ส่งรูปหนึ่งรูปเข้าห้องแชท
 * คืนผลหน้าตาเดียวกับการส่งข้อความ เพื่อให้หน้าเว็บจัดการเหมือนกันทุกกรณี
 */
export async function sendImage(input: SendImageInput): Promise<SendResult> {
  const problem = validateImage({ size: input.file.size, type: input.file.mime });
  if (problem) throw new ImageSendError(problem);

  // ---- 1) อัปโหลดไปเก็บที่ Meta ก่อน (ชั้น server/meta เป็นคนคุยกับ Meta) ----
  let attachmentId: string;
  try {
    attachmentId = await uploadImageForConversation(input.conversation_id, {
      bytes: input.file.bytes,
      mime: input.file.mime,
      filename: input.file.filename,
    });
  } catch (err) {
    if (err instanceof AttachmentError) throw new ImageSendError(err.message_th);
    throw err;
  }

  // ---- 2) ส่งผ่านทางเดินกลางเส้นเดิม ------------------------------------
  return sendMessage({
    conversation_id: input.conversation_id,
    message_type: 'inquiry_response',
    provenance: input.provenance,
    content: { images: [{ meta_attachment_id: attachmentId }] },
    idempotency_key: input.idempotency_key ?? null,
  });
}
