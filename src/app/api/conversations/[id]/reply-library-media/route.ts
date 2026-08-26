import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { fail, ok, toErrorResponse } from '@/lib/api';
import { assertConversationAccess, InboxAccessError } from '@/server/inbox/service';
import { humanAdminReply, ProvenanceDeniedError } from '@/server/messaging/provenance';
import {
  ImageSendError, sendImage, sendVideo,
} from '@/server/messaging/send-image';
import { getMediaAsset } from '@/server/storage/media';
import { extensionFor, getObject, StorageNotConfiguredError } from '@/server/storage/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  media_id: z.string().uuid(),
  idempotency_key: z.string().trim().min(8).max(120),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    await assertConversationAccess(admin, id);
    const input = schema.parse(await req.json());

    const asset = await getMediaAsset(input.media_id);
    if (!asset || asset.kind !== 'library' || asset.status !== 'stored' || !asset.storage_key || !asset.mime) {
      return fail('media_not_found', 'ไม่พบไฟล์นี้ในคลัง หรือไฟล์ยังไม่พร้อมใช้งาน', 404);
    }

    const stored = await getObject(asset.storage_key);
    if (!stored) return fail('media_missing', 'ไฟล์ในคลังหายจากที่เก็บ กรุณาอัปโหลดใหม่', 410);
    const mime = asset.mime || stored.mime;
    const file = {
      bytes: stored.body,
      mime,
      filename: `library-${asset.id}.${extensionFor(mime)}`,
      size: stored.body.byteLength,
    };
    const provenance = await humanAdminReply();
    const result = mime.startsWith('video/')
      ? await sendVideo({ conversation_id: id, provenance, file, idempotency_key: input.idempotency_key })
      : mime.startsWith('image/')
        ? await sendImage({ conversation_id: id, provenance, file, idempotency_key: input.idempotency_key })
        : null;

    if (!result) return fail('unsupported', 'ไฟล์นี้ไม่ใช่รูปหรือวิดีโอที่ส่งผ่าน Meta ได้', 422);
    return ok({
      sent: result.sent,
      outcome_unknown: result.outcome_unknown,
      reason_th: result.reason_th,
      alternatives_th: result.decision.alternatives_th,
    });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return fail('storage_not_configured', 'ยังไม่ได้ตั้งค่า Cloudflare R2', 503);
    if (err instanceof ImageSendError) return fail('media_failed', err.message_th, 422);
    if (err instanceof ProvenanceDeniedError) return fail('forbidden', err.message_th, 403);
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
