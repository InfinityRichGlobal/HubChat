import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { getComment } from '@/server/comments/service';
import { generateCommentReply } from '@/server/ai/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  mode: z.enum(['public', 'private']).default('public'),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    const comment = await getComment(admin, id);
    if (!comment.message) {
      return fail('empty_comment', 'คอมเมนต์นี้ไม่มีข้อความให้ AI วิเคราะห์', 400);
    }

    const suggestion = await generateCommentReply(comment.message, {
      fromName: comment.from_name,
      mode: body.mode,
    });

    return ok({ suggestion });
  } catch (err) {
    return toErrorResponse(err);
  }
}
