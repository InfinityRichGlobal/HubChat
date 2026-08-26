import 'server-only';
/**
 * คุยกับ Meta เรื่องคอมเมนต์ (รอบ 9)
 * ===========================================================================
 * ⭐ อยู่ในโฟลเดอร์ server/meta/ โดยตั้งใจ
 *    กฎของโปรเจกต์ : ทุกเรื่องที่ต้องยิง HTTP หา Meta อยู่ในโฟลเดอร์นี้เท่านั้น
 *    (ทั้ง eslint และชุดทดสอบสถาปัตยกรรมบังคับข้อนี้)
 *
 * 🔴 "ตอบส่วนตัว" (private reply) ไม่ได้เดินผ่าน Send API
 *    จึงไม่ผ่าน transport ของ Message Policy Engine — และนั่นถูกต้องแล้ว
 *    เพราะเป็นคนละ endpoint ที่มีกฎของตัวเอง (สเปก 6.4) :
 *      • ทำได้ครั้งเดียวต่อคอมเมนต์ตลอดกาล
 *      • ภายใน 7 วันนับจากคอมเมนต์
 *      • และมันคือสิ่งที่ "เปิด" กรอบ 24 ชม. ให้คุยต่อได้ ไม่ใช่การส่งในกรอบ
 *    ด่านกันพลาดจึงอยู่ที่ฐานข้อมูล (claim_private_reply) แทน
 *
 * ⚠️ ข้อความหลังจากนี้ทุกข้อความต้องกลับไปผ่าน sendMessage() ตามปกติ
 */
import { metaPost, MetaNotConfiguredError, type MetaPage } from './client';
import { classifyMetaError } from './errors';

export type CommentActionResult =
  | { ok: true; id: string | null }
  | { ok: false; error_th: string; outcome_unknown: boolean };

/**
 * ตอบใต้โพสต์ (คอมเมนต์ตอบคอมเมนต์)
 * ⚠️ ทุกคนเห็นได้ — ห้ามใส่ข้อมูลส่วนตัวของลูกค้าลงไปเด็ดขาด
 */
export async function replyToCommentPublicly(
  page: MetaPage,
  commentId: string,
  message: string,
): Promise<CommentActionResult> {
  const result = await metaPost(page, `${commentId}/comments`, { message });

  if (result.ok) {
    const id = (result.data as { id?: string } | null)?.id ?? null;
    return { ok: true, id };
  }
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * ทักส่วนตัวจากคอมเมนต์
 * 🔴 Meta อนุญาตครั้งเดียวต่อคอมเมนต์ — ต้องจองสิทธิ์กับฐานข้อมูลก่อนเรียกตัวนี้เสมอ
 */
export async function sendPrivateReply(
  page: MetaPage,
  commentId: string,
  message: string,
): Promise<CommentActionResult> {
  const result = await metaPost(page, `${commentId}/private_replies`, { message });

  if (result.ok) {
    const id = (result.data as { id?: string } | null)?.id ?? null;
    return { ok: true, id };
  }
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/** ซ่อน / เลิกซ่อนคอมเมนต์ */
export async function setCommentHidden(
  page: MetaPage,
  commentId: string,
  hidden: boolean,
): Promise<CommentActionResult> {
  const result = await metaPost(page, commentId, { is_hidden: hidden });
  if (result.ok) return { ok: true, id: commentId };
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * แปลข้อผิดพลาดของ Meta เป็นคำแนะนำที่ทำตามได้
 * 🔴 บทเรียนจาก D-31 : ข้อความกลาง ๆ ทำให้ไล่ปัญหาต่อไม่ได้เลย
 */
export function explainCommentError(code: number | null, fallback: string): string {
  if (code === 190) return 'token ของเพจหมดอายุหรือถูกเพิกถอน — สร้าง token ใหม่ในหน้าตั้งค่าเพจ';
  if (code === 10903 || code === 10900) {
    return 'ตอบส่วนตัวไม่ได้แล้ว — คอมเมนต์นี้อาจเคยถูกตอบส่วนตัวไปแล้ว หรือเกินกรอบเวลาที่ Meta กำหนด';
  }
  if (code === 100 || code === 200 || code === 10) {
    return (
      'token ยังไม่มีสิทธิ์จัดการคอมเมนต์ — ต้องมีสิทธิ์ pages_manage_engagement ' +
      'และ pages_read_engagement แล้วสร้าง token ใหม่'
    );
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return 'เรียก Meta ถี่เกินโควตาชั่วโมงนี้ — รอสัก 15-30 นาทีแล้วลองใหม่';
  }
  if (code === 803 || code === 2500) {
    return 'ไม่พบคอมเมนต์นี้บน Meta แล้ว — อาจถูกลบไปโดยลูกค้าหรือเจ้าของโพสต์';
  }
  return fallback;
}

export { MetaNotConfiguredError };
export type { MetaPage };
/** ใช้ในชุดทดสอบเท่านั้น — ให้ classifyMetaError ถูกอ้างถึงจากไฟล์นี้ด้วย */
export const __classify = classifyMetaError;
