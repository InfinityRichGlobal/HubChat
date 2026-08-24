/**
 * GET /api/conversations/[id]/messages — ข้อความในห้องแชท
 * เรียกซ้ำเป็นระยะจากหน้าเว็บเพื่อให้เห็นข้อความใหม่ (ดู DEFERRED_REVIEW D-21)
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { InboxAccessError, listMessages } from '@/server/inbox/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const limit = req.nextUrl.searchParams.get('limit');

    const messages = await listMessages(admin, id, limit ? Number(limit) : undefined);
    return ok({ messages });
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
