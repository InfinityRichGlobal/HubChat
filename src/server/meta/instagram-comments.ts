import 'server-only';
/**
 * Instagram Comments Adapter
 * ===========================================================================
 * ฟังก์ชันเฉพาะสำหรับจัดการคอมเมนต์บน Instagram Professional Account
 * เรียกใช้งานผ่าน client กลาง (server/meta/client.ts) เท่านั้น
 */
import { metaPost, metaDelete, metaGet, type MetaPage } from './client';
import { explainCommentError, type CommentActionResult, type WebhookSubscribeResult, type FetchedComment } from './comments-types';

export const IG_SUBSCRIBED_FIELDS = [
  'messages',
  'messaging_postbacks',
  'messaging_seen',
  'message_reactions',
  'messaging_referral',
  'messaging_optins',
  'comments',
] as const;

/**
 * ตอบใต้คอมเมนต์บน Instagram (POST /{comment-id}/replies)
 * สิทธิ์ที่ต้องใช้: instagram_manage_comments
 */
export async function replyToInstagramComment(
  page: MetaPage,
  commentId: string,
  message: string,
): Promise<CommentActionResult> {
  const result = await metaPost(page, `${commentId}/replies`, { message });
  if (result.ok) {
    const id = (result.data as { id?: string } | null)?.id ?? null;
    return { ok: true, id };
  }
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th, 'instagram', result.error.message),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * ทักส่วนตัวจากคอมเมนต์ Instagram (Private Reply)
 * กฎของ Meta:
 *   • ทำได้ครั้งเดียวต่อคอมเมนต์ภายใน 7 วัน
 *   • ส่งผ่าน Messenger API for Instagram (Send API) ด้วย recipient: { comment_id }
 *   • สิทธิ์ที่ต้องใช้: instagram_manage_messages
 */
export async function sendInstagramPrivateReply(
  page: MetaPage,
  commentId: string,
  message: string,
  attachmentUrl?: string | null,
): Promise<CommentActionResult> {
  let text = message;
  if (attachmentUrl) {
    text = `${message}\n\n🖼️ แนบภาพ: ${attachmentUrl}`;
  }
  const payload = {
    recipient: { comment_id: commentId },
    message: { text },
  };
  const result = await metaPost(page, `${page.page_id}/messages`, payload);
  if (result.ok) {
    const id =
      (result.data as { message_id?: string; id?: string } | null)?.message_id ??
      (result.data as { id?: string } | null)?.id ??
      null;
    return { ok: true, id };
  }

  // แปลผล error เฉพาะของ Instagram private reply
  let errorMsg = explainCommentError(result.error.code, result.error.message_th, 'instagram');
  if (result.error.code === 100 || result.error.code === 10) {
    errorMsg = 'Meta ไม่อนุญาตให้ทักส่วนตัวจากคอมเมนต์นี้ (อาจเกิน 7 วัน หรือผู้ใช้ปิดรับข้อความ)';
  }

  return {
    ok: false,
    error_th: errorMsg,
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * ซ่อน / เลิกซ่อนคอมเมนต์บน Instagram (POST /{comment-id}?hide=true|false)
 * สิทธิ์ที่ต้องใช้: instagram_manage_comments
 */
export async function setInstagramCommentHidden(
  page: MetaPage,
  commentId: string,
  hidden: boolean,
): Promise<CommentActionResult> {
  const result = await metaPost(page, `${commentId}?hide=${hidden}`, {});
  if (result.ok) return { ok: true, id: commentId };
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th, 'instagram', result.error.message),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * กดไลก์คอมเมนต์บน Instagram (POST /{comment-id}/likes)
 * สิทธิ์ที่ต้องใช้: instagram_manage_engagement
 */
export async function likeInstagramComment(
  page: MetaPage,
  commentId: string,
): Promise<CommentActionResult> {
  const result = await metaPost(page, `${commentId}/likes`, {});
  if (result.ok) return { ok: true, id: commentId };
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th, 'instagram', result.error.message),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * ยกเลิกไลก์คอมเมนต์บน Instagram (DELETE /{comment-id}/likes)
 * สิทธิ์ที่ต้องใช้: instagram_manage_engagement
 */
export async function unlikeInstagramComment(
  page: MetaPage,
  commentId: string,
): Promise<CommentActionResult> {
  const result = await metaDelete(page, `${commentId}/likes`);
  if (result.ok) return { ok: true, id: commentId };
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th, 'instagram', result.error.message),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * ลบคอมเมนต์บน Instagram (DELETE /{comment-id})
 * สิทธิ์ที่ต้องใช้: instagram_manage_comments
 */
export async function deleteInstagramComment(
  page: MetaPage,
  commentId: string,
): Promise<CommentActionResult> {
  const result = await metaDelete(page, commentId);
  if (result.ok) return { ok: true, id: commentId };
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th, 'instagram', result.error.message),
    outcome_unknown: result.error.kind === 'ambiguous',
  };
}

/**
 * สมัครรับ Webhook สำหรับ Instagram (comments + messages ทั้งหมดของ Production v1)
 */
export async function subscribeInstagramPageWebhooks(
  page: MetaPage,
): Promise<WebhookSubscribeResult> {
  const fields = [...IG_SUBSCRIBED_FIELDS];
  const result = await metaPost(page, `${page.page_id}/subscribed_apps`, {
    subscribed_fields: fields.join(','),
  });

  if (result.ok) {
    return { ok: true, subscribed_fields: fields };
  }
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th, 'instagram', result.error.message),
  };
}

/**
 * ดึงโพสต์และคอมเมนต์ล่าสุดจาก Instagram Professional Account โดยตรง
 */
export async function fetchInstagramRecentComments(
  page: MetaPage,
  limitMedia = 5,
): Promise<{ ok: boolean; comments: FetchedComment[]; error_th?: string }> {
  const res = await metaGet(page, `${page.page_id}/media`, {
    fields: 'id,caption,timestamp,comments.limit(25){id,text,from,timestamp}',
    limit: String(limitMedia),
  });

  if (!res.ok) {
    return {
      ok: false,
      comments: [],
      error_th: explainCommentError(res.error.code, res.error.message_th, 'instagram', res.error.message),
    };
  }

  const mediaList = ((res.data.data as Array<{
    id: string;
    comments?: {
      data?: Array<{
        id?: string;
        text?: string;
        from?: { id?: string; username?: string };
        timestamp?: string;
      }>;
    };
  }>) || []);

  const comments: FetchedComment[] = [];
  for (const m of mediaList) {
    const rawComments = m.comments?.data || [];
    for (const c of rawComments) {
      if (!c.id) continue;
      comments.push({
        id: c.id,
        post_id: m.id,
        message: c.text ?? '',
        from_id: c.from?.id ?? null,
        from_name: c.from?.username ?? null,
        from_username: c.from?.username ?? null,
        created_time: c.timestamp ?? new Date().toISOString(),
        permalink_url: undefined,
        parent_id: null,
      });
    }
  }

  return { ok: true, comments };
}
