/**
 * คำนวณตัวเลขของ Dashboard (รอบ 9 — สเปกหัวข้อ 5.4)
 * ===========================================================================
 * ⚠️ ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ล้วน ๆ ห้ามต่อฐานข้อมูล ห้ามอ่านเวลาปัจจุบัน
 *
 * ⭐ ทำไมต้องแยกการคำนวณออกจากการอ่านฐานข้อมูล :
 *    ตัวเลขพวกนี้เอาไปตัดสินใจเรื่องเงินจริง — "แอดตัวไหนคุ้ม ตัวไหนควรปิด"
 *    ถ้าคำนวณผิดแล้วเจ้าของร้านปิดแอดที่กำลังทำกำไรอยู่ นั่นคือความเสียหายจริง
 *    แยกออกมาแบบนี้ทำให้ทดสอบทุกเคสได้โดยไม่ต้องมีข้อมูลจริง
 *
 * 🔴 กฎการนับที่ต้องชัดเจนและห้ามเปลี่ยนเงียบ ๆ :
 *    • "ยอดขาย" นับเฉพาะออเดอร์ที่ไม่ถูกยกเลิก/ตีกลับ
 *    • "แชทใหม่" นับจากลูกค้าที่ทักครั้งแรกในช่วงนั้น (first_contact_at)
 *      ไม่ใช่จำนวนห้องแชทที่ขยับ — ไม่งั้นลูกค้าเก่าทักซ้ำจะถูกนับเป็นคนใหม่
 *    • "อัตราปิดการขาย" = ออเดอร์ ÷ แชทใหม่ ในช่วงเดียวกัน
 */

/** ออเดอร์เท่าที่ Dashboard ต้องใช้ */
export type OrderFact = {
  id: string;
  total: number;
  status: string;
  page_id: string | null;
  created_by_admin_id: string | null;
  referral_ad_id: string | null;
  /** ISO */
  created_at: string;
  /** ISO — เวลาที่ปิดการขายได้ */
  closed_at: string | null;
  /** ISO — ลูกค้าทักครั้งแรกเมื่อไหร่ (คัดลอกมาตอนสร้างออเดอร์) */
  first_contact_at: string | null;
  items: Array<{ product_id?: string | null; name?: string; variant?: string; qty?: number }>;
};

/** ลูกค้าที่ทักเข้ามาในช่วงนั้น */
export type ContactFact = {
  id: string;
  page_id: string | null;
  /** ISO */
  first_contact_at: string;
  referral_ad_id: string | null;
};

/** ออเดอร์ที่ "ยกเลิก/ตีกลับ" ไม่นับเป็นยอดขาย */
const DEAD_STATUSES = new Set(['cancelled', 'returned']);

export function isLiveOrder(o: OrderFact): boolean {
  return !DEAD_STATUSES.has(o.status);
}

/** ปัดเป็นทศนิยม 2 ตำแหน่ง — เงินต้องไม่มีเศษลอย */
export function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** เปอร์เซ็นต์ 0-100 ทศนิยม 1 ตำแหน่ง — หารศูนย์ต้องได้ 0 ไม่ใช่ NaN */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export type Headline = {
  sales: number;
  order_count: number;
  average_order: number;
  new_chats: number;
  close_rate: number;
  /** ชั่วโมงเฉลี่ยจาก "ลูกค้าทักครั้งแรก" ถึง "ปิดการขาย" — null = ยังไม่มีข้อมูลพอ */
  avg_hours_to_close: number | null;
};

/**
 * ตัวเลขหลัก
 * @param orders ออเดอร์ที่สร้างในช่วงเวลานั้น
 * @param contacts ลูกค้าที่ทักครั้งแรกในช่วงเวลานั้น
 */
export function headline(orders: OrderFact[], contacts: ContactFact[]): Headline {
  const live = orders.filter(isLiveOrder);
  const sales = money(live.reduce((s, o) => s + Number(o.total || 0), 0));

  /**
   * ⚠️ เวลาปิดการขายนับเฉพาะใบที่มีทั้งสองเวลาและเรียงถูกทาง
   *    ออเดอร์ที่สร้างย้อนหลัง (closed_at < first_contact_at) จะได้ค่าติดลบ
   *    ถ้าปล่อยเข้าไป ค่าเฉลี่ยจะเพี้ยนแบบหาสาเหตุยาก
   */
  const spans = live
    .map((o) => {
      if (!o.closed_at || !o.first_contact_at) return null;
      const ms = new Date(o.closed_at).getTime() - new Date(o.first_contact_at).getTime();
      return ms >= 0 ? ms / 3_600_000 : null;
    })
    .filter((v): v is number => v !== null);

  return {
    sales,
    order_count: live.length,
    average_order: live.length === 0 ? 0 : money(sales / live.length),
    new_chats: contacts.length,
    close_rate: percent(live.length, contacts.length),
    avg_hours_to_close:
      spans.length === 0 ? null : Math.round((spans.reduce((a, b) => a + b, 0) / spans.length) * 10) / 10,
  };
}

/* ------------------------------------------------------------------------ */
/* ตารางแยกตามแอด — ตารางที่มีค่าที่สุดตามสเปก                                   */
/* ------------------------------------------------------------------------ */

export type AdRow = {
  ad_id: string;
  /** แชทที่มาจากแอดนี้ */
  chats: number;
  /** ออเดอร์ที่ปิดได้จากแอดนี้ */
  closed: number;
  close_rate: number;
  sales: number;
};

/**
 * แยกผลตามแอด
 *
 * ⭐ "แชทเข้า" นับจากลูกค้าที่ทักครั้งแรกและมี referral_ad_id
 *    ส่วน "ปิดได้" นับจากออเดอร์ที่มี referral_ad_id เดียวกัน
 *    ทั้งสองฝั่งเก็บค่าไว้ตั้งแต่ตอนเกิดเหตุ ไม่ได้ย้อนไปถามใหม่
 *    → ตัวเลขจึงไม่เปลี่ยนย้อนหลังแม้ลูกค้าจะทักซ้ำจากแอดอื่นทีหลัง
 */
export function byAd(orders: OrderFact[], contacts: ContactFact[]): AdRow[] {
  const map = new Map<string, AdRow>();

  const touch = (id: string): AdRow => {
    let row = map.get(id);
    if (!row) {
      row = { ad_id: id, chats: 0, closed: 0, close_rate: 0, sales: 0 };
      map.set(id, row);
    }
    return row;
  };

  for (const c of contacts) {
    if (!c.referral_ad_id) continue;
    touch(c.referral_ad_id).chats += 1;
  }

  for (const o of orders) {
    if (!o.referral_ad_id || !isLiveOrder(o)) continue;
    const row = touch(o.referral_ad_id);
    row.closed += 1;
    row.sales = money(row.sales + Number(o.total || 0));
  }

  for (const row of map.values()) row.close_rate = percent(row.closed, row.chats);

  // เรียงตามยอดขายมากไปน้อย แล้วตัดสินด้วยชื่อแอดให้ลำดับคงที่
  return [...map.values()].sort((a, b) => {
    if (a.sales !== b.sales) return b.sales - a.sales;
    return a.ad_id < b.ad_id ? -1 : a.ad_id > b.ad_id ? 1 : 0;
  });
}

/* ------------------------------------------------------------------------ */
/* แยกตามเพจ / แอดมิน / สินค้า / รายวัน                                        */
/* ------------------------------------------------------------------------ */

export type GroupRow = { key: string; order_count: number; sales: number };

function groupBy(orders: OrderFact[], pick: (o: OrderFact) => string | null): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const o of orders) {
    if (!isLiveOrder(o)) continue;
    const key = pick(o);
    if (!key) continue;
    const row = map.get(key) ?? { key, order_count: 0, sales: 0 };
    row.order_count += 1;
    row.sales = money(row.sales + Number(o.total || 0));
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => {
    if (a.sales !== b.sales) return b.sales - a.sales;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

export const byPage = (orders: OrderFact[]): GroupRow[] => groupBy(orders, (o) => o.page_id);
export const byAdmin = (orders: OrderFact[]): GroupRow[] => groupBy(orders, (o) => o.created_by_admin_id);

export type ProductRow = { name: string; qty: number; sales: number };

/** สินค้าขายดี — นับจากรายการในออเดอร์ */
export function topProducts(orders: OrderFact[], limit = 10): ProductRow[] {
  const map = new Map<string, ProductRow>();
  for (const o of orders) {
    if (!isLiveOrder(o)) continue;
    for (const item of o.items ?? []) {
      const name = (item.variant || item.name || '').trim();
      if (!name) continue;
      const qty = Number(item.qty ?? 0);
      const row = map.get(name) ?? { name, qty: 0, sales: 0 };
      row.qty += qty > 0 ? qty : 0;
      map.set(name, row);
    }
  }
  return [...map.values()]
    .sort((a, b) => (a.qty !== b.qty ? b.qty - a.qty : a.name < b.name ? -1 : 1))
    .slice(0, limit);
}

export type DayRow = { day: string; order_count: number; sales: number; new_chats: number };

/**
 * กราฟรายวัน
 * @param days รายการวันที่ต้องแสดง (รูปแบบ YYYY-MM-DD ตามเวลาไทย) — ส่งเข้ามาเพื่อให้ฟังก์ชันบริสุทธิ์
 *
 * ⭐ ต้องคืนครบทุกวันแม้วันนั้นไม่มีของเลย
 *    ไม่งั้นกราฟจะกระโดดข้ามวัน แล้วอ่านผิดว่า "ขายดีทุกวัน"
 */
export function byDay(
  orders: OrderFact[],
  contacts: ContactFact[],
  days: string[],
  dayOf: (iso: string) => string,
): DayRow[] {
  const map = new Map<string, DayRow>(
    days.map((d) => [d, { day: d, order_count: 0, sales: 0, new_chats: 0 }]),
  );

  for (const o of orders) {
    if (!isLiveOrder(o)) continue;
    const row = map.get(dayOf(o.created_at));
    if (!row) continue;
    row.order_count += 1;
    row.sales = money(row.sales + Number(o.total || 0));
  }

  for (const c of contacts) {
    const row = map.get(dayOf(c.first_contact_at));
    if (row) row.new_chats += 1;
  }

  return days.map((d) => map.get(d)!);
}

export type HourRow = { hour: number; chats: number };

/** ช่วงเวลาที่ลูกค้าทักเยอะ — 24 ช่อง ครบเสมอ */
export function byHour(contacts: ContactFact[], hourOf: (iso: string) => number): HourRow[] {
  const counts = new Array<number>(24).fill(0);
  for (const c of contacts) {
    const h = hourOf(c.first_contact_at);
    if (Number.isInteger(h) && h >= 0 && h < 24) counts[h] += 1;
  }
  return counts.map((chats, hour) => ({ hour, chats }));
}
