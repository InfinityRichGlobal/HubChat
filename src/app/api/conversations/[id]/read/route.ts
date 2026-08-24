/**
 * POST /api/conversations/[id]/read — ทำเครื่องหมายว่าอ่านแล้ว
 */
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { InboxAccessError, markRead } from '@/server/inbox/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    await markRead(admin, id);
    return ok({ is_read: true });
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
