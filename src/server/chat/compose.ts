/**
 * ประกอบข้อความสำเร็จรูปจากข้อมูลจริง (ก้อน 2 ข้อ 1.8 / 1.9 / 1.10)
 * ===========================================================================
 * ⚠️ ไฟล์นี้เป็น **ฟังก์ชันบริสุทธิ์ล้วน ๆ** ห้ามต่อฐานข้อมูล ห้ามอ่านเวลาปัจจุบัน
 *    ผู้เรียกฝั่งเซิร์ฟเวอร์เป็นคนไปหาค่าจริงมาให้ แล้วส่งเข้ามาที่นี่
 *
 * 🔴 กฎที่สำคัญที่สุดของไฟล์นี้ : **ห้ามส่งข้อความที่ยังไม่สมบูรณ์ออกไปหาลูกค้า**
 *
 *    ทุกฟังก์ชันจึงคืน `missing` มาด้วยเสมอ = ช่องที่ยังไม่มีข้อมูลจริง
 *    หน้าเว็บต้องเอาไปเตือนก่อน ไม่ใช่ปล่อยให้กดส่ง
 *
 *    ทำไมถึงสำคัญขนาดนั้น :
 *      • ข้อความจัดส่งที่ขาดเลขพัสดุ = ลูกค้ารอของที่ไม่มีเลขให้ตาม
 *      • ข้อความที่มี {{order_total}} ดิบ ๆ หลุดไป = ลูกค้าเห็นโค้ดแล้วงง
 *        และร้านดูไม่น่าเชื่อถือทันที
 *      ทั้งสองอย่างแก้ทีหลังไม่ได้ เพราะข้อความส่งออกไปแล้ว
 *
 * 🔴 ค่าที่เป็น "ความจริงของร้าน" (ราคา / ยอด / เลขพัสดุ) ต้องมาจากเซิร์ฟเวอร์เสมอ
 *    เบราว์เซอร์คำนวณเองไม่ได้เด็ดขาด (กฎเดียวกับ D-5 : ห้ามมีสูตรราคาสองที่)
 */

/* ------------------------------------------------------------------------ */
/* ตัวแปรในชุดคำตอบสำเร็จรูป (ข้อ 1.9)                                        */
/* ------------------------------------------------------------------------ */

/** ตัวแปรที่ระบบรู้จัก — นอกเหนือจากนี้ถือว่าไม่รู้จัก */
export const KNOWN_VARIABLES = [
  'customer_name',
  'order_number',
  'order_total',
  'tracking_number',
  'carrier',
] as const;

export type VariableName = (typeof KNOWN_VARIABLES)[number];

export const VARIABLE_LABEL_TH: Record<VariableName, string> = {
  customer_name: 'ชื่อลูกค้า',
  order_number: 'เลขออเดอร์',
  order_total: 'ยอดรวม',
  tracking_number: 'เลขพัสดุ',
  carrier: 'ขนส่ง',
};

/** ค่าที่เซิร์ฟเวอร์หามาได้จริง — null = ยังไม่มี */
export type VariableValues = Partial<Record<VariableName, string | null>>;

export type ResolveResult = {
  text: string;
  /** ตัวแปรที่มีในข้อความ แต่ยังไม่มีค่าจริง — ต้องเตือนก่อนส่ง */
  missing: VariableName[];
  /** ตัวแปรที่เขียนมาแต่ระบบไม่รู้จัก — สะกดผิดหรือของเก่า */
  unknown: string[];
};

/**
 * แทนค่าตัวแปรในข้อความ
 *
 * 🔴 ตัวแปรที่ไม่มีค่า จะถูก **คงไว้เป็น {{...}} ตามเดิม** โดยตั้งใจ
 *    ไม่ใช่แทนด้วยช่องว่าง
 *
 *    เพราะถ้าแทนด้วยช่องว่าง ข้อความจะกลายเป็น
 *    "เลขพัสดุของคุณคือ  ค่ะ" ซึ่งดู "ปกติพอจะกดส่ง"
 *    แล้วแอดมินที่รีบจะส่งออกไปโดยไม่ทันสังเกต
 *
 *    การคง {{tracking_number}} ไว้ทำให้ "ผิดจนมองข้ามไม่ได้"
 *    ประกอบกับ missing ที่คืนไป หน้าเว็บจะบล็อกการส่งได้อีกชั้น
 */
export function resolveVariables(template: string, values: VariableValues): ResolveResult {
  const missing = new Set<VariableName>();
  const unknown = new Set<string>();

  // รองรับช่องว่างรอบชื่อตัวแปร เช่น {{ order_total }}
  const text = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, rawName: string) => {
    const name = rawName as VariableName;

    if (!(KNOWN_VARIABLES as readonly string[]).includes(name)) {
      unknown.add(rawName);
      return whole;
    }

    const value = values[name];
    if (value === undefined || value === null || value.trim() === '') {
      missing.add(name);
      return whole;
    }
    return value;
  });

  return { text, missing: [...missing], unknown: [...unknown] };
}

/** ข้อความนี้พร้อมส่งไหม — ใช้ตัดสินว่าจะปล่อยให้กดส่งหรือเปล่า */
export function isReadyToSend(r: ResolveResult): boolean {
  return r.missing.length === 0 && r.unknown.length === 0;
}

/** คำเตือนภาษาไทยที่บอกว่าขาดอะไร */
export function explainMissing(r: ResolveResult): string | null {
  const parts: string[] = [];
  if (r.missing.length > 0) {
    parts.push(`ยังไม่มีข้อมูล : ${r.missing.map((m) => VARIABLE_LABEL_TH[m]).join(' · ')}`);
  }
  if (r.unknown.length > 0) {
    parts.push(`ตัวแปรที่ระบบไม่รู้จัก : ${r.unknown.join(' · ')}`);
  }
  return parts.length > 0 ? parts.join(' / ') : null;
}

/* ------------------------------------------------------------------------ */
/* ข้อมูลจัดส่ง (ข้อ 1.8)                                                     */
/* ------------------------------------------------------------------------ */

export type ShippingFacts = {
  recipient_name: string | null;
  phone: string | null;
  address: string | null;
  postcode: string | null;
  carrier: string | null;
  tracking_no: string | null;
};

export type ComposeResult = {
  text: string;
  /** ชื่อช่องที่ขาด (ภาษาไทย) — ว่าง = ครบ */
  missing_th: string[];
};

/**
 * ข้อความ "ข้อมูลจัดส่ง" สำหรับส่งให้ลูกค้ายืนยัน
 *
 * 🔴 ขาดข้อมูล = บอกว่าขาดอะไร ไม่ใช่ประกอบข้อความครึ่ง ๆ กลาง ๆ ให้
 *    ข้อความจัดส่งที่ขาดที่อยู่ = ลูกค้ายืนยันของที่ไม่มีอยู่จริง
 *    แล้วพัสดุจะถูกส่งไปผิดที่ ซึ่งเป็นความเสียหายที่แก้ทีหลังไม่ได้
 */
export function shippingInfoText(f: ShippingFacts): ComposeResult {
  const missing: string[] = [];
  if (!f.recipient_name?.trim()) missing.push('ชื่อผู้รับ');
  if (!f.phone?.trim()) missing.push('เบอร์โทร');
  if (!f.address?.trim()) missing.push('ที่อยู่');

  const lines = ['📦 ข้อมูลจัดส่ง', ''];
  if (f.recipient_name?.trim()) lines.push(`ชื่อ : ${f.recipient_name.trim()}`);
  if (f.phone?.trim()) lines.push(`เบอร์ : ${f.phone.trim()}`);
  if (f.address?.trim()) {
    const addr = f.postcode?.trim()
      ? `${f.address.trim()} ${f.postcode.trim()}`
      : f.address.trim();
    lines.push(`ที่อยู่ : ${addr}`);
  }

  // ⭐ เลขพัสดุยังไม่มีถือว่าปกติ (ยังไม่ได้ส่งของ) จึงไม่นับว่า "ขาด"
  if (f.carrier?.trim()) lines.push(`ขนส่ง : ${f.carrier.trim()}`);
  if (f.tracking_no?.trim()) lines.push(`เลขพัสดุ : ${f.tracking_no.trim()}`);

  lines.push('', 'รบกวนตรวจสอบความถูกต้องด้วยนะคะ 🙏');

  return { text: lines.join('\n'), missing_th: missing };
}

/* ------------------------------------------------------------------------ */
/* สินค้า (ข้อ 1.10)                                                          */
/* ------------------------------------------------------------------------ */

export type ProductFacts = {
  name: string;
  variant: string | null;
  qty: number;
  /** ⚠️ ราคาต้องมาจากเซิร์ฟเวอร์เท่านั้น เบราว์เซอร์ห้ามคำนวณเอง */
  price: number;
};

/** จัดรูปเงินบาทแบบที่คนไทยอ่านแล้วคุ้น */
export function baht(n: number): string {
  return `${n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} บาท`;
}

export function productText(
  items: ProductFacts[],
  options: { show_price?: boolean; promotions?: string[] } = {},
): ComposeResult {
  if (items.length === 0) return { text: '', missing_th: ['สินค้า'] };

  const lines: string[] = [];
  for (const p of items) {
    const title = p.variant?.trim() ? `${p.name} (${p.variant.trim()})` : p.name;
    const price = options.show_price ? ` — ${baht(p.price)}` : '';
    lines.push(`${title}${price}*${Math.max(1, p.qty)}ชิ้น`);
  }
  for (const promotion of options.promotions ?? []) lines.push(`🎁 ${promotion}`);
  return { text: lines.join('\n'), missing_th: [] };
}

/* ------------------------------------------------------------------------ */
/* สรุปออเดอร์ (ข้อ 1.7)                                                      */
/* ------------------------------------------------------------------------ */

export type OrderFacts = {
  order_no: string;
  items: Array<{ name: string; variant?: string | null; qty: number; total: number }>;
  subtotal: number;
  shipping_fee: number;
  discount: number;
  total: number;
  payment_method_th: string | null;
};

/**
 * สรุปออเดอร์เป็นข้อความให้ลูกค้ายืนยัน
 * ⚠️ ทุกตัวเลขมาจากออเดอร์จริงในฐานข้อมูล ไม่ใช่คำนวณใหม่ตรงนี้
 *    (สูตรราคาต้องมีที่เดียวคือ server/orders/pricing.ts — บทเรียน D-5)
 */
export function orderSummaryText(o: OrderFacts): ComposeResult {
  const lines = [`🧾 สรุปออเดอร์ ${o.order_no}`, ''];

  for (const it of o.items) {
    const title = it.variant?.trim() ? `${it.name} (${it.variant.trim()})` : it.name;
    lines.push(`• ${title} x${it.qty} — ${baht(it.total)}`);
  }

  lines.push('');
  lines.push(`ราคาสินค้า : ${baht(o.subtotal)}`);
  if (o.discount > 0) lines.push(`ส่วนลด : -${baht(o.discount)}`);
  if (o.shipping_fee > 0) lines.push(`ค่าส่ง : ${baht(o.shipping_fee)}`);
  lines.push(`รวมทั้งหมด : ${baht(o.total)}`);
  if (o.payment_method_th) lines.push(`ชำระโดย : ${o.payment_method_th}`);

  return { text: lines.join('\n'), missing_th: o.items.length === 0 ? ['รายการสินค้า'] : [] };
}
