/** ส่งรูปจากลิงก์สาธารณะของชุดคำตอบ ผ่าน Policy Engine เส้นเดียวกับข้อความ */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { InboxAccessError, markRead } from '@/server/inbox/service';
import { sendImageUrl } from '@/server/messaging/send-image';
import { humanAdminReply, ProvenanceDeniedError } from '@/server/messaging/provenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  url: z.string().url().refine((value) => value.startsWith('https://'), 'รูปต้องเป็นลิงก์ https สาธารณะ'),
  idempotency_key: z.string().trim().min(8).max(120),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    const body = schema.parse(await req.json());
    await markRead(admin, id);

    const result = await sendImageUrl({
      conversation_id: id,
      provenance: await humanAdminReply(),
      url: body.url,
      idempotency_key: body.idempotency_key,
    });

    return ok({
      sent: result.sent,
      outcome_unknown: result.outcome_unknown,
      reason_th: result.reason_th,
      alternatives_th: result.decision.alternatives_th,
    });
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    if (err instanceof ProvenanceDeniedError) return fail('forbidden', err.message_th, 403);
    return toErrorResponse(err);
  }
}
