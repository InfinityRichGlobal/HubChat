import 'server-only';
/**
 * Dashboard — ชั้นที่อ่านฐานข้อมูล (รอบ 9 — สเปกหัวข้อ 5.4)
 * ===========================================================================
 * ⚠️ การคำนวณทั้งหมดอยู่ที่ metrics.ts ซึ่งเป็นฟังก์ชันบริสุทธิ์
 *    ไฟล์นี้มีหน้าที่ "หยิบข้อมูลมาให้" กับ "บังคับสิทธิ์" เท่านั้น
 *
 * 🔴 กฎสิทธิ์ (สเปก 5.7) :
 *    • เจ้าของร้าน / ผู้ดู  → เห็นยอดทั้งร้าน
 *    • แอดมินทั่วไป        → เห็นเฉพาะออเดอร์ที่ตัวเองสร้าง
 *    ถ้าพลาดข้อนี้ แอดมินจะเห็นยอดขายรวมของร้าน ซึ่งเป็นข้อมูลของเจ้าของ
 */
import { db } from '@/lib/supabase/admin';
import { can, canSeePage } from '@/lib/auth/permissions';
import type { PublicAdmin } from '@/types/db';
import {
  byAd, byAdmin, byDay, byHour, byPage, headline, topProducts,
  type AdRow, type ContactFact, type DayRow, type GroupRow, type Headline,
  type HourRow, type OrderFact, type ProductRow,
} from './metrics';

/** เขตเวลาไทย — ทุกการแบ่งวัน/ชั่วโมงต้องใช้ตัวนี้ ไม่ใช่เวลาเซิร์ฟเวอร์ */
export const TZ = 'Asia/Bangkok';

export type RangeKey = 'today' | '7d' | '30d' | 'custom';

export type DashboardRange = {
  key: RangeKey;
  /** ISO */
  from: string;
  to: string;
};

/** เพดานกันดึงข้อมูลทั้งร้านมาคำนวณในหน้าเดียว */
const MAX_ROWS = 5000;
const MAX_DAYS = 92;

/**
 * แปลง ISO → วันที่ตามเวลาไทย (YYYY-MM-DD)
 * ⭐ ต้องใช้ตัวนี้ทั้งตอนสร้างรายชื่อวันและตอนจัดกลุ่ม ไม่งั้นวันจะเหลื่อมกัน
 */
export function dayInBangkok(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // en-CA ให้รูปแบบ YYYY-MM-DD พอดี
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

export function hourInBangkok(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return -1;
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d),
  );
}

/** สร้างรายชื่อวันตั้งแต่ from ถึง to (เวลาไทย) */
export function daysBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const start = new Date(fromIso);
  const end = new Date(toIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;

  const cursor = new Date(start);
  for (let i = 0; i < MAX_DAYS && cursor <= end; i += 1) {
    out.push(dayInBangkok(cursor.toISOString()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // กันวันซ้ำตอนข้ามเขตเวลา
  return [...new Set(out)];
}

/** แปลงคำสั่งช่วงเวลาเป็นช่วงจริง — now ฉีดเข้ามาได้เพื่อทดสอบ */
export function resolveRange(
  key: RangeKey,
  now: Date,
  custom?: { from?: string | null; to?: string | null },
): DashboardRange {
  const to = new Date(now);

  if (key === 'custom' && custom?.from) {
    const from = new Date(custom.from);
    const customTo = custom.to ? new Date(custom.to) : to;
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(customTo.getTime()) && from <= customTo) {
      return { key, from: from.toISOString(), to: customTo.toISOString() };
    }
  }

  const from = new Date(now);
  if (key === 'today') {
    // ต้นวันตามเวลาไทย
    const today = dayInBangkok(now.toISOString());
    return { key, from: new Date(`${today}T00:00:00+07:00`).toISOString(), to: to.toISOString() };
  }
  from.setUTCDate(from.getUTCDate() - (key === '30d' ? 29 : 6));
  const day = dayInBangkok(from.toISOString());
  return { key, from: new Date(`${day}T00:00:00+07:00`).toISOString(), to: to.toISOString() };
}

export type DashboardData = {
  range: DashboardRange;
  scope: 'all' | 'self';
  headline: Headline;
  by_ad: AdRow[];
  by_page: Array<GroupRow & { label: string }>;
  by_admin: Array<GroupRow & { label: string }>;
  top_products: ProductRow[];
  by_day: DayRow[];
  by_hour: HourRow[];
  /** true = ข้อมูลถูกตัดเพราะเกินเพดาน ตัวเลขจึงยังไม่ครบ */
  truncated: boolean;
};

/* ------------------------------------------------------------------------ */
/* คอลัมน์ที่หน้านี้ขอจากฐานข้อมูล                                                */
/* ------------------------------------------------------------------------ */
/**
 * 🔴 ประกาศไว้เป็นค่าคงที่ทุกชุด "โดยตั้งใจ" ไม่ใช่เขียนสดในคำสั่ง
 *
 *    เพราะมีชุดทดสอบ (tests/pg/dashboard.pg.test.ts) เดินไล่ทุกชื่อในนี้
 *    เทียบกับคอลัมน์จริงในฐานข้อมูลที่รัน migration 0001-มาครบทุกไฟล์
 *
 *    บทเรียนที่ทำให้ต้องมีตรงนี้ (D-87) :
 *    เคยขอ `customers.referral_ad_id` ซึ่งไม่เคยมีอยู่จริงเลยสักไฟล์เดียว
 *    TypeScript จับไม่ได้ (เป็นสตริง) ชุดทดสอบเดิมก็จับไม่ได้ (ทดสอบแต่ฟังก์ชันคำนวณ)
 *    → ไปพังเอาบนเครื่องจริงตอนเปิดหน้า เป็น error 500 เต็ม ๆ
 *
 *    ⭐ เพิ่มคอลัมน์ใหม่ที่ไหน ให้เพิ่มในค่าคงที่พวกนี้เสมอ แล้วเทสต์จะคุมให้เอง
 */
const PAGE_FIELDS = 'id,page_name,display_name';

const ORDER_FIELDS =
  'id,total,status,page_id,created_by_admin_id,referral_ad_id,created_at,closed_at,first_contact_at,items';

/**
 * ⚠️ ไม่มี referral_ad_id ในนี้ และห้ามใส่กลับเข้าไป
 *    ตาราง customers ไม่เคยเก็บ "แอดที่พามา" — ดูคำอธิบายที่ loadAdByCustomer()
 */
const CUSTOMER_FIELDS = 'id,page_id,first_contact_at';

/** ห้องแชท — เป็นที่เก็บ "แอดที่พาลูกค้าคนนี้เข้ามา" ตัวจริง */
const CONVERSATION_FIELDS = 'customer_id,referral_ad_id';

const ADMIN_FIELDS = 'id,name';

/**
 * รายการที่ชุดทดสอบใช้ไล่ตรวจว่าทุกคอลัมน์มีอยู่จริงในฐานข้อมูล
 * (ส่งออกไปให้เทสต์ ไม่ได้ใช้ตอนทำงานปกติ)
 */
export const DASHBOARD_SELECTS: Array<{ table: string; fields: string }> = [
  { table: 'pages', fields: PAGE_FIELDS },
  { table: 'orders', fields: ORDER_FIELDS },
  { table: 'customers', fields: CUSTOMER_FIELDS },
  { table: 'conversations', fields: CONVERSATION_FIELDS },
  { table: 'admins', fields: ADMIN_FIELDS },
];

export async function loadDashboard(
  admin: PublicAdmin,
  key: RangeKey,
  custom?: { from?: string | null; to?: string | null },
  now = new Date(),
): Promise<DashboardData> {
  const range = resolveRange(key, now, custom);

  /**
   * 🔴 ขอบเขตที่แอดมินคนนี้เห็นได้
   *    ผู้ที่ไม่มีสิทธิ์ dashboard.view.all จะเห็นเฉพาะออเดอร์ของตัวเอง
   */
  const scope: 'all' | 'self' = can(admin.role, 'dashboard.view.all') ? 'all' : 'self';

  const { data: pageRows, error: pageErr } = await db().from('pages').select(PAGE_FIELDS);
  // ⚠️ อ่านไม่ได้ต้องดัง ไม่ใช่เงียบแล้วแสดงยอดเป็นศูนย์ทั้งหน้า
  if (pageErr) throw new Error(`อ่านรายการเพจสำหรับสรุปยอดไม่สำเร็จ: ${pageErr.message}`);
  const pages = ((pageRows ?? []) as Array<{ id: string; page_name: string; display_name: string | null }>)
    .filter((p) => canSeePage(admin.role, admin.allowed_page_ids, p.id));
  const pageIds = pages.map((p) => p.id);
  const pageLabel = new Map(pages.map((p) => [p.id, p.display_name || p.page_name]));

  if (pageIds.length === 0) {
    return emptyData(range, scope);
  }

  /* ---- ออเดอร์ในช่วง ---- */
  let orderQuery = db()
    .from('orders')
    .select(ORDER_FIELDS)
    .in('page_id', pageIds)
    .gte('created_at', range.from)
    .lte('created_at', range.to)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);

  if (scope === 'self') orderQuery = orderQuery.eq('created_by_admin_id', admin.id);

  const { data: orderRows, error: orderErr } = await orderQuery;
  if (orderErr) throw new Error(`อ่านออเดอร์สำหรับสรุปยอดไม่สำเร็จ: ${orderErr.message}`);

  const orders = ((orderRows ?? []) as OrderFact[]).map((o) => ({
    ...o,
    total: Number(o.total ?? 0),
    items: Array.isArray(o.items) ? o.items : [],
  }));

  /* ---- ลูกค้าที่ทักครั้งแรกในช่วง ---- */
  /**
   * ⚠️ นับ "ลูกค้าที่ทักครั้งแรก" ไม่ใช่ "ห้องแชทที่ขยับ"
   *    ไม่งั้นลูกค้าเก่าที่ทักซ้ำจะถูกนับเป็นคนใหม่ แล้วอัตราปิดการขายจะต่ำเกินจริง
   */
  const { data: contactRows, error: contactErr } = await db()
    .from('customers')
    .select(CUSTOMER_FIELDS)
    .in('page_id', pageIds)
    .gte('first_contact_at', range.from)
    .lte('first_contact_at', range.to)
    .order('first_contact_at', { ascending: false })
    .limit(MAX_ROWS);

  if (contactErr) throw new Error(`อ่านข้อมูลลูกค้าสำหรับสรุปยอดไม่สำเร็จ: ${contactErr.message}`);

  /**
   * ⭐ ใช้ตัวบอกชนิด (type predicate) ไม่ใช่ .filter() เฉย ๆ
   *    เพื่อให้ TypeScript รู้จริงว่าหลังกรองแล้ว first_contact_at ไม่เป็น null แน่นอน
   *    การฝืนชนิดสองชั้นแบบเดิมคือสิ่งที่ทำให้ D-87 หลุดมาได้
   */
  const base = ((contactRows ?? []) as Array<{
    id: string; page_id: string; first_contact_at: string | null;
  }>).filter((c): c is { id: string; page_id: string; first_contact_at: string } =>
    Boolean(c.first_contact_at),
  );

  /**
   * ⭐ "แอดที่พาลูกค้าคนนี้เข้ามา" อยู่ที่ห้องแชท ไม่ได้อยู่ที่ตัวลูกค้า
   *    จึงต้องมาต่อกันเองในหน่วยความจำ (ดูเหตุผลที่ loadAdByCustomer)
   */
  const adByCustomer = await loadAdByCustomer(base.map((c) => c.id));
  const contacts: ContactFact[] = base.map((c) => ({
    ...c,
    referral_ad_id: adByCustomer.get(c.id) ?? null,
  }));

  /**
   * ⚠️ แอดมินที่เห็นเฉพาะของตัวเอง : "แชทใหม่" ยังเป็นของทั้งเพจ
   *    จึงเอามาคิดอัตราปิดการขายรายบุคคลไม่ได้ — ต้องซ่อนตัวเลขนั้นแทนการโชว์ค่าที่ผิด
   */
  const contactsForRate = scope === 'all' ? contacts : [];

  const days = daysBetween(range.from, range.to);
  const truncated = orders.length >= MAX_ROWS || contacts.length >= MAX_ROWS;

  const adminNames = await loadAdminNames(orders.map((o) => o.created_by_admin_id));

  return {
    range,
    scope,
    headline: headline(orders, contactsForRate),
    by_ad: scope === 'all' ? byAd(orders, contacts) : byAd(orders, []),
    by_page: byPage(orders).map((r) => ({ ...r, label: pageLabel.get(r.key) ?? r.key })),
    by_admin: byAdmin(orders).map((r) => ({ ...r, label: adminNames.get(r.key) ?? 'ไม่ทราบชื่อ' })),
    top_products: topProducts(orders),
    by_day: byDay(orders, contactsForRate, days, dayInBangkok),
    by_hour: byHour(contacts, hourInBangkok),
    truncated,
  };
}

/**
 * หา "แอดที่พาลูกค้าแต่ละคนเข้ามา"
 * ===========================================================================
 * 🔴 บทเรียน D-87 — ที่มาของ error 500 บนเครื่องจริง
 *
 *    เดิมโค้ดตรงนี้ขอคอลัมน์ `customers.referral_ad_id` ซึ่ง **ไม่เคยมีอยู่จริง**
 *    ในไฟล์ migration ไหนเลยตั้งแต่ 0001 ถึง 0013
 *
 *    ที่มาของแอดในระบบนี้เดินทางแบบนี้ :
 *
 *      webhook (มี ref/ad_id ติดมา)
 *        → conversations.referral_ad_id      ← เก็บที่นี่ที่เดียว (0005)
 *          → orders.referral_ad_id            ← คัดลอกตอนสร้างออเดอร์ (0008/0009)
 *
 *    ตาราง customers ไม่เคยเก็บ และ **ไม่ควรเก็บ** เพราะ :
 *      • ลูกค้าคนหนึ่งคือ "คน" ไม่ใช่ "ครั้งที่ทัก"
 *      • แอดเป็นของ "การทักครั้งนั้น" ซึ่งคือห้องแชท
 *    การเพิ่มคอลัมน์ซ้ำที่ customers จะกลายเป็นข้อมูลสองแหล่งที่ขัดกันได้เอง
 *    (บทเรียนเดียวกับ D-5 : ห้ามมีความจริงสองชุด)
 *
 * ⚠️ แบ่งยิงเป็นก้อน ๆ เพราะ .in() ที่มี id เป็นพัน ๆ ตัวจะทำให้ URL ยาวเกิน
 *    แล้วปลายทางจะตอบ 414 — ซึ่งจะกลายเป็นบั๊กที่โผล่เฉพาะร้านที่ลูกค้าเยอะ
 */
const IN_CHUNK = 200;

async function loadAdByCustomer(customerIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (customerIds.length === 0) return out;

  for (let i = 0; i < customerIds.length; i += IN_CHUNK) {
    const chunk = customerIds.slice(i, i + IN_CHUNK);
    const { data, error } = await db()
      .from('conversations')
      .select(CONVERSATION_FIELDS)
      .in('customer_id', chunk);

    if (error) throw new Error(`อ่านที่มาของลูกค้า (แอด) ไม่สำเร็จ: ${error.message}`);

    for (const row of (data ?? []) as Array<{ customer_id: string; referral_ad_id: string | null }>) {
      out.set(row.customer_id, row.referral_ad_id);
    }
  }
  return out;
}

async function loadAdminNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (unique.length === 0) return new Map();
  const { data } = await db().from('admins').select(ADMIN_FIELDS).in('id', unique);
  return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((a) => [a.id, a.name]));
}

function emptyData(range: DashboardRange, scope: 'all' | 'self'): DashboardData {
  return {
    range,
    scope,
    headline: {
      sales: 0, order_count: 0, average_order: 0,
      new_chats: 0, close_rate: 0, avg_hours_to_close: null,
    },
    by_ad: [], by_page: [], by_admin: [], top_products: [],
    by_day: [], by_hour: byHour([], hourInBangkok),
    truncated: false,
  };
}
