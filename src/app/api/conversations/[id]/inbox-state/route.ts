import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { fail, ok, toErrorResponse } from '@/lib/api';
import { InboxAccessError } from '@/server/inbox/service';
import { InboxStateError, updateInboxState } from '@/server/inbox/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('important'), value: z.boolean() }),
  z.object({ action: z.literal('status'), value: z.enum(['active', 'done', 'spam']) }),
  z.object({ action: z.literal('assignment'), value: z.enum(['me', 'none']) }),
  z.object({ action: z.literal('confirm_spam_restored'), value: z.literal(true) }),
]);

export async function POST(req: Request, ctx: Ctx) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    const input = bodySchema.parse(await req.json());
    return ok(await updateInboxState(admin, id, input));
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    if (err instanceof InboxStateError) return fail(err.code, err.message, err.status);
    return toErrorResponse(err);
  }
}
