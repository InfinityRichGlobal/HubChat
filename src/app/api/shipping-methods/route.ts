/** /api/shipping-methods — วิธีจัดส่ง (รอบ 6) */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { createShippingMethod, listShippingMethods, ShippingError } from '@/server/orders/shipping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requirePermission('content.view');
    const methods = await listShippingMethods(req.nextUrl.searchParams.get('active') === '1');
    return ok({ methods });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const schema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อวิธีจัดส่ง').max(80),
  fee: z.number().min(0).max(100000),
  cod_supported: z.boolean().optional(),
  note: z.string().trim().max(300).optional().nullable(),
  sort_order: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requirePermission('content.manage');
    const method = await createShippingMethod(schema.parse(await req.json()));
    return ok({ method }, { status: 201 });
  } catch (err) {
    if (err instanceof ShippingError) return fail('invalid_shipping', err.message, 422);
    return toErrorResponse(err);
  }
}
