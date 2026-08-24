/** /api/promotions — โปรโมชัน (สเปกหัวข้อ 4) */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { createPromotion, listPromotions } from '@/server/orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requirePermission('content.view');
    const promotions = await listPromotions(req.nextUrl.searchParams.get('active') === '1');
    return ok({ promotions });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const schema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อโปรโมชัน').max(120),
  type: z.enum(['single', 'bundle', 'buy_x_get_y', 'boxset']),
  config: z.object({ pick: z.number().int().min(1).max(50).optional(), pay: z.number().int().min(1).max(50).optional() }).optional(),
  price: z.number().min(0).max(1000000).optional().nullable(),
  sort_order: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requirePermission('content.manage');
    const promotion = await createPromotion(schema.parse(await req.json()));
    return ok({ promotion }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
