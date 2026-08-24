import 'server-only';
/**
 * ออเดอร์ + สินค้า + โปรโมชัน — ชั้นข้อมูล (สเปกหัวข้อ 4 / 5.3)
 * ===========================================================================
 * ⚠️ ไฟล์นี้ไม่มีการส่งข้อความหาลูกค้าเลย
 *    การแจ้งเลขพัสดุเป็นงานของรอบถัดไป และต้องผ่าน sendMessage() เท่านั้น
 *
 * ⭐ สิทธิ์รายเพจถูกบังคับที่นี่เหมือนอินบ็อกซ์ (สเปก 6.6)
 *    แอดมินที่ไม่มีสิทธิ์เห็นเพจไหน ต้องไม่เห็นออเดอร์ของเพจนั้น
 */
import { db } from '@/lib/supabase/admin';
import { canSeePage } from '@/lib/auth/permissions';
import type {
  OrderItem, OrderStatus, PaymentMethod, PaymentStatus, PromotionType, PublicAdmin,
} from '@/types/db';
import type { Promotion } from './pricing';

export class OrderAccessError extends Error {}

/** ข้อมูลที่แอดมินกรอกไม่ผ่านกฎ (ไม่ใช่เรื่องสิทธิ์ และไม่ใช่ระบบพัง) */
export class CatalogError extends Error {}

/* ------------------------------------------------------------------------ */
/* สินค้า                                                                     */
/* ------------------------------------------------------------------------ */

export type Product = {
  id: string;
  name: string;
  sku: string | null;
  variant: string | null;
  price: number;
  /** ใช้เป็นสี swatch ให้จิ้มเลือกได้ (สเปกข้อ 4 : "มี swatch สี ไม่ใช่แค่ตัวหนังสือ") */
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
};

const PRODUCT_COLUMNS = 'id,name,sku,variant,price,image_url,is_active,sort_order';

export async function listProducts(activeOnly = false): Promise<Product[]> {
  // ⭐ สินค้าที่เก็บเข้ากรุแล้วต้องไม่โผล่ที่ไหนอีก แม้ในหน้าตั้งค่า
  //    (ยังอยู่ในฐานข้อมูลเพื่อไม่ให้ออเดอร์เก่าขาดที่อ้างอิง)
  let q = db().from('products').select(PRODUCT_COLUMNS).is('archived_at', null).order('sort_order').limit(300);
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(`อ่านรายการสินค้าไม่สำเร็จ: ${error.message}`);
  return (data ?? []) as unknown as Product[];
}

export type ProductInput = {
  name: string;
  variant?: string | null;
  sku?: string | null;
  price: number;
  image_url?: string | null;
  sort_order?: number;
  is_active?: boolean;
};

export async function createProduct(input: ProductInput): Promise<Product> {
  const { data, error } = await db()
    .from('products')
    .insert({
      name: input.name.trim(),
      variant: input.variant?.trim() || null,
      sku: input.sku?.trim() || null,
      price: input.price,
      image_url: input.image_url?.trim() || null,
      sort_order: input.sort_order ?? 0,
      is_active: input.is_active ?? true,
    })
    .select(PRODUCT_COLUMNS)
    .single();
  if (error) {
    // 23505 = sku ซ้ำ (unique index เฉพาะสินค้าที่ยังไม่เก็บเข้ากรุ)
    if (error.code === '23505') throw new CatalogError('รหัสสินค้า (SKU) นี้ถูกใช้ไปแล้ว');
    throw new Error(`บันทึกสินค้าไม่สำเร็จ: ${error.message}`);
  }
  return data as unknown as Product;
}

export async function updateProduct(
  id: string,
  input: Partial<ProductInput> & { archive?: boolean },
): Promise<Product | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.variant !== undefined) patch.variant = input.variant?.trim() || null;
  if (input.sku !== undefined) patch.sku = input.sku?.trim() || null;
  if (input.price !== undefined) patch.price = input.price;
  if (input.image_url !== undefined) patch.image_url = input.image_url?.trim() || null;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  // ⭐ เก็บเข้ากรุแทนการลบ — ออเดอร์เก่าต้องยังตามรอยกลับมาได้
  //    ปิดใช้งานไปพร้อมกันเสมอ ไม่งั้นจะยังโผล่ในจุดเลือกขาย
  if (input.archive) {
    patch.archived_at = new Date().toISOString();
    patch.is_active = false;
  }
  if (Object.keys(patch).length <= 1) return null;

  const { data, error } = await db()
    .from('products')
    .update(patch)
    .eq('id', id)
    .select(PRODUCT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`แก้ไขสินค้าไม่สำเร็จ: ${error.message}`);
  return (data as unknown as Product) ?? null;
}

/* ------------------------------------------------------------------------ */
/* โปรโมชัน                                                                   */
/* ------------------------------------------------------------------------ */

const PROMO_COLUMNS = 'id,name,type,config,price,is_active,sort_order';

export type PromotionRow = Promotion & { is_active: boolean; sort_order: number };

export async function listPromotions(activeOnly = false): Promise<PromotionRow[]> {
  let q = db().from('promotions').select(PROMO_COLUMNS).is('archived_at', null).order('sort_order').limit(100);
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(`อ่านรายการโปรโมชันไม่สำเร็จ: ${error.message}`);
  return ((data ?? []) as unknown as PromotionRow[]).map((p) => ({
    ...p,
    config: p.config ?? {},
    price: p.price === null || p.price === undefined ? null : Number(p.price),
  }));
}

export type PromotionInput = {
  name: string;
  type: PromotionType;
  config?: { pick?: number; pay?: number };
  price?: number | null;
  sort_order?: number;
  is_active?: boolean;
};

export async function createPromotion(input: PromotionInput): Promise<PromotionRow> {
  const { data, error } = await db()
    .from('promotions')
    .insert({
      name: input.name.trim(),
      type: input.type,
      config: input.config ?? {},
      price: input.price ?? null,
      sort_order: input.sort_order ?? 0,
      is_active: input.is_active ?? true,
    })
    .select(PROMO_COLUMNS)
    .single();
  if (error) throw new Error(`บันทึกโปรโมชันไม่สำเร็จ: ${error.message}`);
  return data as unknown as PromotionRow;
}

export async function updatePromotion(
  id: string,
  input: Partial<PromotionInput> & { archive?: boolean },
): Promise<PromotionRow | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.type !== undefined) patch.type = input.type;
  if (input.config !== undefined) patch.config = input.config;
  if (input.price !== undefined) patch.price = input.price;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (input.archive) {
    patch.archived_at = new Date().toISOString();
    patch.is_active = false;
  }
  if (Object.keys(patch).length <= 1) return null;

  const { data, error } = await db()
    .from('promotions')
    .update(patch)
    .eq('id', id)
    .select(PROMO_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`แก้ไขโปรโมชันไม่สำเร็จ: ${error.message}`);
  return (data as unknown as PromotionRow) ?? null;
}

/* ------------------------------------------------------------------------ */
/* ออเดอร์                                                                    */
/* ------------------------------------------------------------------------ */

export type OrderRow = {
  id: string;
  order_no: string;
  conversation_id: string | null;
  customer_id: string | null;
  page_id: string | null;
  recipient_name: string | null;
  phone: string | null;
  address: string | null;
  postcode: string | null;
  items: OrderItem[];
  subtotal: number;
  shipping_fee: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus;
  slip_url: string | null;
  slip_media_id: string | null;
  shipping_carrier: string | null;
  shipping_method_id: string | null;
  /** สำเนาวิธีจัดส่ง ณ ตอนสร้าง — ออเดอร์เก่าต้องไม่เปลี่ยนตามค่าส่งที่แก้ทีหลัง */
  shipping_snapshot: { id?: string; name?: string; fee?: number; cod_supported?: boolean } | null;
  tracking_no: string | null;
  status: OrderStatus;
  referral_ad_id: string | null;
  internal_note: string | null;
  created_by_admin_id: string | null;
  created_at: string;
  updated_at: string | null;
};

const ORDER_COLUMNS =
  'id,order_no,conversation_id,customer_id,page_id,recipient_name,phone,address,postcode,' +
  'items,subtotal,shipping_fee,discount,total,payment_method,payment_status,slip_url,slip_media_id,' +
  'shipping_carrier,shipping_method_id,shipping_snapshot,tracking_no,status,referral_ad_id,' +
  'internal_note,created_by_admin_id,created_at,updated_at';

/** เพจที่แอดมินคนนี้เห็นได้ — ใช้กรองออเดอร์ */
async function visiblePageIds(admin: PublicAdmin): Promise<string[]> {
  const { data } = await db().from('pages').select('id');
  return ((data ?? []) as Array<{ id: string }>)
    .map((p) => p.id)
    .filter((id) => canSeePage(admin.role, admin.allowed_page_ids, id));
}

export type OrderFilters = {
  status?: OrderStatus;
  page_id?: string;
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus;
  shipping_method_id?: string;
  admin_id?: string;
  search?: string;
  limit?: number;
};

export async function listOrders(admin: PublicAdmin, filters: OrderFilters = {}): Promise<OrderRow[]> {
  const pageIds = await visiblePageIds(admin);
  if (pageIds.length === 0) return [];

  let query = db()
    .from('orders')
    .select(ORDER_COLUMNS)
    .in('page_id', filters.page_id && pageIds.includes(filters.page_id) ? [filters.page_id] : pageIds)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(filters.limit ?? 100, 1), 300));

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.payment_method) query = query.eq('payment_method', filters.payment_method);
  if (filters.payment_status) query = query.eq('payment_status', filters.payment_status);
  if (filters.shipping_method_id) query = query.eq('shipping_method_id', filters.shipping_method_id);
  if (filters.admin_id) query = query.eq('created_by_admin_id', filters.admin_id);

  const term = filters.search?.trim();
  if (term) {
    query = query.or(
      `order_no.ilike.%${term}%,recipient_name.ilike.%${term}%,phone.ilike.%${term}%,tracking_no.ilike.%${term}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`อ่านรายการออเดอร์ไม่สำเร็จ: ${error.message}`);
  return normalise((data ?? []) as unknown as OrderRow[]);
}

function normalise(rows: OrderRow[]): OrderRow[] {
  return rows.map((o) => ({
    ...o,
    items: Array.isArray(o.items) ? o.items : [],
    subtotal: Number(o.subtotal),
    shipping_fee: Number(o.shipping_fee),
    discount: Number(o.discount),
    total: Number(o.total),
    shipping_snapshot:
      o.shipping_snapshot && typeof o.shipping_snapshot === 'object' && Object.keys(o.shipping_snapshot).length > 0
        ? o.shipping_snapshot
        : null,
  }));
}

export async function getOrder(admin: PublicAdmin, id: string): Promise<OrderRow> {
  const { data } = await db().from('orders').select(ORDER_COLUMNS).eq('id', id).maybeSingle();
  if (!data) throw new OrderAccessError('ไม่พบออเดอร์นี้');

  const row = normalise([data as unknown as OrderRow])[0];
  if (row.page_id && !canSeePage(admin.role, admin.allowed_page_ids, row.page_id)) {
    throw new OrderAccessError('คุณไม่มีสิทธิ์เข้าถึงเพจของออเดอร์นี้');
  }
  return row;
}

export type CreateOrderInput = {
  conversation_id: string;
  source_message_id?: string | null;
  recipient_name?: string | null;
  phone?: string | null;
  address?: string | null;
  postcode?: string | null;
  items: OrderItem[];
  subtotal: number;
  shipping_fee: number;
  discount: number;
  total: number;
  payment_method?: PaymentMethod | null;
  internal_note?: string | null;
  shipping_method_id?: string | null;
};

export async function createOrder(admin: PublicAdmin, input: CreateOrderInput): Promise<OrderRow> {
  // ตรวจสิทธิ์เพจของห้องแชทก่อนเสมอ
  const { data: conv } = await db()
    .from('conversations')
    .select('id,page_id')
    .eq('id', input.conversation_id)
    .maybeSingle();
  if (!conv) throw new OrderAccessError('ไม่พบห้องแชทนี้');
  if (!canSeePage(admin.role, admin.allowed_page_ids, (conv as { page_id: string }).page_id)) {
    throw new OrderAccessError('คุณไม่มีสิทธิ์เข้าถึงเพจของแชทนี้');
  }

  const { data, error } = await db().rpc('create_order', {
    p_conversation_id: input.conversation_id,
    p_source_message_id: input.source_message_id ?? null,
    p_admin_id: admin.id,
    p_recipient_name: input.recipient_name ?? null,
    p_phone: input.phone ?? null,
    p_address: input.address ?? null,
    p_postcode: input.postcode ?? null,
    p_items: input.items,
    p_subtotal: input.subtotal,
    p_shipping_fee: input.shipping_fee,
    p_discount: input.discount,
    p_total: input.total,
    p_payment_method: input.payment_method ?? null,
    p_internal_note: input.internal_note ?? null,
    p_shipping_method_id: input.shipping_method_id ?? null,
  });
  if (error) throw new Error(`สร้างออเดอร์ไม่สำเร็จ: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as OrderRow;
  return normalise([row])[0];
}

/** ฟิลด์ที่ยอมให้แก้จากหน้าเว็บ — นอกรายการนี้แก้ไม่ได้เด็ดขาด */
export type OrderPatch = Partial<{
  recipient_name: string | null;
  phone: string | null;
  address: string | null;
  postcode: string | null;
  items: OrderItem[];
  subtotal: number;
  shipping_fee: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus;
  slip_url: string | null;
  /** สลิปที่เก็บไว้เองอย่างถาวร (D-17) — ผูกกับ media_assets */
  slip_media_id: string | null;
  shipping_carrier: string | null;
  /**
   * เปลี่ยนวิธีจัดส่งได้ แต่ "สำเนา" ของวิธีจัดส่งเปลี่ยนเองไม่ได้
   * 🔴 shipping_snapshot ไม่อยู่ในรายการนี้โดยตั้งใจ —
   *    ฐานข้อมูลเป็นคนหยิบสำเนามาให้เมื่อ shipping_method_id เปลี่ยน
   *    ถ้ารับจากผู้เรียกได้ จะปลอมค่าส่ง/สิทธิ์เก็บเงินปลายทางของออเดอร์เก่าได้ทันที
   */
  shipping_method_id: string | null;
  tracking_no: string | null;
  status: OrderStatus;
  internal_note: string | null;
}>;

export async function updateOrder(admin: PublicAdmin, id: string, patch: OrderPatch): Promise<OrderRow> {
  // ตรวจสิทธิ์ก่อน (โยน OrderAccessError ถ้าไม่ผ่าน)
  await getOrder(admin, id);

  const { data, error } = await db().rpc('update_order', {
    p_order_id: id,
    p_admin_id: admin.id,
    p_patch: patch,
  });
  if (error) throw new Error(`แก้ไขออเดอร์ไม่สำเร็จ: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as OrderRow;
  return normalise([row])[0];
}

/** ประวัติการแก้ไขของออเดอร์ (สเปก 5.3) */
export type OrderLog = {
  id: string;
  admin_id: string | null;
  admin_name: string | null;
  action: string;
  created_at: string;
};

export async function listOrderLogs(admin: PublicAdmin, orderId: string): Promise<OrderLog[]> {
  await getOrder(admin, orderId);

  const { data } = await db()
    .from('order_logs')
    .select('id,admin_id,action,created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (data ?? []) as Array<{ id: string; admin_id: string | null; action: string; created_at: string }>;
  const ids = [...new Set(rows.map((r) => r.admin_id).filter((v): v is string => Boolean(v)))];

  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: admins } = await db().from('admins').select('id,name').in('id', ids);
    for (const a of (admins ?? []) as Array<{ id: string; name: string }>) names.set(a.id, a.name);
  }

  return rows.map((r) => ({
    ...r,
    admin_name: r.admin_id ? (names.get(r.admin_id) ?? null) : null,
  }));
}
