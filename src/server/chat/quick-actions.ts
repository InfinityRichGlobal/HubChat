import 'server-only';
/**
 * ปุ่มลัดในห้องแชท — เซิร์ฟเวอร์เป็นคนหาค่าจริงและประกอบข้อความ
 * (ก้อน 2 ข้อ 1.8 / 1.9 / 1.10 / 1.7)
 * ===========================================================================
 * 🔴 เหตุผลที่ทั้งหมดนี้อยู่ฝั่งเซิร์ฟเวอร์ ไม่ใช่ฝั่งเบราว์เซอร์ :
 *
 *    ค่าอย่าง **ราคา / ยอดรวม / เลขพัสดุ** คือ "ความจริงของร้าน"
 *    ถ้าเบราว์เซอร์ประกอบเอง จะเกิดสองปัญหาที่แก้ทีหลังไม่ได้ :
 *      1. สูตรราคาจะมีสองที่ แล้ววันหนึ่งจะไม่ตรงกัน (บทเรียน D-5)
 *      2. ใครก็แก้ค่าในเบราว์เซอร์แล้วส่งยอดผิดให้ลูกค้าได้
 *
 *    เบราว์เซอร์จึงได้รับแค่ "ข้อความที่ประกอบเสร็จแล้ว" กับ "ขาดอะไรบ้าง"
 *
 * ⚠️ ทุกฟังก์ชันคืนข้อความไปวางใน "ช่องพิมพ์" เท่านั้น **ไม่ส่งเอง**
 *    แอดมินต้องอ่านแล้วกดส่งเองทุกครั้ง (กฎของก้อนนี้)
 */
import { db } from '@/lib/supabase/admin';
import type { PublicAdmin } from '@/types/db';
import { requireConversationAccess } from '@/server/inbox/service';
import {
  orderSummaryText, productText, resolveVariables, shippingInfoText,
  type ComposeResult, type ProductFacts, type ResolveResult, type VariableValues,
} from './compose';

/* ------------------------------------------------------------------------ */
/* คอลัมน์ที่ไฟล์นี้ขอจากฐานข้อมูล                                               */
/* ------------------------------------------------------------------------ */
/**
 * 🔴 บทเรียน D-87 ซ้ำรอยตอนเขียนไฟล์นี้เอง
 *    ตอนแรกเขียน `variants` / `base_price` ซึ่งไม่มีอยู่จริง
 *    (คอลัมน์จริงคือ `variant` / `price`)
 *    TypeScript จับไม่ได้เพราะเป็นสตริง — เกือบหลุดไปพังบนเครื่องจริงอีกรอบ
 *
 * ⭐ จึงประกาศเป็นค่าคงที่แล้วส่งออกให้ชุดทดสอบไล่ตรวจกับ information_schema
 *    เพิ่มคอลัมน์ใหม่เมื่อไหร่ ให้เพิ่มตรงนี้ แล้วเทสต์จะคุมให้เอง
 */
const ORDER_FIELDS =
  'id,order_no,total,shipping_carrier,tracking_no,items,subtotal,shipping_fee,discount,payment_method';
const CUSTOMER_FIELDS = 'name,recipient_name,phone,address,postcode';
const PRODUCT_FIELDS = 'id,name,variant,price,is_active';
const PROMOTION_FIELDS = 'id,name,is_active,sort_order';

/** รายการที่ชุดทดสอบใช้ไล่ตรวจว่าทุกคอลัมน์มีอยู่จริง */
export const QUICK_ACTION_SELECTS: Array<{ table: string; fields: string }> = [
  { table: 'orders', fields: ORDER_FIELDS },
  { table: 'customers', fields: CUSTOMER_FIELDS },
  { table: 'products', fields: PRODUCT_FIELDS },
  { table: 'promotions', fields: PROMOTION_FIELDS },
];

/* ------------------------------------------------------------------------ */
/* ตัวช่วยกลาง : หาออเดอร์ล่าสุดของลูกค้าในห้องนี้                                */
/* ------------------------------------------------------------------------ */

type LatestOrder = {
  id: string;
  order_no: string;
  total: number;
  shipping_carrier: string | null;
  tracking_no: string | null;
  items: Array<{ name: string; variant?: string | null; qty: number; total: number }>;
  subtotal: number;
  shipping_fee: number;
  discount: number;
  payment_method: string | null;
};

async function latestOrder(customerId: string): Promise<LatestOrder | null> {
  const { data } = await db()
    .from('orders')
    .select(ORDER_FIELDS)
    .eq('customer_id', customerId)
    // ⚠️ ออเดอร์ที่ยกเลิกแล้วไม่ควรถูกหยิบมาเป็น "ออเดอร์ล่าสุด"
    //    ไม่งั้นแอดมินจะส่งเลขพัสดุของออเดอร์ที่ถูกยกเลิกไปให้ลูกค้า
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as (Omit<LatestOrder, 'items'> & { items: unknown }) | null;
  if (!row) return null;

  return {
    ...row,
    total: Number(row.total ?? 0),
    subtotal: Number(row.subtotal ?? 0),
    shipping_fee: Number(row.shipping_fee ?? 0),
    discount: Number(row.discount ?? 0),
    items: Array.isArray(row.items) ? (row.items as LatestOrder['items']) : [],
  };
}

const PAYMENT_TH: Record<string, string> = {
  cod: 'เก็บเงินปลายทาง',
  transfer: 'โอนเงิน',
  promptpay: 'พร้อมเพย์',
};

/* ------------------------------------------------------------------------ */
/* 1.8 ข้อมูลจัดส่ง                                                           */
/* ------------------------------------------------------------------------ */

export async function composeShippingInfo(
  admin: PublicAdmin,
  conversationId: string,
): Promise<ComposeResult> {
  const conv = await requireConversationAccess(admin, conversationId);

  const [{ data: cust }, order] = await Promise.all([
    db()
      .from('customers')
      .select(CUSTOMER_FIELDS)
      .eq('id', conv.customer_id)
      .maybeSingle(),
    latestOrder(conv.customer_id),
  ]);

  const c = cust as {
    name: string | null; recipient_name: string | null;
    phone: string | null; address: string | null; postcode: string | null;
  } | null;

  return shippingInfoText({
    // ⭐ ชื่อผู้รับที่แอดมินกรอกไว้สำคัญกว่าชื่อโปรไฟล์เสมอ
    //    เพราะคนสั่งกับคนรับอาจเป็นคนละคน (ซื้อฝาก / ส่งให้ที่ทำงาน)
    recipient_name: c?.recipient_name ?? c?.name ?? null,
    phone: c?.phone ?? null,
    address: c?.address ?? null,
    postcode: c?.postcode ?? null,
    carrier: order?.shipping_carrier ?? null,
    tracking_no: order?.tracking_no ?? null,
  });
}

/* ------------------------------------------------------------------------ */
/* 1.7 สรุปออเดอร์                                                            */
/* ------------------------------------------------------------------------ */

export async function composeOrderSummary(
  admin: PublicAdmin,
  conversationId: string,
  orderId?: string | null,
): Promise<ComposeResult> {
  const conv = await requireConversationAccess(admin, conversationId);

  let order: LatestOrder | null;
  if (orderId) {
    /**
     * 🔴 ระบุออเดอร์มาเอง = ต้องตรวจว่าเป็นของลูกค้าคนนี้จริง
     *    ไม่งั้นหน้าเว็บจะยัด id ออเดอร์ของลูกค้าคนอื่นมา
     *    แล้วยอดเงินของคนอื่นจะถูกวางลงช่องพิมพ์ของห้องนี้
     */
    const { data } = await db()
      .from('orders')
      .select(ORDER_FIELDS)
      .eq('id', orderId)
      .eq('customer_id', conv.customer_id)
      .maybeSingle();

    const row = data as (Omit<LatestOrder, 'items'> & { items: unknown }) | null;
    order = row
      ? {
          ...row,
          total: Number(row.total ?? 0),
          subtotal: Number(row.subtotal ?? 0),
          shipping_fee: Number(row.shipping_fee ?? 0),
          discount: Number(row.discount ?? 0),
          items: Array.isArray(row.items) ? (row.items as LatestOrder['items']) : [],
        }
      : null;
  } else {
    order = await latestOrder(conv.customer_id);
  }

  if (!order) return { text: '', missing_th: ['ออเดอร์'] };

  return orderSummaryText({
    order_no: order.order_no,
    items: order.items,
    subtotal: order.subtotal,
    shipping_fee: order.shipping_fee,
    discount: order.discount,
    total: order.total,
    payment_method_th: order.payment_method ? (PAYMENT_TH[order.payment_method] ?? order.payment_method) : null,
  });
}

/* ------------------------------------------------------------------------ */
/* 1.10 แทรกสินค้า                                                            */
/* ------------------------------------------------------------------------ */

export async function composeProducts(
  admin: PublicAdmin,
  conversationId: string,
  items: Array<{ product_id: string; qty: number }>,
  options: { promotion_ids?: string[]; show_price?: boolean } = {},
): Promise<ComposeResult> {
  await requireConversationAccess(admin, conversationId);
  if (items.length === 0) return productText([]);

  const productIds = [...new Set(items.map((item) => item.product_id))];

  const { data, error } = await db()
    .from('products')
    .select(PRODUCT_FIELDS)
    .in('id', productIds.slice(0, 10))
    .eq('is_active', true);

  if (error) throw new Error(`อ่านข้อมูลสินค้าไม่สำเร็จ: ${error.message}`);

  const rows = (data ?? []) as Array<{
    id: string; name: string; variant: string | null; price: number | string;
  }>;

  const promotionIds = [...new Set(options.promotion_ids ?? [])].slice(0, 10);
  const { data: promos } = promotionIds.length > 0
    ? await db()
        .from('promotions')
        .select(PROMOTION_FIELDS)
        .in('id', promotionIds)
        .eq('is_active', true)
        .order('sort_order')
    : { data: [] };

  const byId = new Map(rows.map((row) => [row.id, row]));

  const facts: ProductFacts[] = items.flatMap((item) => {
    const p = byId.get(item.product_id);
    if (!p) return [];
    return [{
      name: p.name,
      variant: p.variant,
      qty: Math.max(1, Math.min(99, Math.trunc(item.qty))),
      // 🔴 ราคามาจากฐานข้อมูลเสมอ เบราว์เซอร์ส่งราคามาเองไม่ได้
      price: Number(p.price ?? 0),
    }];
  });

  return productText(facts, {
    show_price: options.show_price,
    promotions: ((promos ?? []) as Array<{ name: string }>).map((promo) => promo.name),
  });
}

/* ------------------------------------------------------------------------ */
/* 1.9 ชุดคำตอบสำเร็จรูป + ตัวแปร                                              */
/* ------------------------------------------------------------------------ */

/**
 * แทนค่าตัวแปรในชุดคำตอบ ด้วยค่าจริงจากฐานข้อมูล
 *
 * 🔴 เบราว์เซอร์ห้ามส่งค่าของตัวแปรมาเองเด็ดขาด
 *    ส่งมาได้แค่ "ข้อความต้นแบบ" เท่านั้น ที่เหลือเซิร์ฟเวอร์หาเอง
 *    ไม่งั้นจะแก้ยอดเงิน/เลขพัสดุในเบราว์เซอร์แล้วส่งค่าผิดให้ลูกค้าได้
 */
export async function resolveCannedText(
  admin: PublicAdmin,
  conversationId: string,
  template: string,
): Promise<ResolveResult> {
  const conv = await requireConversationAccess(admin, conversationId);

  const [{ data: cust }, order] = await Promise.all([
    db().from('customers').select(CUSTOMER_FIELDS).eq('id', conv.customer_id).maybeSingle(),
    latestOrder(conv.customer_id),
  ]);

  const c = cust as { name: string | null; recipient_name: string | null } | null;

  const values: VariableValues = {
    customer_name: c?.name ?? c?.recipient_name ?? null,
    order_number: order?.order_no ?? null,
    // ยอดเงินจัดรูปฝั่งเซิร์ฟเวอร์ ให้ทุกที่แสดงเหมือนกันหมด
    order_total: order ? `${order.total.toLocaleString('th-TH')} บาท` : null,
    tracking_number: order?.tracking_no ?? null,
    carrier: order?.shipping_carrier ?? null,
  };

  return resolveVariables(template, values);
}
