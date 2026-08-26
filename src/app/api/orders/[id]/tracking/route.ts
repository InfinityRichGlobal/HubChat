/**
 * /api/orders/[id]/tracking — ใส่/แก้เลขพัสดุทีละใบ (รอบ 8)
 *
 * 🔴 แยกออกจาก PATCH /api/orders/[id] โดยตั้งใจ
 *    เลขพัสดุต้องมีร่องรอยครบเสมอ (ใครใส่ เมื่อไหร่ ค่าเดิมคืออะไร)
 *    ถ้าปล่อยให้แก้ผ่าน patch ทั่วไป จะมีเส้นทางที่ทับค่าเดิมแบบไม่มีร่องรอย
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { setOrderTracking, OrderAccessError, CatalogError } from '@/server/orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  tracking_no: z.string().trim().max(60).nullable(),
  carrier: z.string().trim().max(60).optional().nullable(),
});

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id } = await ctx.params;
    const body = schema.parse(await req.json());

    const order = await setOrderTracking(admin, id, {
      tracking_no: body.tracking_no,
      carrier: body.carrier ?? null,
    });
    return ok({ order });
  } catch (err) {
    if (err instanceof OrderAccessError) return fail('forbidden', err.message, 403);
    if (err instanceof CatalogError) return fail('invalid_tracking', err.message, 422);
    return toErrorResponse(err);
  }
}
