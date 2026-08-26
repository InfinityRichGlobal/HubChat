import 'server-only';

import { db } from '@/lib/supabase/admin';
import { moveConversationToMetaSpam } from '@/server/meta/moderation';
import type { PublicAdmin } from '@/types/db';
import { requireConversationAccess } from './service';

export type InboxStateInput =
  | { action: 'important'; value: boolean }
  | { action: 'status'; value: 'active' | 'done' | 'spam' }
  | { action: 'assignment'; value: 'me' | 'none' }
  | { action: 'confirm_spam_restored'; value: true };

export class InboxStateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export async function updateInboxState(
  admin: PublicAdmin,
  conversationId: string,
  input: InboxStateInput,
): Promise<Record<string, unknown>> {
  const access = await requireConversationAccess(admin, conversationId);

  if (input.action === 'confirm_spam_restored') {
    await updateConversation(conversationId, admin.id, {
      inbox_status: 'active',
      meta_spam_synced_at: null,
    });
    return { inbox_status: 'active', meta_spam_synced_at: null, sync: 'confirmed_manually' };
  }

  if (input.action === 'important') {
    await updateConversation(conversationId, admin.id, { is_important: input.value });
    return { is_important: input.value, sync: 'hubchat' };
  }

  if (input.action === 'assignment') {
    const assignedAdminId = input.value === 'me' ? admin.id : null;
    await updateConversation(conversationId, admin.id, { assigned_admin_id: assignedAdminId });
    return { assigned_admin_id: assignedAdminId, sync: 'hubchat' };
  }

  if (input.value === 'spam') {
    const result = await moveConversationToMetaSpam(access.page_id, access.customer_id);
    if (!result.ok) {
      const unknown = result.error.kind === 'ambiguous';
      throw new InboxStateError(
        unknown ? 'meta_outcome_unknown' : 'meta_rejected',
        unknown
          ? 'ส่งคำสั่งไป Meta แล้วแต่ไม่ทราบผล กรุณาตรวจใน Business Suite ก่อนกดซ้ำ'
          : `Meta ไม่รับคำสั่งย้ายไปสแปม: ${result.error.message_th}`,
        unknown ? 409 : 422,
      );
    }

    const syncedAt = new Date().toISOString();
    await updateConversation(conversationId, admin.id, {
      inbox_status: 'spam',
      meta_spam_synced_at: syncedAt,
    });
    return { inbox_status: 'spam', meta_spam_synced_at: syncedAt, sync: 'meta' };
  }

  if (input.value === 'active') {
    const { data, error } = await db()
      .from('conversations')
      .select('inbox_status')
      .eq('id', conversationId)
      .maybeSingle();
    if (error) throw new Error(`อ่านสถานะห้องแชทไม่สำเร็จ: ${error.message}`);
    if ((data as { inbox_status?: string } | null)?.inbox_status === 'spam') {
      throw new InboxStateError(
        'meta_restore_unsupported',
        'Meta ไม่มี API สำหรับย้ายออกจากสแปม กรุณาคืนแชทใน Business Suite ก่อน แล้วจึงใช้งานต่อ',
        409,
      );
    }
  }

  await updateConversation(conversationId, admin.id, { inbox_status: input.value });
  return { inbox_status: input.value, sync: 'hubchat' };
}

async function updateConversation(
  conversationId: string,
  adminId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } = await db()
    .from('conversations')
    .update({
      ...values,
      inbox_state_updated_at: new Date().toISOString(),
      inbox_state_updated_by: adminId,
    })
    .eq('id', conversationId);
  if (error) throw new Error(`บันทึกกลุ่มแชทไม่สำเร็จ: ${error.message}`);
}
