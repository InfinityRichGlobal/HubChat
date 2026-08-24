import 'server-only';
/**
 * อัปโหลดไฟล์แนบไปยัง Meta (รอบ 6)
 * ===========================================================================
 * ⭐ ไฟล์นี้อยู่ในโฟลเดอร์ server/meta/ โดยตั้งใจ
 *
 *    กฎของโปรเจกต์คือ "ทุกเรื่องที่ต้องคุยกับ Meta อยู่ในโฟลเดอร์นี้เท่านั้น"
 *    ชั้น messaging มีหน้าที่ลำดับขั้นตอน ไม่ใช่รู้จัก HTTP ของ Meta
 *    (ชุดทดสอบสถาปัตยกรรมบังคับข้อนี้อยู่ — เคยเขียนผิดแล้วมันจับได้)
 */
import { db } from '@/lib/supabase/admin';
import { uploadAttachmentToMeta, type MetaPage } from './client';

export class AttachmentError extends Error {
  constructor(public message_th: string) {
    super(message_th);
    this.name = 'AttachmentError';
  }
}

/** หาเพจของห้องแชทนี้ — token ถูกถอดรหัสในชั้น client ไม่หลุดออกมาที่นี่ */
async function pageOfConversation(conversationId: string): Promise<MetaPage> {
  const { data: conv } = await db()
    .from('conversations')
    .select('id,page_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) throw new AttachmentError('ไม่พบห้องแชทนี้');

  const { data: page } = await db()
    .from('pages')
    .select('id,platform,page_id,access_token')
    .eq('id', (conv as { page_id: string }).page_id)
    .maybeSingle();
  if (!page) throw new AttachmentError('ไม่พบเพจของห้องแชทนี้');

  return page as unknown as MetaPage;
}

/**
 * อัปโหลดรูปของห้องแชทนี้ แล้วคืน attachment_id ที่ส่งซ้ำได้
 * ⚠️ การอัปโหลดไม่ได้ทำให้ลูกค้าเห็นอะไร — ปลอดภัยที่จะทำก่อนถาม Policy Engine
 */
export async function uploadImageForConversation(
  conversationId: string,
  file: { bytes: ArrayBuffer; mime: string; filename: string },
): Promise<string> {
  const page = await pageOfConversation(conversationId);
  const uploaded = await uploadAttachmentToMeta(page, file);

  if (!uploaded.ok) {
    // อัปโหลดไม่สำเร็จ = ยังไม่มีอะไรถึงลูกค้า จึงบอกให้ลองใหม่ได้อย่างปลอดภัย
    throw new AttachmentError(
      `อัปโหลดรูปไม่สำเร็จ: ${uploaded.error.message_th}${
        uploaded.error.fbtrace_id ? ` (fbtrace ${uploaded.error.fbtrace_id})` : ''
      }`,
    );
  }
  return uploaded.attachment_id;
}
