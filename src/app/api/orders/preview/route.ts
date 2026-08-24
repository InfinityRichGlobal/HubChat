/**
 * /api/orders/preview — คิดราคาให้ดูก่อนกดสร้าง (สเปกหัวข้อ 4)
 *
 * 🔴 ทำไมต้องมีเส้นนี้ แทนที่จะให้หน้าเว็บคูณเลขเอง :
 *    ถ้าหน้าเว็บคำนวณเอง จะมีสูตรราคาอยู่สองที่ (เบราว์เซอร์ + เซิร์ฟเวอร์)
 *    วันที่สองที่ไม่ตรงกัน แอดมินจะเห็นราคาหนึ่ง แต่ระบบบันทึกอีกราคาหนึ่ง
 *    และไม่มีใครรู้ตัวจนกว่าจะปิดบัญชีสิ้นเดือน
 *    สูตรราคาต้องมีที่เดียวคือ calculateOrder() เท่านั้น
 *
 * ⚠️ เส้นนี้ "อ่านอย่างเดียว" — ไม่เขียนอะไรลงฐานข้อมูลเลย
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { listProducts, listPromotions } from '@/server/orders/service';
import { calculateOrder, PricingError, type PickedProduct } from '@/server/orders/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  promotion_id: z.string().uuid().optional().nullable(),
  product_ids: z.array(z.string().uuid()).max(50),
  shipping_fee: z.number().min(0).max(100000).optional(),
  extra_discount: z.number().min(0).max(1000000).optional(),
  manual_total: z.number().min(0).max(10000000).optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    await requirePermission('order.create');
    const body = schema.parse(await req.json());

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

    const price = calculateOrder({
      promotion,
      picked,
      shipping_fee: body.shipping_fee,
      extra_discount: body.extra_discount,
      manual_total: body.manual_total,
    });

    return ok({ price });
  } catch (err) {
    // ราคายังคิดไม่ได้ (เช่นเลือกสินค้าไม่ครบตามโปร) ไม่ใช่ความผิดพลาดของระบบ
    // ตอบเป็นข้อความบอกแอดมินตรง ๆ ว่าต้องทำอะไรต่อ
    if (err instanceof PricingError) return fail('pricing', err.message, 422);
    return toErrorResponse(err);
  }
}
