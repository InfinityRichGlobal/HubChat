import 'server-only';
/**
 * Facebook Comments Adapter
 * ===========================================================================
 * ฟังก์ชันเฉพาะสำหรับจัดการคอมเมนต์บน Facebook Page
 * เรียกใช้งานผ่าน client กลาง (server/meta/client.ts) เท่านั้น
 */
import { metaPost, metaDelete, metaGet, type MetaPage } from './client';
import { explainCommentError, type CommentActionResult, type WebhookSubscribeResult, type FetchedComment } from './comments-types';

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
  attachmentUrl?: string | null,
): Promise<CommentActionResult> {
  const payload: Record<string, unknown> = { message };
  if (attachmentUrl) {
    payload.attachment_url = attachmentUrl;
  }
  const result = await metaPost(page, `${commentId}/comments`, payload);
  if (result.ok) {
    const id = (result.data as { id?: string } | null)?.id ?? null;
    return { ok: true, id };
  }
  console.error(`[fb-comments] ตอบใต้โพสต์ ${commentId} ไม่สำเร็จ:`, {
    code: result.error.code, message: result.error.message, fbtrace: result.error.fbtrace_id,
  });
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th, 'facebook', result.error.message),
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
  console.error(`[fb-comments] ทักส่วนตัว ${commentId} ไม่สำเร็จ:`, {
    code: result.error.code, message: result.error.message, fbtrace: result.error.fbtrace_id,
  });
  return {
    ok: false,
    error_th: explainCommentError(result.error.code, result.error.message_th, 'facebook', result.error.message),
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
    error_th: explainCommentError(result.error.code, result.error.message_th, 'facebook', result.error.message),
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
    error_th: explainCommentError(result.error.code, result.error.message_th, 'facebook', result.error.message),
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
    error_th: explainCommentError(result.error.code, result.error.message_th, 'facebook', result.error.message),
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
    error_th: explainCommentError(result.error.code, result.error.message_th, 'facebook', result.error.message),
  };
}

/**
 * ดึงโพสต์และคอมเมนต์ล่าสุดจาก Facebook Page โดยตรง
 */
export async function fetchFacebookRecentComments(
  page: MetaPage,
  limitPosts = 5,
): Promise<{ ok: boolean; comments: FetchedComment[]; error_th?: string }> {
  const res = await metaGet(page, `${page.page_id}/feed`, {
    fields: 'id,message,permalink_url,comments.order(reverse_chronological).limit(25){id,message,from{id,name,picture},created_time,permalink_url,parent}',
    limit: String(limitPosts),
  });

  if (!res.ok) {
    return {
      ok: false,
      comments: [],
      error_th: explainCommentError(res.error.code, res.error.message_th, 'facebook', res.error.message),
    };
  }

  const posts = ((res.data.data as Array<{
    id: string;
    permalink_url?: string;
    comments?: {
      data?: Array<{
        id?: string;
        message?: string;
        from?: { id?: string; name?: string; picture?: { data?: { url?: string } } };
        created_time?: string;
        permalink_url?: string;
        parent?: { id?: string };
      }>;
    };
  }>) || []);

  const comments: FetchedComment[] = [];
  for (const post of posts) {
    const rawComments = post.comments?.data || [];
    for (const c of rawComments) {
      if (!c.id) continue;
      comments.push({
        id: c.id,
        post_id: post.id,
        message: c.message ?? '',
        from_id: c.from?.id ?? null,
        from_name: c.from?.name ?? null,
        created_time: c.created_time ?? new Date().toISOString(),
        permalink_url: c.permalink_url ?? post.permalink_url,
        parent_id: c.parent?.id ?? null,
      });
    }
  }

  return { ok: true, comments };
}
