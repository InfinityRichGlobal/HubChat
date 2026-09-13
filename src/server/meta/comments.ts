import 'server-only';
/**
 * คุยกับ Meta เรื่องคอมเมนต์ (Platform-Aware Comment Adapter)
 * ===========================================================================
 * ⭐ รวมศูนย์การจัดการคอมเมนต์ทั้ง Facebook และ Instagram:
 *    - ตรวจสอบ Platform ของเพจ (facebook vs instagram)
 *    - ส่งต่องานไปยัง adapter ที่ถูกต้องตาม API contract ของแต่ละแพลตฟอร์ม
 *    - มี Platform Capability Matrix ชัดเจน
 *    - กฎสถาปัตยกรรม: การยิง HTTP ทั้งหมดอยู่ภายใต้ server/meta เท่านั้น
 */
import { MetaNotConfiguredError, type MetaPage } from './client';
import {
  type CommentActionResult,
  type WebhookSubscribeResult,
  type CommentPlatformCapabilities,
  COMMENT_CAPABILITIES,
  explainCommentError,
} from './comments-types';
import {
  replyToFacebookComment,
  sendFacebookPrivateReply,
  setFacebookCommentHidden,
  likeFacebookComment,
  deleteFacebookComment,
  subscribeFacebookPageWebhooks,
  fetchFacebookRecentComments,
  FB_SUBSCRIBED_FIELDS,
} from './facebook-comments';
import {
  replyToInstagramComment,
  sendInstagramPrivateReply,
  setInstagramCommentHidden,
  likeInstagramComment,
  unlikeInstagramComment,
  deleteInstagramComment,
  subscribeInstagramPageWebhooks,
  fetchInstagramRecentComments,
  IG_SUBSCRIBED_FIELDS,
} from './instagram-comments';

export type {
  CommentActionResult,
  WebhookSubscribeResult,
  CommentPlatformCapabilities,
  MetaPage,
};
export {
  COMMENT_CAPABILITIES,
  explainCommentError,
  MetaNotConfiguredError,
  FB_SUBSCRIBED_FIELDS,
  IG_SUBSCRIBED_FIELDS,
};

/**
 * ตอบใต้โพสต์ (Public Reply) — รองรับทั้ง Facebook และ Instagram
 */
export async function replyToCommentPublicly(
  page: MetaPage,
  commentId: string,
  message: string,
  attachmentUrl?: string | null,
): Promise<CommentActionResult> {
  if (page.platform === 'instagram') {
    return replyToInstagramComment(page, commentId, message);
  }
  return replyToFacebookComment(page, commentId, message, attachmentUrl);
}

/**
 * ทักส่วนตัวจากคอมเมนต์ (Private Reply) — รองรับทั้ง Facebook และ Instagram
 * 🔴 Meta อนุญาตครั้งเดียวต่อคอมเมนต์ภายใน 7 วัน — ต้องจองสิทธิ์กับฐานข้อมูลก่อนเรียกเสมอ
 */
export async function sendPrivateReply(
  page: MetaPage,
  commentId: string,
  message: string,
  attachmentUrl?: string | null,
): Promise<CommentActionResult> {
  if (page.platform === 'instagram') {
    return sendInstagramPrivateReply(page, commentId, message, attachmentUrl);
  }
  return sendFacebookPrivateReply(page, commentId, message, attachmentUrl);
}

/**
 * ซ่อน / เลิกซ่อนคอมเมนต์ — รองรับทั้ง Facebook และ Instagram
 */
export async function setCommentHidden(
  page: MetaPage,
  commentId: string,
  hidden: boolean,
): Promise<CommentActionResult> {
  if (page.platform === 'instagram') {
    return setInstagramCommentHidden(page, commentId, hidden);
  }
  return setFacebookCommentHidden(page, commentId, hidden);
}

/**
 * กดไลก์คอมเมนต์ — รองรับทั้ง Facebook และ Instagram
 */
export async function likeComment(
  page: MetaPage,
  commentId: string,
): Promise<CommentActionResult> {
  if (page.platform === 'instagram') {
    return likeInstagramComment(page, commentId);
  }
  return likeFacebookComment(page, commentId);
}

/**
 * ยกเลิกไลก์คอมเมนต์ — เฉพาะ Instagram (Facebook API ไม่รองรับ unlike)
 */
export async function unlikeComment(
  page: MetaPage,
  commentId: string,
): Promise<CommentActionResult> {
  if (page.platform === 'instagram') {
    return unlikeInstagramComment(page, commentId);
  }
  return {
    ok: false,
    error_th: 'Facebook ไม่รองรับการยกเลิกไลก์คอมเมนต์ผ่าน Graph API',
    outcome_unknown: false,
  };
}

/**
 * ลบคอมเมนต์ — รองรับทั้ง Facebook และ Instagram
 */
export async function deleteComment(
  page: MetaPage,
  commentId: string,
): Promise<CommentActionResult> {
  if (page.platform === 'instagram') {
    return deleteInstagramComment(page, commentId);
  }
  return deleteFacebookComment(page, commentId);
}

/**
 * เชื่อมต่อ Webhook สำหรับเพจ (แยก fields ตาม Facebook และ Instagram อย่างถูกต้อง)
 */
export async function subscribePageWebhooks(
  page: MetaPage,
): Promise<WebhookSubscribeResult> {
  if (page.platform === 'instagram') {
    return subscribeInstagramPageWebhooks(page);
  }
  return subscribeFacebookPageWebhooks(page);
}

/**
 * ดึงคอมเมนต์ล่าสุดจากหน้าเพจโดยตรง (แยกตาม platform)
 */
export async function fetchPageRecentComments(
  page: MetaPage,
  limit = 5,
) {
  if (page.platform === 'instagram') {
    return fetchInstagramRecentComments(page, limit);
  }
  return fetchFacebookRecentComments(page, limit);
}
