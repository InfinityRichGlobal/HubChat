/**
 * POST   /api/conversations/[id]/lock — ขอถือห้องแชทนี้ไว้ (สเปกหัวข้อ 5.1)
 * DELETE /api/conversations/[id]/lock — ปล่อยห้อง
 *
 * หน้าเว็บเรียก POST ซ้ำเป็นระยะระหว่างที่แอดมินยังเปิดห้องอยู่ = ต่ออายุล็อก
 * ถ้าปิดหน้าไปเฉย ๆ ล็อกจะหมดอายุเองใน 3 นาที ไม่ค้างถาวร
 */
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { acquireLock, InboxAccessError, releaseLock } from '@/server/inbox/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const result = await acquireLock(admin, id);
    // ตอบ 200 เสมอ — "คนอื่นถืออยู่" เป็นผลลัพธ์ปกติ ไม่ใช่ข้อผิดพลาด
    return ok(result);
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    await releaseLock(admin, id);
    return ok({ released: true });
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
