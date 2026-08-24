/** /api/promotions/[id] — แก้โปรโมชัน (เจ้าของเท่านั้น) */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { updatePromotion } from '@/server/orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: z.enum(['single', 'bundle', 'buy_x_get_y', 'boxset']).optional(),
  config: z.object({ pick: z.number().int().min(1).max(50).optional(), pay: z.number().int().min(1).max(50).optional() }).optional(),
  price: z.number().min(0).max(1000000).optional().nullable(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
  /** true = เก็บเข้ากรุ (ใช้แทนการลบ — ออเดอร์เก่าต้องไม่ขาดที่อ้างอิง) */
  archive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission('content.manage');
    const { id } = await ctx.params;
    const promotion = await updatePromotion(id, schema.parse(await req.json()));
    if (!promotion) return fail('not_found', 'ไม่พบโปรโมชันนี้', 404);
    return ok({ promotion });
  } catch (err) {
    return toErrorResponse(err);
  }
}
