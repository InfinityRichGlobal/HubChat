import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { testCommentBot } from '@/server/comments/bot';
import { CommentBotSettingsSchema } from '@/types/comment-bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const testSchema = z.object({
  comment_text: z.string().trim().min(1, 'กรุณาระบุข้อความคอมเมนต์'),
  commenter_name: z.string().trim().optional(),
  settings: CommentBotSettingsSchema.optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requirePermission('chat.reply');
    const body = testSchema.parse(await req.json());
    const result = await testCommentBot({
      comment_text: body.comment_text,
      commenter_name: body.commenter_name,
      settings: body.settings,
    });
    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
