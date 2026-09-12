/**
 * POST /api/conversations/[id]/compose — ประกอบข้อความจากข้อมูลจริง
 * (ข้อ 1.7 สรุปออเดอร์ / 1.8 ข้อมูลจัดส่ง / 1.9 ชุดคำตอบ / 1.10 สินค้า)
 * ===========================================================================
 * 🔴 route นี้ **ไม่ส่งข้อความหาลูกค้า** — คืนข้อความไปวางในช่องพิมพ์เท่านั้น
 *    แอดมินต้องอ่านแล้วกดส่งเองทุกครั้ง
 *
 * 🔴 และ **ไม่รับค่าที่เป็นความจริงของร้านจากเบราว์เซอร์**
 *    รับได้แค่ "จะประกอบอะไร" กับ "ข้อความต้นแบบ" / "id สินค้า"
 *    ราคา ยอดรวม เลขพัสดุ ชื่อลูกค้า — เซิร์ฟเวอร์ไปหาเองทั้งหมด
 */
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse, fail } from '@/lib/api';
import { InboxAccessError } from '@/server/inbox/service';
import {
  composeOrderSummary, composeProducts, composeShippingInfo, resolveCannedText,
} from '@/server/chat/quick-actions';
import { explainMissing, isReadyToSend } from '@/server/chat/compose';

import { calculateOrder, type PickedProduct } from '@/server/orders/pricing';
import { listProducts, listPromotions } from '@/server/orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shipping') }),
  z.object({ kind: z.literal('order'), order_id: z.string().uuid().nullish() }),
  z.object({
    kind: z.literal('products'),
    items: z.array(z.object({
      product_id: z.string().uuid(),
      qty: z.number().int().min(1).max(99),
    })).min(1).max(10),
    promotion_ids: z.array(z.string().uuid()).max(10).default([]),
    include_amount: z.boolean().default(false),
    custom_header: z.string().max(500).optional(),
    custom_footer: z.string().max(1000).optional(),
  }),
  z.object({ kind: z.literal('canned'), template: z.string().min(1).max(4000) }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    const input = schema.parse(await req.json());

    if (input.kind === 'canned') {
      const r = await resolveCannedText(admin, id, input.template);
      return ok({
        text: r.text,
        ready: isReadyToSend(r),
        // ⚠️ คำเตือนต้องบอกว่าขาดอะไร ไม่ใช่แค่ "ยังส่งไม่ได้"
        warning_th: explainMissing(r),
      });
    }

    let discount = 0;
    let total: number | undefined = undefined;

    if (input.kind === 'products' && input.include_amount && input.promotion_ids.length > 0) {
      try {
        const [allProds, allPromos] = await Promise.all([listProducts(), listPromotions()]);
        const prodMap = new Map(allProds.map((p) => [p.id, p]));
        const promo = allPromos.find((p) => p.id === input.promotion_ids[0]);
        if (promo) {
          const picked: PickedProduct[] = [];
          for (const it of input.items) {
            const p = prodMap.get(it.product_id);
            if (p) {
              for (let q = 0; q < it.qty; q++) {
                picked.push({
                  id: p.id,
                  name: p.name,
                  variant: p.variant,
                  price: Number(p.price),
                });
              }
            }
          }
          if (picked.length > 0) {
            const priceResult = calculateOrder({
              promotion: promo,
              picked,
            });
            discount = priceResult.discount;
            total = priceResult.total;
          }
        }
      } catch {
        // เงื่อนไขจำนวนสินค้าอาจไม่ตรงกับโปร เช่น โปร 3 แถม 1 แต่เลือก 1 ชิ้น — คิดราคาปกติแทน
      }
    }

    const result =
      input.kind === 'shipping'
        ? await composeShippingInfo(admin, id)
        : input.kind === 'order'
          ? await composeOrderSummary(admin, id, input.order_id ?? null)
          : await composeProducts(admin, id, input.items, {
              promotion_ids: input.promotion_ids,
              show_price: input.include_amount,
              discount,
              total,
              custom_header: input.custom_header,
              custom_footer: input.custom_footer,
            });

    return ok({
      text: result.text,
      ready: result.missing_th.length === 0,
      warning_th:
        result.missing_th.length > 0
          ? `ยังไม่มีข้อมูล : ${result.missing_th.join(' · ')}`
          : null,
    });
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
