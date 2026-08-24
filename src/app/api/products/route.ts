/** /api/products — สินค้า (สเปกหัวข้อ 4) — เจ้าของแก้ได้ / คนอื่นดูได้ */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { createProduct, listProducts } from '@/server/orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requirePermission('content.view');
    const products = await listProducts(req.nextUrl.searchParams.get('active') === '1');
    return ok({ products });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const schema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อสินค้า').max(120),
  variant: z.string().trim().max(60).optional().nullable(),
  sku: z.string().trim().max(60).optional().nullable(),
  price: z.number().min(0).max(1000000),
  image_url: z.string().trim().max(500).optional().nullable(),
  sort_order: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requirePermission('content.manage');
    const product = await createProduct(schema.parse(await req.json()));
    return ok({ product }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
