/** /api/products/[id] — แก้สินค้า (เจ้าของเท่านั้น) */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { updateProduct } from '@/server/orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  variant: z.string().trim().max(60).optional().nullable(),
  sku: z.string().trim().max(60).optional().nullable(),
  price: z.number().min(0).max(1000000).optional(),
  image_url: z.string().trim().max(500).optional().nullable(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission('content.manage');
    const { id } = await ctx.params;
    const product = await updateProduct(id, schema.parse(await req.json()));
    if (!product) return fail('not_found', 'ไม่พบสินค้านี้', 404);
    return ok({ product });
  } catch (err) {
    return toErrorResponse(err);
  }
}
