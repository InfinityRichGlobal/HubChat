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
    const sp = req.nextUrl.searchParams;
    const limit = sp.get('limit');
    // cursor = เวลาของข้อความที่เก่าที่สุดที่หน้าเว็บถืออยู่ (ขอของเก่ากว่านั้น)
    const before = sp.get('before');

    const page = await listMessages(
      admin,
      id,
      limit ? Number(limit) : undefined,
      before,
    );
    return ok({ messages: page.messages, has_more: page.has_more });
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
