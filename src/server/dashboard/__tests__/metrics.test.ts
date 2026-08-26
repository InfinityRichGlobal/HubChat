/**
 * ชุดทดสอบตัวคำนวณ Dashboard (รอบ 9)
 * ===========================================================================
 * 🔴 ตัวเลขพวกนี้เอาไปตัดสินใจเรื่องเงินจริง
 *    "แอดตัวไหนคุ้ม ตัวไหนควรปิด" — คำนวณผิดแล้วปิดแอดที่กำลังทำกำไร
 *    คือความเสียหายที่มองไม่เห็นและกู้ยาก
 */
import { describe, it, expect } from 'vitest';
import {
  byAd, byAdmin, byDay, byHour, byPage, headline, isLiveOrder, money, percent, topProducts,
  type ContactFact, type OrderFact,
} from '../metrics';

function order(over: Partial<OrderFact> = {}): OrderFact {
  return {
    id: over.id ?? 'o1',
    total: over.total ?? 1000,
    status: over.status ?? 'completed',
    page_id: over.page_id ?? 'page-a',
    created_by_admin_id: over.created_by_admin_id ?? 'admin-1',
    referral_ad_id: over.referral_ad_id ?? null,
    created_at: over.created_at ?? '2026-08-20T03:00:00Z',
    closed_at: over.closed_at ?? null,
    first_contact_at: over.first_contact_at ?? null,
    items: over.items ?? [],
  };
}

function contact(over: Partial<ContactFact> = {}): ContactFact {
  return {
    id: over.id ?? 'c1',
    page_id: over.page_id ?? 'page-a',
    first_contact_at: over.first_contact_at ?? '2026-08-20T03:00:00Z',
    referral_ad_id: over.referral_ad_id ?? null,
  };
}

describe('ตัวช่วยพื้นฐาน', () => {
  it('🔴 หารศูนย์ต้องได้ 0 ไม่ใช่ NaN หรือ Infinity', () => {
    expect(percent(5, 0)).toBe(0);
    expect(Number.isFinite(percent(5, 0))).toBe(true);
  });

  it('เงินไม่มีเศษลอย', () => {
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(1000.005)).toBe(1000.01);
  });

  it('ออเดอร์ที่ยกเลิก/ตีกลับ ไม่นับเป็นของจริง', () => {
    expect(isLiveOrder(order({ status: 'cancelled' }))).toBe(false);
    expect(isLiveOrder(order({ status: 'returned' }))).toBe(false);
    expect(isLiveOrder(order({ status: 'shipped' }))).toBe(true);
    expect(isLiveOrder(order({ status: 'draft' }))).toBe(true);
  });
});

describe('ตัวเลขหลัก', () => {
  it('ยอดขาย / จำนวน / เฉลี่ย', () => {
    const h = headline([order({ total: 1000 }), order({ id: 'o2', total: 500 })], []);
    expect(h.sales).toBe(1500);
    expect(h.order_count).toBe(2);
    expect(h.average_order).toBe(750);
  });

  it('🔴 ออเดอร์ที่ยกเลิกต้องไม่เข้ายอดขาย', () => {
    const h = headline(
      [order({ total: 1000 }), order({ id: 'o2', total: 9999, status: 'cancelled' })],
      [],
    );
    expect(h.sales).toBe(1000);
    expect(h.order_count).toBe(1);
  });

  it('อัตราปิดการขาย = ออเดอร์ ÷ แชทใหม่', () => {
    const h = headline(
      [order(), order({ id: 'o2' })],
      [contact(), contact({ id: 'c2' }), contact({ id: 'c3' }), contact({ id: 'c4' })],
    );
    expect(h.new_chats).toBe(4);
    expect(h.close_rate).toBe(50);
  });

  it('ไม่มีแชทเลย = อัตราปิด 0 ไม่ใช่ระเบิด', () => {
    expect(headline([order()], []).close_rate).toBe(0);
  });

  it('ไม่มีอะไรเลย ทุกช่องต้องเป็น 0 / null', () => {
    const h = headline([], []);
    expect(h).toEqual({
      sales: 0, order_count: 0, average_order: 0,
      new_chats: 0, close_rate: 0, avg_hours_to_close: null,
    });
  });

  it('เวลาเฉลี่ยจากทักถึงปิดการขาย', () => {
    const h = headline(
      [
        order({ first_contact_at: '2026-08-20T00:00:00Z', closed_at: '2026-08-20T02:00:00Z' }),
        order({ id: 'o2', first_contact_at: '2026-08-20T00:00:00Z', closed_at: '2026-08-20T04:00:00Z' }),
      ],
      [],
    );
    expect(h.avg_hours_to_close).toBe(3);
  });

  it('🔴 ออเดอร์ที่ปิดก่อนลูกค้าทัก (ข้อมูลเพี้ยน) ต้องไม่ทำค่าเฉลี่ยพัง', () => {
    const h = headline(
      [
        order({ first_contact_at: '2026-08-20T00:00:00Z', closed_at: '2026-08-20T02:00:00Z' }),
        // ใบนี้เวลาติดลบ — ต้องถูกตัดออก ไม่ใช่ดึงค่าเฉลี่ยลง
        order({ id: 'o2', first_contact_at: '2026-08-20T10:00:00Z', closed_at: '2026-08-20T04:00:00Z' }),
      ],
      [],
    );
    expect(h.avg_hours_to_close).toBe(2);
  });

  it('ไม่มีใบไหนปิดเลย = null ไม่ใช่ 0 (0 แปลว่า "ปิดได้ทันที" ซึ่งคนละความหมาย)', () => {
    expect(headline([order()], []).avg_hours_to_close).toBeNull();
  });
});

describe('ตารางแยกตามแอด', () => {
  it('นับแชทเข้าและออเดอร์ที่ปิดได้แยกตามแอด', () => {
    const rows = byAd(
      [
        order({ referral_ad_id: 'ad-lip9', total: 2000 }),
        order({ id: 'o2', referral_ad_id: 'ad-lip9', total: 1000 }),
        order({ id: 'o3', referral_ad_id: 'ad-box', total: 500 }),
      ],
      [
        contact({ referral_ad_id: 'ad-lip9' }),
        contact({ id: 'c2', referral_ad_id: 'ad-lip9' }),
        contact({ id: 'c3', referral_ad_id: 'ad-lip9' }),
        contact({ id: 'c4', referral_ad_id: 'ad-lip9' }),
        contact({ id: 'c5', referral_ad_id: 'ad-box' }),
      ],
    );

    const lip9 = rows.find((r) => r.ad_id === 'ad-lip9')!;
    expect(lip9.chats).toBe(4);
    expect(lip9.closed).toBe(2);
    expect(lip9.close_rate).toBe(50);
    expect(lip9.sales).toBe(3000);

    // เรียงตามยอดขายมากไปน้อย
    expect(rows[0].ad_id).toBe('ad-lip9');
  });

  it('🔴 แอดที่มีแชทเข้าแต่ยังไม่ปิดได้เลย ต้องยังโผล่ในตาราง (อัตรา 0%)', () => {
    const rows = byAd([], [contact({ referral_ad_id: 'ad-เผาเงิน' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].chats).toBe(1);
    expect(rows[0].closed).toBe(0);
    expect(rows[0].close_rate).toBe(0);
    expect(rows[0].sales).toBe(0);
  });

  it('ออเดอร์ที่ยกเลิกต้องไม่นับเป็นปิดได้', () => {
    const rows = byAd(
      [order({ referral_ad_id: 'ad-x', status: 'cancelled', total: 9999 })],
      [contact({ referral_ad_id: 'ad-x' })],
    );
    expect(rows[0].closed).toBe(0);
    expect(rows[0].sales).toBe(0);
  });

  it('ลำดับต้องคงที่เมื่อยอดเท่ากัน', () => {
    const mk = () =>
      byAd(
        [order({ referral_ad_id: 'ad-b', total: 100 }), order({ id: 'o2', referral_ad_id: 'ad-a', total: 100 })],
        [],
      ).map((r) => r.ad_id);
    expect(mk()).toEqual(['ad-a', 'ad-b']);
    expect(mk()).toEqual(mk());
  });
});

describe('แยกตามเพจ / แอดมิน', () => {
  it('รวมยอดถูกต้อง', () => {
    const rows = byPage([
      order({ page_id: 'p1', total: 100 }),
      order({ id: 'o2', page_id: 'p1', total: 200 }),
      order({ id: 'o3', page_id: 'p2', total: 50 }),
    ]);
    expect(rows[0]).toEqual({ key: 'p1', order_count: 2, sales: 300 });
  });

  it('แอดมิน', () => {
    const rows = byAdmin([order({ created_by_admin_id: 'a1', total: 700 })]);
    expect(rows[0].key).toBe('a1');
    expect(rows[0].sales).toBe(700);
  });
});

describe('สินค้าขายดี', () => {
  it('รวมจำนวนตามชื่อ และเรียงจากมากไปน้อย', () => {
    const rows = topProducts([
      order({ items: [{ name: 'ลิป', variant: 'ลิป #01', qty: 2 }] }),
      order({ id: 'o2', items: [{ name: 'ลิป', variant: 'ลิป #01', qty: 3 }, { name: 'กล่อง', qty: 1 }] }),
    ]);
    expect(rows[0]).toEqual({ name: 'ลิป #01', qty: 5, sales: 0 });
    expect(rows[1].name).toBe('กล่อง');
  });

  it('รายการที่ไม่มีชื่อ ต้องไม่ทำให้พัง', () => {
    expect(topProducts([order({ items: [{ qty: 5 }] })])).toEqual([]);
  });
});

describe('กราฟรายวัน', () => {
  const dayOf = (iso: string) => iso.slice(0, 10);

  it('🔴 ต้องคืนครบทุกวันแม้วันนั้นไม่มีของ (ไม่งั้นกราฟกระโดดข้ามวัน)', () => {
    const rows = byDay(
      [order({ created_at: '2026-08-20T03:00:00Z', total: 500 })],
      [contact({ first_contact_at: '2026-08-22T03:00:00Z' })],
      ['2026-08-20', '2026-08-21', '2026-08-22'],
      dayOf,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ day: '2026-08-20', order_count: 1, sales: 500, new_chats: 0 });
    expect(rows[1]).toEqual({ day: '2026-08-21', order_count: 0, sales: 0, new_chats: 0 });
    expect(rows[2].new_chats).toBe(1);
  });

  it('ของที่อยู่นอกช่วง ต้องไม่ถูกนับ', () => {
    const rows = byDay(
      [order({ created_at: '2026-01-01T00:00:00Z', total: 9999 })],
      [],
      ['2026-08-20'],
      dayOf,
    );
    expect(rows[0].sales).toBe(0);
  });
});

describe('ช่วงเวลาที่ลูกค้าทักเยอะ', () => {
  const hourOf = (iso: string) => Number(iso.slice(11, 13));

  it('ต้องได้ครบ 24 ช่องเสมอ', () => {
    const rows = byHour([contact({ first_contact_at: '2026-08-20T14:30:00Z' })], hourOf);
    expect(rows).toHaveLength(24);
    expect(rows[14].chats).toBe(1);
    expect(rows[0].chats).toBe(0);
  });

  it('เวลาที่อ่านไม่ออก ต้องไม่ทำให้พัง', () => {
    expect(byHour([contact({ first_contact_at: 'ขยะ' })], hourOf)).toHaveLength(24);
  });
});
