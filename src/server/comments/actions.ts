import 'server-only';
/**
 * แอดมินจัดการคอมเมนต์ (รอบ 9 — สเปกหัวข้อ 5.5 + 6.4)
 * ===========================================================================
 * 🔴 กฎเหล็กของไฟล์นี้ :
 *
 *   1. **ไม่มีการตอบอัตโนมัติ** — ทุกฟังก์ชันในนี้ถูกเรียกจาก API route
 *      ที่ตรวจ session ของแอดมินตัวจริงแล้วเท่านั้น
 *
 *   2. ⭐ "ทักส่วนตัว" ทำได้ครั้งเดียวต่อคอมเมนต์ตลอดกาล (กฎของ Meta)
 *      ต้องจองสิทธิ์กับฐานข้อมูล "ก่อน" ยิงเสมอ
 *      ถ้าจดทีหลัง สองคำขอพร้อมกันจะยิงทั้งคู่ → ลูกค้าได้ข้อความซ้ำ
 *
 *   3. ⚠️ ยิงแล้วไม่ทราบผล = **ห้ามคืนสิทธิ์** เด็ดขาด
 *      ยอมเสียสิทธิ์ทักส่วนตัวไป ดีกว่าลูกค้าได้ข้อความสองครั้ง
 *      (หลักการเดียวกับ outcome_unknown ของการส่งข้อความ)
 *
 *   4. ⚠️ ข้อความ "หลังจาก" ทักส่วนตัวสำเร็จ ต้องกลับไปผ่าน sendMessage() ตามปกติ
 *      เพราะตอนนั้นกรอบ 24 ชม. เปิดแล้ว และ Policy Engine เป็นคนตัดสิน
 */
import { createHash } from 'node:crypto';
import { db } from '@/lib/supabase/admin';
import type { PublicAdmin } from '@/types/db';
import { logActivity } from '@/lib/activity-log';
import {
  replyToCommentPublicly,
  sendPrivateReply,
  setCommentHidden,
  likeComment,
  unlikeComment,
  deleteComment,
  MetaNotConfiguredError,
} from '@/server/meta/comments';
import type { MetaPage } from '@/server/meta/comments';
import { CommentError, getComment, type CommentRow } from './service';

/** ความยาวสูงสุดของข้อความตอบ — Meta จำกัดไว้ และข้อความยาวเกินอ่านยากบนมือถือ */
export const MAX_REPLY_LENGTH = 1000;

async function loadPage(pageId: string): Promise<MetaPage> {
  const { data } = await db()
    .from('pages')
    .select('id,platform,page_id,access_token')
    .eq('id', pageId)
    .maybeSingle();
  if (!data) throw new CommentError('ไม่พบเพจของคอมเมนต์นี้');
  return data as MetaPage;
}

function validateText(text: string): string {
  const clean = text.trim();
  if (clean === '') throw new CommentError('ยังไม่ได้พิมพ์ข้อความ');
  if (clean.length > MAX_REPLY_LENGTH) {
    throw new CommentError(`ข้อความยาวเกิน ${MAX_REPLY_LENGTH} ตัวอักษร`);
  }
  return clean;
}

/* ------------------------------------------------------------------------ */
/* 1) ตอบใต้โพสต์                                                             */
/* ------------------------------------------------------------------------ */

export type ActionOutcome = {
  ok: boolean;
  message_th: string;
  outcome_unknown: boolean;
  comment: CommentRow;
};

/**
 * ตอบใต้โพสต์ — ทุกคนเห็นได้
 * ⚠️ ตอบซ้ำได้ (Meta ไม่ได้ห้าม) แต่เตือนแอดมินบนหน้าจอว่าเคยตอบไปแล้ว
 */
export async function replyPublic(
  admin: PublicAdmin,
  commentRowId: string,
  text: string,
  attachmentUrl?: string | null,
): Promise<ActionOutcome> {
  const comment = await getComment(admin, commentRowId); // ตรวจสิทธิ์เพจ
  const clean = validateText(text);

  if (comment.is_from_page) {
    throw new CommentError('คอมเมนต์นี้เป็นของเพจเราเอง ไม่ต้องตอบ');
  }

  if (comment.is_deleted) throw new CommentError('คอมเมนต์ถูกลบแล้ว');
  const page = await loadPage(comment.page_id);
  if (!page.access_token) throw new CommentError('เพจยังไม่มี token กรุณาตรวจการเชื่อมต่อ');
  const fingerprint = createHash('sha256').update(JSON.stringify([clean, attachmentUrl ?? null])).digest('hex');
  const ledger = () => db().from('comment_public_sends').select('state').eq('comment_id', commentRowId).eq('fingerprint', fingerprint).maybeSingle<{ state: string }>();
  const previous = await ledger();
  if (previous.error) throw new CommentError('ตรวจหลักฐานกันส่งซ้ำไม่สำเร็จ');
  if (previous.data?.state === 'succeeded' && comment.replied_public) return { ok: true, outcome_unknown: false, message_th: 'เคยส่งคำตอบนี้แล้ว ระบบไม่ได้ส่งซ้ำ', comment };
  if (previous.data?.state !== 'succeeded') {
    const claim = await db().rpc('claim_manual_public_reply', { p_comment_id: commentRowId, p_fingerprint: fingerprint, p_admin_id: admin.id });
    if (claim.error) throw new CommentError('จองสิทธิ์ตอบไม่สำเร็จ กรุณาตรวจฐานข้อมูล');
    if (!claim.data) throw new CommentError('มีการตอบนี้แล้วหรือมีคำตอบที่ยังไม่ทราบผล กรุณาตรวจโพสต์ต้นทางก่อน ไม่ส่งซ้ำ');
    let result;
    try { result = await replyToCommentPublicly(page, comment.comment_id, clean, attachmentUrl); }
    catch (err) {
      const knownUnsent = err instanceof MetaNotConfiguredError;
      const errorText = knownUnsent ? err.message : 'ไม่ทราบผลการตอบ กรุณาตรวจโพสต์ต้นทางก่อน ไม่ส่งซ้ำ';
      await db().from('comments').update({ last_error_th: errorText }).eq('id', commentRowId);
      await db().from('comment_public_sends').update({ state: knownUnsent ? 'rejected' : 'outcome_unknown' }).eq('comment_id', commentRowId).eq('fingerprint', fingerprint);
      return { ok: false, outcome_unknown: !knownUnsent, message_th: errorText, comment: { ...comment, last_error_th: errorText } };
    }
    const state = result.ok ? 'succeeded' : result.outcome_unknown ? 'outcome_unknown' : 'rejected';
    const recorded = await db().from('comment_public_sends').update({ state, updated_at: new Date().toISOString() }).eq('comment_id', commentRowId).eq('fingerprint', fingerprint);
    if (recorded.error) return unrecordedDelivery(comment);
    if (!result.ok) {
      await db().from('comments').update({ last_error_th: result.error_th }).eq('id', commentRowId);
      return { ok: false, outcome_unknown: result.outcome_unknown, message_th: result.error_th, comment: { ...comment, last_error_th: result.error_th } };
    }
  }
  // On retry after a database failure, only repair the receipt; never send again.
  const { error } = await db().rpc('finish_public_reply', {
    p_comment_row_id: commentRowId, p_admin_id: admin.id, p_text: clean,
  });
  if (error) return unrecordedDelivery(comment);

  await logActivity({
    adminId: admin.id,
    action: 'comment.reply_public',
    targetType: 'comment',
    targetId: commentRowId,
    detail: { page_id: comment.page_id, length: clean.length, has_attachment: Boolean(attachmentUrl) },
  });

  return {
    ok: true,
    message_th: 'ตอบใต้โพสต์แล้ว',
    outcome_unknown: false,
    comment: await getComment(admin, commentRowId).catch(() => ({ ...comment, replied_public: true, public_reply_text: clean, is_handled: true, last_error_th: null })),
  };
}

function unrecordedDelivery(comment: CommentRow): ActionOutcome {
  const message = 'Meta อาจรับข้อความแล้ว แต่บันทึกผลในระบบไม่สำเร็จ กรุณาตรวจต้นทางก่อน ไม่ส่งข้อความซ้ำ';
  return { ok: false, outcome_unknown: true, message_th: message, comment: { ...comment, last_error_th: message } };
}

/* ------------------------------------------------------------------------ */
/* 2) ⭐ ทักส่วนตัว — ครั้งเดียวต่อคอมเมนต์ตลอดกาล                                */
/* ------------------------------------------------------------------------ */

export async function replyPrivate(
  admin: PublicAdmin,
  commentRowId: string,
  text: string,
  attachmentUrl?: string | null,
): Promise<ActionOutcome> {
  const comment = await getComment(admin, commentRowId);
  const clean = validateText(text);
  if (comment.is_deleted) throw new CommentError('คอมเมนต์ถูกลบแล้ว');
  if (comment.is_from_page) throw new CommentError('คอมเมนต์นี้เป็นของเพจเราเอง ไม่ต้องตอบ');
  const page = await loadPage(comment.page_id);
  if (!page.access_token) throw new CommentError('เพจยังไม่มี token กรุณาตรวจการเชื่อมต่อ');

  /**
   * ⭐ จองสิทธิ์ "ก่อน" ยิงเสมอ
   *    ฐานข้อมูลเป็นคนตัดสินว่าใครได้ยิง ไม่ใช่จังหวะของ JavaScript
   *    (เช็คทั้ง "เคยตอบไปแล้วไหม" และ "เกิน 7 วันหรือยัง" ในคำสั่งเดียว)
   */
  const { data: claimData, error: claimErr } = await db().rpc('claim_private_reply', {
    p_comment_row_id: commentRowId,
    p_admin_id: admin.id,
  });
  if (claimErr) throw new CommentError(`จองสิทธิ์ทักส่วนตัวไม่สำเร็จ: ${claimErr.message}`);

  const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as
    | { won: boolean; reason_th: string | null }
    | undefined;

  if (!claim?.won) {
    throw new CommentError(claim?.reason_th ?? 'ทักส่วนตัวไม่ได้');
  }

  let result;
  try { result = await sendPrivateReply(page, comment.comment_id, clean, attachmentUrl); }
  catch (err) {
    if (err instanceof MetaNotConfiguredError) {
      await db().rpc('release_private_reply', { p_comment_row_id: commentRowId, p_error_th: err.message });
      throw new CommentError(err.message);
    }
    return unrecordedDelivery(comment);
  }

  if (!result.ok) {
    /**
     * 🔴 จุดที่ห้ามพลาดที่สุดของทั้งรอบ
     *    คืนสิทธิ์ได้เฉพาะกรณีที่ "รู้แน่ชัดว่า Meta ปฏิเสธ" เท่านั้น
     *    ถ้าไม่ทราบผล (เน็ตขาดกลางทาง) ข้อความอาจถึงลูกค้าไปแล้ว
     *    การคืนสิทธิ์ = เปิดทางให้ยิงซ้ำ = ลูกค้าได้ข้อความสองครั้ง
     */
    if (!result.outcome_unknown) {
      const { error } = await db().rpc('release_private_reply', {
        p_comment_row_id: commentRowId,
        p_error_th: result.error_th,
      });
      if (error) console.error(`[comments] คืนสิทธิ์ทักส่วนตัวไม่สำเร็จ: ${error.message}`);
    } else {
      await db()
        .from('comments')
        .update({
          last_error_th:
            '⚠️ ยิงออกไปแล้วแต่ไม่ทราบผล — ข้อความอาจถึงลูกค้าแล้ว ระบบจึงไม่เปิดให้ทักซ้ำ',
        })
        .eq('id', commentRowId);
      console.warn(
        `[comments] ⚠️ ไม่ทราบผลการทักส่วนตัว (comment=${commentRowId}) — ไม่คืนสิทธิ์โดยตั้งใจ`,
      );
    }

    return {
      ok: false,
      message_th: result.outcome_unknown
        ? 'ยิงออกไปแล้วแต่ไม่ทราบผล — เปิด Messenger ดูก่อนว่าข้อความถึงลูกค้าหรือยัง'
        : result.error_th,
      outcome_unknown: result.outcome_unknown,
      comment: await getComment(admin, commentRowId).catch(() => ({ ...comment, last_error_th: result.error_th })),
    };
  }

  /**
   * ⭐ ทักสำเร็จ = ลูกค้าจะทักกลับมาในอินบ็อกซ์
   *    ห้องแชทจะถูกสร้างโดยสายรับข้อความตามปกติ (ไม่สร้างเองที่นี่)
   *    เราแค่จดว่าคอมเมนต์นี้จัดการแล้ว และผูกกับห้องถ้าหาเจอ
   */
  const linked = await findConversationByCommenter(comment.page_id, comment.from_id);

  const { error } = await db().rpc('finish_private_reply', {
    p_comment_row_id: commentRowId,
    p_text: clean,
    p_conversation_id: linked?.conversation_id ?? null,
    p_customer_id: linked?.customer_id ?? null,
  });
  if (error) return unrecordedDelivery(comment);

  await logActivity({
    adminId: admin.id,
    action: 'comment.reply_private',
    targetType: 'comment',
    targetId: commentRowId,
    detail: { page_id: comment.page_id, linked_conversation: linked?.conversation_id ?? null },
  });

  return {
    ok: true,
    message_th: 'ทักส่วนตัวแล้ว — เมื่อลูกค้าตอบกลับ แชทจะขึ้นในอินบ็อกซ์',
    outcome_unknown: false,
    comment: await getComment(admin, commentRowId).catch(() => ({ ...comment, replied_private: true, private_reply_text: clean, is_handled: true, last_error_th: null })),
  };
}

/**
 * หาห้องแชทของคนคอมเมนต์
 * ⚠️ psid ของ Messenger กับ id ของคนคอมเมนต์เป็นคนละเลขกันในหลายกรณี
 *    จึงหาเจอบ้างไม่เจอบ้าง — หาไม่เจอไม่ใช่ความผิดพลาด
 */
async function findConversationByCommenter(
  pageId: string,
  fromId: string | null,
): Promise<{ conversation_id: string; customer_id: string } | null> {
  if (!fromId) return null;

  const { data: customer } = await db()
    .from('customers')
    .select('id')
    .eq('page_id', pageId)
    .eq('psid', fromId)
    .maybeSingle();
  if (!customer) return null;

  const customerId = (customer as { id: string }).id;
  const { data: conv } = await db()
    .from('conversations')
    .select('id')
    .eq('customer_id', customerId)
    .maybeSingle();
  if (!conv) return null;

  return { conversation_id: (conv as { id: string }).id, customer_id: customerId };
}

/* ------------------------------------------------------------------------ */
/* 3) ซ่อนคอมเมนต์                                                            */
/* ------------------------------------------------------------------------ */

export async function hideComment(
  admin: PublicAdmin,
  commentRowId: string,
  hidden: boolean,
): Promise<ActionOutcome> {
  const comment = await getComment(admin, commentRowId);
  const page = await loadPage(comment.page_id);

  const result = await setCommentHidden(page, comment.comment_id, hidden);
  if (!result.ok) {
    await db().from('comments').update({ last_error_th: result.error_th }).eq('id', commentRowId);
    return {
      ok: false,
      message_th: result.error_th,
      outcome_unknown: result.outcome_unknown,
      comment: await getComment(admin, commentRowId),
    };
  }

  await db()
    .from('comments')
    .update({
      is_hidden: hidden,
      is_handled: true,
      handled_by: admin.id,
      handled_at: new Date().toISOString(),
      last_error_th: null,
    })
    .eq('id', commentRowId);

  await logActivity({
    adminId: admin.id,
    action: hidden ? 'comment.hide' : 'comment.unhide',
    targetType: 'comment',
    targetId: commentRowId,
  });

  return {
    ok: true,
    message_th: hidden ? 'ซ่อนคอมเมนต์แล้ว' : 'เลิกซ่อนแล้ว',
    outcome_unknown: false,
    comment: await getComment(admin, commentRowId),
  };
}

/* ------------------------------------------------------------------------ */
/* 4) ไลก์คอมเมนต์                                                            */
/* ------------------------------------------------------------------------ */

export async function likeCommentAction(
  admin: PublicAdmin,
  commentRowId: string,
): Promise<ActionOutcome> {
  const comment = await getComment(admin, commentRowId);
  const page = await loadPage(comment.page_id);

  const result = await likeComment(page, comment.comment_id);
  if (!result.ok) {
    await db().from('comments').update({ last_error_th: result.error_th }).eq('id', commentRowId);
    return {
      ok: false,
      message_th: result.error_th,
      outcome_unknown: result.outcome_unknown,
      comment: await getComment(admin, commentRowId),
    };
  }

  await db()
    .from('comments')
    .update({
      is_liked: true,
      last_error_th: null,
    })
    .eq('id', commentRowId);

  await logActivity({
    adminId: admin.id,
    action: 'comment.like',
    targetType: 'comment',
    targetId: commentRowId,
  });

  return {
    ok: true,
    message_th: 'กดไลก์คอมเมนต์แล้ว',
    outcome_unknown: false,
    comment: await getComment(admin, commentRowId),
  };
}

/* ------------------------------------------------------------------------ */
/* 5) ยกเลิกไลก์คอมเมนต์                                                       */
/* ------------------------------------------------------------------------ */

export async function unlikeCommentAction(
  admin: PublicAdmin,
  commentRowId: string,
): Promise<ActionOutcome> {
  const comment = await getComment(admin, commentRowId);
  const page = await loadPage(comment.page_id);

  const result = await unlikeComment(page, comment.comment_id);
  if (!result.ok) {
    await db().from('comments').update({ last_error_th: result.error_th }).eq('id', commentRowId);
    return {
      ok: false,
      message_th: result.error_th,
      outcome_unknown: result.outcome_unknown,
      comment: await getComment(admin, commentRowId),
    };
  }

  await db()
    .from('comments')
    .update({
      is_liked: false,
      last_error_th: null,
    })
    .eq('id', commentRowId);

  await logActivity({
    adminId: admin.id,
    action: 'comment.unlike',
    targetType: 'comment',
    targetId: commentRowId,
  });

  return {
    ok: true,
    message_th: 'ยกเลิกไลก์คอมเมนต์แล้ว',
    outcome_unknown: false,
    comment: await getComment(admin, commentRowId),
  };
}

/* ------------------------------------------------------------------------ */
/* 6) ลบคอมเมนต์                                                              */
/* ------------------------------------------------------------------------ */

export async function deleteCommentAction(
  admin: PublicAdmin,
  commentRowId: string,
): Promise<ActionOutcome> {
  const comment = await getComment(admin, commentRowId);
  const page = await loadPage(comment.page_id);

  const result = await deleteComment(page, comment.comment_id);
  if (!result.ok) {
    await db().from('comments').update({ last_error_th: result.error_th }).eq('id', commentRowId);
    return {
      ok: false,
      message_th: result.error_th,
      outcome_unknown: result.outcome_unknown,
      comment: await getComment(admin, commentRowId),
    };
  }

  await db()
    .from('comments')
    .update({
      is_deleted: true,
      is_handled: true,
      handled_by: admin.id,
      handled_at: new Date().toISOString(),
      last_error_th: null,
    })
    .eq('id', commentRowId);

  await logActivity({
    adminId: admin.id,
    action: 'comment.delete',
    targetType: 'comment',
    targetId: commentRowId,
  });

  return {
    ok: true,
    message_th: 'ลบคอมเมนต์แล้ว',
    outcome_unknown: false,
    comment: await getComment(admin, commentRowId),
  };
}

export { MetaNotConfiguredError };
