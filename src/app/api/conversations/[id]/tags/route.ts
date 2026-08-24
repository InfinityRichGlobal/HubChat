/**
 * POST /api/conversations/[id]/tags — ใส่ / ถอดแท็กของห้องแชท
 *
 * ⚠️ ตรวจสิทธิ์เข้าถึงเพจของห้องนี้ก่อนเสมอ
 *    ไม่งั้นแอดมินที่ไม่มีสิทธิ์เห็นเพจหนึ่ง จะไปติดแท็กห้องของเพจนั้นได้
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { assertConversationAccess, InboxAccessError } from '@/server/inbox/service';
import { setConversationTag } from '@/server/content/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  tag_id: z.string().uuid('tag_id ไม่ถูกต้อง'),
  attached: z.boolean(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    const body = bodySchema.parse(await req.json());

    await assertConversationAccess(admin, id);
    await setConversationTag({
      conversation_id: id,
      tag_id: body.tag_id,
      admin_id: admin.id,
      attached: body.attached,
    });

    return ok({ tag_id: body.tag_id, attached: body.attached });
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
