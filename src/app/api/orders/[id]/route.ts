/**
 * /api/orders/[id] — รายละเอียด / แก้ไขออเดอร์ (สเปกหัวข้อ 5.3)
 *
 * ⚠️ ไม่มี DELETE โดยตั้งใจ — สเปกให้ลบออเดอร์ได้เฉพาะเจ้าของ
 *    และการลบข้อมูลที่มีเงินควรเป็น "ยกเลิก" (status = cancelled) ไม่ใช่ลบทิ้ง
 *    ประวัติการขายต้องตรวจย้อนหลังได้เสมอ
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { getOrder, listOrderLogs, OrderAccessError, updateOrder } from '@/server/orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const [order, logs] = await Promise.all([getOrder(admin, id), listOrderLogs(admin, id)]);
    return ok({ order, logs });
  } catch (err) {
    if (err instanceof OrderAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}

const patchSchema = z.object({
  recipient_name: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  postcode: z.string().trim().max(10).optional().nullable(),
  shipping_fee: z.number().min(0).max(100000).optional(),
  discount: z.number().min(0).max(1000000).optional(),
  total: z.number().min(0).max(10000000).optional(),
  payment_method: z.enum(['cod', 'transfer']).optional().nullable(),
  payment_status: z.enum(['unpaid', 'deposit', 'paid']).optional(),
  slip_url: z.string().trim().max(500).optional().nullable(),
  shipping_carrier: z.string().trim().max(60).optional().nullable(),
  /**
   * 🔴 tracking_no ถูกถอดออกจากที่นี่ในรอบ 8 โดยตั้งใจ
   *    ใช้ PUT /api/orders/[id]/tracking แทน เพื่อให้ทุกการเปลี่ยนเลขพัสดุ
   *    มีร่องรอยครบ (ใครใส่ / เมื่อไหร่ / มาจากไฟล์ไหน / ค่าเดิมคืออะไร)
   */
  status: z
    .enum(['draft', 'confirmed', 'paid', 'packed', 'shipped', 'completed', 'cancelled', 'returned'])
    .optional(),
  internal_note: z.string().max(2000).optional().nullable(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id } = await ctx.params;
    const patch = patchSchema.parse(await req.json());
    const order = await updateOrder(admin, id, patch);
    return ok({ order });
  } catch (err) {
    if (err instanceof OrderAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
