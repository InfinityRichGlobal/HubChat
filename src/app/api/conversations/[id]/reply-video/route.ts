import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { humanAdminReply, ProvenanceDeniedError } from '@/server/messaging/provenance';
import { sendVideo, ImageSendError, MAX_VIDEO_BYTES } from '@/server/messaging/send-image';
import { assertConversationAccess, InboxAccessError } from '@/server/inbox/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    await assertConversationAccess(admin, id);
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('no_file', 'ไม่พบวิดีโอที่แนบมา', 400);
    if (file.size > MAX_VIDEO_BYTES) return fail('too_large', `ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_VIDEO_BYTES / 1024 / 1024} MB)`, 413);

    const result = await sendVideo({
      conversation_id: id,
      provenance: await humanAdminReply(),
      file: { bytes: await file.arrayBuffer(), mime: file.type, filename: file.name || 'video', size: file.size },
      idempotency_key: String(form.get('idempotency_key') ?? '').trim() || null,
    });
    return ok({ sent: result.sent, outcome_unknown: result.outcome_unknown, reason_th: result.reason_th, alternatives_th: result.decision.alternatives_th });
  } catch (err) {
    if (err instanceof ImageSendError) return fail('video_failed', err.message_th, 422);
    if (err instanceof ProvenanceDeniedError) return fail('forbidden', err.message_th, 403);
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
