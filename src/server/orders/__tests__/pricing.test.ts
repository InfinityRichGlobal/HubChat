/**
 * ชุดทดสอบการคำนวณราคา (สเปกหัวข้อ 4)
 * ===========================================================================
 * 🔴 คิดราคาผิด = เสียเงินจริงทุกออเดอร์ และรู้ตัวช้ามาก
 *    ลูกค้าไม่ทักมาบอกว่า "คิดถูกไปนะ" — ชุดนี้จึงต้องละเอียด
 */
import { describe, it, expect } from 'vitest';
import { calculateOrder, money, PricingError, requiredPickCount, type Promotion, type PickedProduct } from '../pricing';

const color = (id: string, name: string, price = 290): PickedProduct => ({
  id,
  name: 'ลิปสติก',
  variant: name,
  price,
});

const RED = color('p1', 'แดงอิฐ');
const PINK = color('p2', 'ชมพูนู้ด');
const ORANGE = color('p3', 'ส้มพีช');
const BROWN = color('p4', 'น้ำตาลช็อก');

const single: Promotion = { id: 's', name: '1 ชิ้น', type: 'single', config: {}, price: null };
const twoPack: Promotion = { id: 'b', name: 'โปร 2 ชิ้น', type: 'bundle', config: { pick: 2 }, price: 500 };
const threeFreeOne: Promotion = {
  id: 'x',
  name: 'โปร 3 แถม 1',
  type: 'buy_x_get_y',
  config: { pick: 4, pay: 3 },
  price: null,
};

/* ================================================================== */
describe('ปัดเศษสตางค์', () => {
  it('🔴 ทศนิยมต้องไม่เพี้ยนจากการบวกกันตรง ๆ', () => {
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(290 * 3)).toBe(870);
    expect(money(166.666)).toBe(166.67);
  });

  it('ค่าที่ไม่ใช่ตัวเลข → 0 ไม่ใช่ NaN', () => {
    expect(money(NaN)).toBe(0);
    expect(money(Infinity)).toBe(0);
  });
});

/* ================================================================== */
describe('จำนวนชิ้นที่ต้องเลือก', () => {
  it('1 ชิ้น → 1', () => expect(requiredPickCount(single)).toBe(1));
  it('โปร 2 ชิ้น → 2', () => expect(requiredPickCount(twoPack)).toBe(2));
  it('โปร 3 แถม 1 → 4 (เลือก 4 จ่าย 3)', () => expect(requiredPickCount(threeFreeOne)).toBe(4));
});

/* ================================================================== */
describe('ไม่มีโปร — คิดรายชิ้น', () => {
  it('2 ชิ้นราคาเต็ม', () => {
    const r = calculateOrder({ promotion: null, picked: [RED, PINK] });
    expect(r.subtotal).toBe(580);
    expect(r.discount).toBe(0);
    expect(r.total).toBe(580);
  });

  it('สินค้าคนละราคา บวกถูกต้อง', () => {
    const r = calculateOrder({ promotion: null, picked: [color('a', 'ถูก', 150), color('b', 'แพง', 450)] });
    expect(r.subtotal).toBe(600);
  });
});

/* ================================================================== */
describe('โปรราคาเหมา', () => {
  it('โปร 2 ชิ้น 500 บาท (เต็ม 580) → ส่วนลด 80', () => {
    const r = calculateOrder({ promotion: twoPack, picked: [RED, PINK] });
    expect(r.subtotal).toBe(580);
    expect(r.discount).toBe(80);
    expect(r.total).toBe(500);
  });

  it('🔴 ราคาเหมาแพงกว่าราคาเต็ม → ใช้ราคาเหมา ส่วนลดเป็น 0 และเตือนให้ตรวจการตั้งค่า', () => {
    const pricey: Promotion = { ...twoPack, price: 700 };
    const r = calculateOrder({ promotion: pricey, picked: [RED, PINK] });
    expect(r.discount).toBe(0);
    // ราคาเหมาคือราคาของแพ็ก ต้องชนะการคำนวณรายชิ้นเสมอ
    expect(r.total).toBe(700);
    expect(r.explain_th).toContain('ตรวจการตั้งค่าโปร');
  });

  it('เลือกไม่ครบตามที่โปรกำหนด → ปฏิเสธพร้อมบอกว่าต้องกี่ชิ้น', () => {
    expect(() => calculateOrder({ promotion: twoPack, picked: [RED] })).toThrow(PricingError);
    expect(() => calculateOrder({ promotion: twoPack, picked: [RED] })).toThrow(/ต้องเลือก 2 ชิ้น/);
  });

  it('เลือกเกิน → ปฏิเสธเช่นกัน', () => {
    expect(() => calculateOrder({ promotion: twoPack, picked: [RED, PINK, ORANGE] })).toThrow(PricingError);
  });
});

/* ================================================================== */
describe('โปรซื้อ X แถม Y', () => {
  it('เลือก 4 จ่าย 3 (ราคาเท่ากันหมด) → ลด 1 ชิ้น', () => {
    const r = calculateOrder({ promotion: threeFreeOne, picked: [RED, PINK, ORANGE, BROWN] });
    expect(r.subtotal).toBe(1160);
    expect(r.discount).toBe(290);
    expect(r.total).toBe(870);
  });

  it('⭐ ราคาไม่เท่ากัน → ของแถมคือชิ้นที่ถูกที่สุด', () => {
    const r = calculateOrder({
      promotion: threeFreeOne,
      picked: [color('a', 'a', 500), color('b', 'b', 400), color('c', 'c', 300), color('d', 'd', 200)],
    });
    expect(r.subtotal).toBe(1400);
    expect(r.discount).toBe(200); // ชิ้นที่ถูกที่สุด
    expect(r.total).toBe(1200);
  });

  it('อธิบายให้แอดมินอ่านรู้เรื่องว่าฟรีกี่ชิ้น', () => {
    const r = calculateOrder({ promotion: threeFreeOne, picked: [RED, PINK, ORANGE, BROWN] });
    expect(r.explain_th).toContain('เลือก 4 จ่าย 3');
  });
});

/* ================================================================== */
describe('⭐ ราคาที่แอดมินกรอกเองต้องชนะเสมอ (สเปกข้อ 4)', () => {
  it('กรอกทับแล้วต้องใช้ค่านั้น ไม่ใช่ค่าที่คำนวณได้', () => {
    const r = calculateOrder({ promotion: twoPack, picked: [RED, PINK], manual_total: 450 });
    expect(r.total).toBe(450);
    // ยอดสินค้ากับส่วนลดยังคำนวณไว้ให้ดูอ้างอิง
    expect(r.subtotal).toBe(580);
  });

  it('บอกให้ชัดว่าใช้ราคาที่กรอกเอง และระบบคำนวณได้เท่าไหร่', () => {
    const r = calculateOrder({ promotion: twoPack, picked: [RED, PINK], manual_total: 450 });
    expect(r.explain_th).toContain('ใช้ราคาที่กรอกเอง');
    expect(r.explain_th).toContain('500'); // ค่าที่ระบบคำนวณได้
  });

  it('กรอก 0 ได้ (แถมฟรี) และต้องไม่ตกไปใช้ค่าคำนวณ', () => {
    const r = calculateOrder({ promotion: twoPack, picked: [RED, PINK], manual_total: 0 });
    expect(r.total).toBe(0);
  });

  it('ไม่กรอก (null / undefined) → ใช้ค่าที่คำนวณได้', () => {
    expect(calculateOrder({ promotion: twoPack, picked: [RED, PINK], manual_total: null }).total).toBe(500);
    expect(calculateOrder({ promotion: twoPack, picked: [RED, PINK] }).total).toBe(500);
  });
});

/* ================================================================== */
describe('ค่าส่งและส่วนลดเพิ่มเติม', () => {
  it('ค่าส่งบวกทีหลังส่วนลดเสมอ', () => {
    const r = calculateOrder({ promotion: twoPack, picked: [RED, PINK], shipping_fee: 50 });
    expect(r.total).toBe(550);
  });

  it('ส่วนลดเพิ่มเติมรวมกับส่วนลดของโปร', () => {
    const r = calculateOrder({ promotion: twoPack, picked: [RED, PINK], extra_discount: 100 });
    expect(r.discount).toBe(180); // 80 จากโปร + 100 ที่ใส่เอง
    expect(r.total).toBe(400);
  });

  it('🔴 ส่วนลดมากกว่ายอดสินค้า → ยอดรวมต้องไม่ติดลบ', () => {
    const r = calculateOrder({ promotion: null, picked: [RED], extra_discount: 9999 });
    expect(r.total).toBe(0);
  });

  it('ส่วนลดเกินยอด แต่มีค่าส่ง → จ่ายเฉพาะค่าส่ง', () => {
    const r = calculateOrder({ promotion: null, picked: [RED], extra_discount: 9999, shipping_fee: 50 });
    expect(r.total).toBe(50);
  });

  it('ค่าส่งติดลบไม่ได้', () => {
    const r = calculateOrder({ promotion: null, picked: [RED], shipping_fee: -100 });
    expect(r.shipping_fee).toBe(0);
  });
});

/* ================================================================== */
describe('รวมรายการที่ซ้ำกัน', () => {
  it('เลือกสีเดียวกัน 2 ครั้ง → รวมเป็นแถวเดียว qty 2', () => {
    const r = calculateOrder({ promotion: twoPack, picked: [RED, RED] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].qty).toBe(2);
    expect(r.items[0].total).toBe(580);
  });

  it('สินค้าเดียวกันแต่คนละสี → คนละแถว', () => {
    const r = calculateOrder({ promotion: twoPack, picked: [RED, PINK] });
    expect(r.items).toHaveLength(2);
  });
});

/* ================================================================== */
describe('กรณีขอบ', () => {
  it('ไม่เลือกอะไรเลย → ปฏิเสธ', () => {
    expect(() => calculateOrder({ promotion: single, picked: [] })).toThrow(/ยังไม่ได้เลือกสินค้า/);
  });

  it('ไม่มีโปรและไม่เลือกอะไร → ยอดเป็น 0 ไม่ล้ม', () => {
    const r = calculateOrder({ promotion: null, picked: [] });
    expect(r.total).toBe(0);
    expect(r.items).toEqual([]);
  });
});
