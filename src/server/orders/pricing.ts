/**
 * คำนวณราคาออเดอร์ (สเปกหัวข้อ 4)
 * ===========================================================================
 * ⚠️ ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ล้วน — ห้ามต่อฐานข้อมูล ห้ามยิงเน็ต
 *
 * 🔴 ทำไมต้องแยกออกมาและทดสอบหนัก :
 *    คิดราคาผิด = เสียเงินจริงทุกออเดอร์ และรู้ตัวช้ามาก
 *    (ลูกค้าไม่ทักมาบอกว่า "คิดถูกไปนะ")
 *
 * ⭐ กฎเหล็กจากสเปก : "ราคาคำนวณอัตโนมัติ แต่แก้ทับได้เสมอ"
 *    ระบบเป็นแค่ผู้ช่วยคิดเลข ไม่ใช่ผู้ตัดสิน
 *    ถ้าแอดมินใส่ราคาเอง ต้องใช้ราคานั้นเสมอ ห้ามคำนวณทับ
 */
import type { OrderItem, PromotionType } from '@/types/db';

/* ------------------------------------------------------------------------ */
/* ชนิดข้อมูล                                                                 */
/* ------------------------------------------------------------------------ */

export type PromotionConfig = {
  /** ต้องเลือกกี่ชิ้น (โปร 3 แถม 1 = 4) */
  pick?: number;
  /** จ่ายราคากี่ชิ้น (โปร 3 แถม 1 = 3) */
  pay?: number;
};

export type Promotion = {
  id: string;
  name: string;
  type: PromotionType;
  config: PromotionConfig;
  /** ราคาเหมาของทั้งแพ็ก (ถ้ากำหนดไว้ จะชนะการคำนวณรายชิ้น) */
  price: number | null;
};

export type PickedProduct = {
  id: string;
  name: string;
  variant: string | null;
  price: number;
};

export type PriceBreakdown = {
  items: OrderItem[];
  subtotal: number;
  shipping_fee: number;
  discount: number;
  total: number;
  /** อธิบายให้แอดมินเห็นว่าคิดมายังไง — โชว์ใต้ยอดรวม */
  explain_th: string;
};

export class PricingError extends Error {}

/* ------------------------------------------------------------------------ */
/* ตัวช่วย                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * ปัดเป็นทศนิยม 2 ตำแหน่งแบบไม่เพี้ยน
 * ⚠️ ห้ามใช้ตัวเลขทศนิยมบวกกันตรง ๆ แล้วเก็บเลย
 *    0.1 + 0.2 ในคอมพิวเตอร์ได้ 0.30000000000000004
 *    สะสมหลายรายการแล้วยอดจะเพี้ยนหลักสตางค์ ซึ่งลูกค้าเห็น
 */
export function money(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** จำนวนชิ้นที่โปรนี้บังคับให้เลือก */
export function requiredPickCount(promotion: Promotion): number {
  switch (promotion.type) {
    case 'single':
      return 1;
    case 'bundle':
    case 'buy_x_get_y':
      return Math.max(1, promotion.config.pick ?? 1);
    case 'boxset':
      // boxset = ครบทุกสี — จำนวนขึ้นกับสินค้าที่มีอยู่ ให้ผู้เรียกกำหนดผ่าน pick
      return Math.max(1, promotion.config.pick ?? 0);
    default:
      return 1;
  }
}

/* ------------------------------------------------------------------------ */
/* ตัวหลัก                                                                    */
/* ------------------------------------------------------------------------ */

export type CalculateInput = {
  promotion: Promotion | null;
  /** สินค้าที่แอดมินจิ้มเลือก เรียงตามที่เลือก */
  picked: PickedProduct[];
  shipping_fee?: number;
  /** ส่วนลดเพิ่มเติมที่แอดมินใส่เอง (นอกเหนือจากส่วนลดของโปร) */
  extra_discount?: number;
  /**
   * ⭐ ราคาที่แอดมินใส่ทับเอง — ถ้ามีค่า จะชนะทุกอย่าง
   *    (สเปก : "ราคาคำนวณอัตโนมัติ แต่แก้ทับได้เสมอ")
   */
  manual_total?: number | null;
};

export function calculateOrder(input: CalculateInput): PriceBreakdown {
  const shipping = money(Math.max(0, input.shipping_fee ?? 0));
  const extraDiscount = money(Math.max(0, input.extra_discount ?? 0));

  /* ---------------- ไม่มีโปร : คิดรายชิ้นตรง ๆ ---------------- */
  if (!input.promotion) {
    const items = itemsOf(input.picked);
    const sum = money(items.reduce((s, i) => s + i.total, 0));
    return finish(items, sum, shipping, extraDiscount, input.manual_total, 'คิดราคาตามรายชิ้น');
  }

  const promo = input.promotion;
  const need = requiredPickCount(promo);

  if (promo.type !== 'single' && need > 0 && input.picked.length !== need) {
    throw new PricingError(`โปร "${promo.name}" ต้องเลือก ${need} ชิ้น (ตอนนี้เลือก ${input.picked.length} ชิ้น)`);
  }
  if (input.picked.length === 0) {
    throw new PricingError('ยังไม่ได้เลือกสินค้า');
  }

  const items = itemsOf(input.picked);
  const fullPrice = money(items.reduce((s, i) => s + i.total, 0));

  /* ---------------- ราคาเหมาของแพ็ก ---------------- */
  if (promo.price !== null && promo.price > 0) {
    const packPrice = money(promo.price);
    // ⭐ ราคาเหมาคือ "ราคาของแพ็กนี้" — ชนะการคำนวณรายชิ้นเสมอ
    //    ไม่ได้แปลงเป็นส่วนลดแล้วลบออก เพราะถ้าราคาเหมาแพงกว่าราคาเต็ม
    //    การคิดแบบส่วนลดจะทำให้ได้ยอดผิด (ตกไปใช้ราคาเต็มแทน)
    const warn =
      packPrice > fullPrice
        ? ' ⚠️ ราคาเหมาแพงกว่าราคารายชิ้น — ตรวจการตั้งค่าโปรอีกครั้ง'
        : '';
    return finish(
      items,
      packPrice,
      shipping,
      extraDiscount,
      input.manual_total,
      `โปร "${promo.name}" ราคาเหมา ${packPrice.toLocaleString('th-TH')} บาท${warn}`,
    );
  }

  /* ---------------- ซื้อ X แถม Y : ชิ้นที่ถูกที่สุดฟรี ---------------- */
  if (promo.type === 'buy_x_get_y') {
    const pay = Math.max(1, Math.min(promo.config.pay ?? need, need));
    const freeCount = Math.max(0, need - pay);

    if (freeCount > 0) {
      // ⭐ ให้ของถูกที่สุดเป็นของแถม — เป็นผลดีกับลูกค้าน้อยที่สุดแต่เป็นมาตรฐานร้านค้า
      //    ถ้าจะให้ของแพงฟรี ต้องตั้งใจเปลี่ยนตรงนี้ที่เดียว
      const sorted = [...items].sort((a, b) => a.unit_price - b.unit_price);
      const promoDiscount = money(sorted.slice(0, freeCount).reduce((s, i) => s + i.unit_price, 0));
      return finish(
        items,
        money(fullPrice - promoDiscount),
        shipping,
        extraDiscount,
        input.manual_total,
        `โปร "${promo.name}" — เลือก ${need} จ่าย ${pay} (ฟรี ${freeCount} ชิ้นที่ราคาต่ำสุด)`,
      );
    }
  }

  /* ---------------- โปรอื่นที่ไม่ได้ตั้งราคาเหมา ---------------- */
  return finish(items, fullPrice, shipping, extraDiscount, input.manual_total, `โปร "${promo.name}" คิดราคาตามรายชิ้น`);
}

/* ------------------------------------------------------------------------ */

function itemsOf(picked: PickedProduct[]): OrderItem[] {
  // รวมสินค้าตัวเดียวกันที่เลือกซ้ำให้เป็นแถวเดียว (เช่นเลือกสีแดง 2 อัน)
  const map = new Map<string, OrderItem>();
  for (const p of picked) {
    const key = `${p.id}::${p.variant ?? ''}`;
    const existing = map.get(key);
    const unit = money(p.price);
    if (existing) {
      existing.qty += 1;
      existing.total = money(existing.unit_price * existing.qty);
    } else {
      map.set(key, {
        product_id: p.id,
        name: p.name,
        variant: p.variant ?? undefined,
        qty: 1,
        unit_price: unit,
        total: unit,
      });
    }
  }
  return [...map.values()];
}

function finish(
  items: OrderItem[],
  /** ราคาสินค้าหลังคิดโปรแล้ว (ยังไม่รวมค่าส่งและส่วนลดที่แอดมินใส่เอง) */
  goodsAfterPromo: number,
  shipping: number,
  extraDiscount: number,
  manualTotal: number | null | undefined,
  explain: string,
): PriceBreakdown {
  const subtotal = money(items.reduce((s, i) => s + i.total, 0));

  // ส่วนลดที่บันทึกไว้ = ส่วนที่หายไปจากราคาเต็ม + ที่แอดมินใส่เอง
  // ถ้าโปรตั้งราคาไว้แพงกว่าราคาเต็ม ส่วนแรกจะเป็น 0 ไม่ใช่ติดลบ
  const promoDiscount = money(Math.max(0, subtotal - goodsAfterPromo));
  const discount = money(promoDiscount + extraDiscount);

  // ⚠️ ยอดรวมห้ามติดลบ — ส่วนลดมากกว่ายอดสินค้าถือว่าฟรี ไม่ใช่ร้านจ่ายเงินให้ลูกค้า
  const computed = money(Math.max(0, money(goodsAfterPromo - extraDiscount)) + shipping);

  const useManual = manualTotal !== null && manualTotal !== undefined && Number.isFinite(manualTotal);
  const total = useManual ? money(Math.max(0, manualTotal)) : computed;

  return {
    items,
    subtotal,
    shipping_fee: shipping,
    discount,
    total,
    explain_th: useManual
      ? `⚠️ ใช้ราคาที่กรอกเอง ${total.toLocaleString('th-TH')} บาท (ระบบคำนวณได้ ${computed.toLocaleString('th-TH')} บาท)`
      : explain,
  };
}
