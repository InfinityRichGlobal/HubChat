/**
 * /api/orders — ลิสต์ออเดอร์ + สร้างออเดอร์จากแชท (สเปกหัวข้อ 5.3)
 *
 * ⚠️ ราคาที่บันทึกคำนวณ "ฝั่งเซิร์ฟเวอร์" เสมอจากสินค้าและโปรที่อยู่ในฐานข้อมูล
 *    หน้าเว็บส่งมาได้แค่ "เลือกอะไรบ้าง" ไม่ใช่ "ราคาเท่าไหร่"
 *    ยกเว้นราคาที่แอดมินตั้งใจกรอกทับเอง ซึ่งสเปกอนุญาตไว้ชัดเจน
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import {
  createOrder, listOrders, listProducts, listPromotions, OrderAccessError,
} from '@/server/orders/service';
import { getShippingMethod, codCombinationProblem } from '@/server/orders/shipping';
import { calculateOrder, PricingError, type PickedProduct } from '@/server/orders/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const p = req.nextUrl.searchParams;
    const orders = await listOrders(admin, {
      status: (p.get('status') as never) ?? undefined,
      page_id: p.get('page_id') ?? undefined,
      payment_method: (p.get('payment_method') as never) ?? undefined,
      payment_status: (p.get('payment_status') as never) ?? undefined,
      shipping_method_id: p.get('shipping_method_id') ?? undefined,
      admin_id: p.get('admin_id') ?? undefined,
      search: p.get('search') ?? undefined,
    });
    return ok({ orders });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const createSchema = z.object({
  conversation_id: z.string().uuid(),
  source_message_id: z.string().uuid().optional().nullable(),
  promotion_id: z.string().uuid().optional().nullable(),
  /** id ของสินค้าที่จิ้มเลือก เรียงตามที่เลือก (เลือกซ้ำได้) */
  product_ids: z.array(z.string().uuid()).max(50),
  recipient_name: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  postcode: z.string().trim().max(10).optional().nullable(),
  /**
   * ⭐ เลือก "วิธีจัดส่ง" ไม่ใช่ "ค่าส่ง"
   *    ค่าส่งมาจากตาราง shipping_methods ฝั่งเซิร์ฟเวอร์เสมอ
   *    ยังยอมให้กรอกค่าส่งเองได้ (บางเคสคิดพิเศษ) แต่ต้องตั้งใจส่งมา
   */
  shipping_method_id: z.string().uuid().optional().nullable(),
  shipping_fee: z.number().min(0).max(100000).optional(),
  extra_discount: z.number().min(0).max(1000000).optional(),
  /** ราคาที่กรอกทับเอง — สเปกข้อ 4 อนุญาตไว้ชัดเจน */
  manual_total: z.number().min(0).max(10000000).optional().nullable(),
  payment_method: z.enum(['cod', 'transfer']).optional().nullable(),
  internal_note: z.string().max(2000).optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const admin = await requirePermission('order.create');
    const body = createSchema.parse(await req.json());

    // ⭐ ราคามาจากฐานข้อมูลเสมอ ไม่ใช่จากหน้าเว็บ
    const [products, promotions] = await Promise.all([listProducts(), listPromotions()]);
    const byId = new Map(products.map((p) => [p.id, p]));

    const picked: PickedProduct[] = [];
    for (const id of body.product_ids) {
      const p = byId.get(id);
      if (!p) return fail('unknown_product', 'มีสินค้าที่ไม่อยู่ในระบบ — รีเฟรชหน้าแล้วลองใหม่', 422);
      picked.push({ id: p.id, name: p.name, variant: p.variant, price: Number(p.price) });
    }

    const promotion = body.promotion_id ? (promotions.find((x) => x.id === body.promotion_id) ?? null) : null;
    if (body.promotion_id && !promotion) {
      return fail('unknown_promotion', 'ไม่พบโปรโมชันนี้ — รีเฟรชหน้าแล้วลองใหม่', 422);
    }

    // ⭐ ค่าส่งมาจากฐานข้อมูล ไม่ใช่จากเบราว์เซอร์
    //    (ถ้าแอดมินตั้งใจกรอกเอง ค่าที่กรอกจะชนะ — สเปกอนุญาตให้แก้ทับได้)
    const shippingMethod = body.shipping_method_id ? await getShippingMethod(body.shipping_method_id) : null;
    if (body.shipping_method_id && !shippingMethod) {
      return fail('unknown_shipping', 'ไม่พบวิธีจัดส่งนี้ — รีเฟรชหน้าแล้วลองใหม่', 422);
    }

    // 🔴 กฎ COD — ตรวจที่นี่เพื่อให้ข้อความอ่านรู้เรื่อง
    //    ฐานข้อมูลตรวจซ้ำอีกชั้นอยู่แล้ว (create_order) ซึ่งเป็นตัวกันจริง
    const codProblem = codCombinationProblem(body.payment_method, shippingMethod);
    if (codProblem) return fail('cod_not_supported', codProblem, 422);

    const shippingFee = body.shipping_fee ?? shippingMethod?.fee ?? 0;

    const price = calculateOrder({
      promotion,
      picked,
      shipping_fee: shippingFee,
      extra_discount: body.extra_discount,
      manual_total: body.manual_total,
    });

    const order = await createOrder(admin, {
      conversation_id: body.conversation_id,
      source_message_id: body.source_message_id,
      recipient_name: body.recipient_name,
      phone: body.phone,
      address: body.address,
      postcode: body.postcode,
      items: price.items,
      subtotal: price.subtotal,
      shipping_fee: price.shipping_fee,
      discount: price.discount,
      total: price.total,
      payment_method: body.payment_method,
      internal_note: body.internal_note,
      shipping_method_id: body.shipping_method_id ?? null,
    });

    return ok({ order, explain_th: price.explain_th }, { status: 201 });
  } catch (err) {
    if (err instanceof PricingError) return fail('pricing', err.message, 422);
    if (err instanceof OrderAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
