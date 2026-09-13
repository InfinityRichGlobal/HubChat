import 'server-only';
/**
 * Facebook Comments Adapter
 * ===========================================================================
 * ฟังก์ชันเฉพาะสำหรับจัดการคอมเมนต์บน Facebook Page
 * เรียกใช้งานผ่าน client กลาง (server/meta/client.ts) เท่านั้น
 */
import { metaPost, metaDelete, type MetaPage } from './client';
import { explainCommentError, type CommentActionResult, type WebhookSubscribeResult } from './comments-types';

export const FB_SUBSCRIBED_FIELDS = [
  'messages',
  'message_echoes',
  'message_reads',
  'message_reactions',
  'message_deliveries',
  'messaging_postbacks',
  'messaging_referrals',
  'messaging_optins',
  'feed',
] as const;

/**
 * ตอบใต้โพสต์ Facebook (คอมเมนต์ตอบคอมเมนต์)
 */
export async function replyToFacebookComment(
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
    error_th: explainCommentError(result.error.code, result.error.message_th, 'facebook'),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * ทักส่วนตัวจากคอมเมนต์ Facebook (Private Reply)
 * 🔴 Meta อนุญาตครั้งเดียวต่อคอมเมนต์ — ต้องผ่าน claim_private_reply ก่อนเสมอ
 */
export async function sendFacebookPrivateReply(
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
    error_th: explainCommentError(result.error.code, result.error.message_th, 'facebook'),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * ซ่อน / เลิกซ่อนคอมเมนต์บน Facebook
 */
export async function setFacebookCommentHidden(
  page: MetaPage,
  commentId: string,
  hidden: boolean,
): Promise<CommentActionResult> {
  const result = await metaPost(page, commentId, { is_hidden: hidden });
  if (result.ok) return { ok: true, id: commentId };
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th, 'facebook'),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * กดไลก์คอมเมนต์บน Facebook
 */
export async function likeFacebookComment(
  page: MetaPage,
  commentId: string,
): Promise<CommentActionResult> {
  const result = await metaPost(page, `${commentId}/likes`, {});
  if (result.ok) return { ok: true, id: commentId };
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th, 'facebook'),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * ลบคอมเมนต์บน Facebook
 */
export async function deleteFacebookComment(
  page: MetaPage,
  commentId: string,
): Promise<CommentActionResult> {
  const result = await metaDelete(page, commentId);
  if (result.ok) return { ok: true, id: commentId };
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th, 'facebook'),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * สมัครรับ Webhook สำหรับ Facebook Page (feed + messaging ทั้งหมดของ Production v1)
 */
export async function subscribeFacebookPageWebhooks(
  page: MetaPage,
): Promise<WebhookSubscribeResult> {
  const fields = [...FB_SUBSCRIBED_FIELDS];
  const result = await metaPost(page, `${page.page_id}/subscribed_apps`, {
    subscribed_fields: fields.join(','),
  });

  if (result.ok) {
    return { ok: true, subscribed_fields: fields };
  }
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th, 'facebook'),
  };
}
