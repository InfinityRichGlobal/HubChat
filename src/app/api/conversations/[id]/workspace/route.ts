/**
 * GET /api/conversations/[id]/workspace — ข้อมูลลูกค้า + ออเดอร์ + บันทึก (ข้อ 1.6 / 1.11)
 * ⚠️ ด่านสิทธิ์รายเพจอยู่ในชั้น server/customers/workspace ไม่ใช่ที่นี่
 */
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { InboxAccessError } from '@/server/inbox/service';
import { loadWorkspace } from '@/server/customers/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    return ok(await loadWorkspace(admin, id));
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
