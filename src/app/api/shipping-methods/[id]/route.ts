/**
 * /api/shipping-methods/[id]
 * ⚠️ ไม่มี DELETE — ใช้ archive แทน
 *    ออเดอร์เก่าอ้างถึงวิธีจัดส่งนี้อยู่ ลบทิ้งแล้วประวัติจะขาด
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { updateShippingMethod, ShippingError } from '@/server/orders/shipping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  fee: z.number().min(0).max(100000).optional(),
  cod_supported: z.boolean().optional(),
  note: z.string().trim().max(300).optional().nullable(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  archive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission('content.manage');
    const { id } = await ctx.params;
    const method = await updateShippingMethod(id, schema.parse(await req.json()));
    if (!method) return fail('not_found', 'ไม่พบวิธีจัดส่งนี้', 404);
    return ok({ method });
  } catch (err) {
    if (err instanceof ShippingError) return fail('invalid_shipping', err.message, 422);
    return toErrorResponse(err);
  }
}
