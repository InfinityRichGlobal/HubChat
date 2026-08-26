/**
 * เดาว่าไฟล์นี้ของขนส่งเจ้าไหน และคอลัมน์ไหนคืออะไร (รอบ 8)
 * ===========================================================================
 * ⚠️ ฟังก์ชันบริสุทธิ์ล้วน ๆ
 *
 * ⭐ ทำไมต้องเดาให้ : ขนส่งแต่ละเจ้าตั้งชื่อคอลัมน์ไม่เหมือนกัน
 *    ถ้าให้เจ้าของร้านจับคู่คอลัมน์เองทุกครั้ง จะพลาดง่ายและช้ามาก
 *    แต่ "เดา" ต้องแก้ได้เสมอ — แอดมินยืนยันการจับคู่ก่อนนำเข้าเสมอ
 */

/** ช่องที่ระบบต้องใช้ */
export type TrackingField =
  | 'tracking_no'
  | 'order_ref'
  | 'phone'
  | 'postcode'
  | 'recipient_name'
  | 'carrier';

export type ColumnMapping = Partial<Record<TrackingField, string>>;

export type Courier = 'flash' | 'kerry' | 'jt' | 'thailand_post' | 'custom';

export const COURIER_LABEL_TH: Record<Courier, string> = {
  flash: 'Flash Express',
  kerry: 'Kerry Express',
  jt: 'J&T Express',
  thailand_post: 'ไปรษณีย์ไทย',
  custom: 'อื่น ๆ / กำหนดเอง',
};

/**
 * คำที่บอกว่าคอลัมน์นี้คืออะไร
 * ⚠️ เรียงจาก "เฉพาะเจาะจงที่สุด" ไปหากว้างที่สุดในแต่ละช่อง
 *    เพราะเราหยุดที่คำแรกที่เจอ — ถ้าเรียงกลับด้าน คำกว้างจะกินคำเฉพาะ
 */
const HINTS: Record<TrackingField, string[]> = {
  tracking_no: [
    'tracking no', 'tracking number', 'trackingno', 'tracking', 'awb', 'awb no',
    'consignment', 'barcode', 'pno', 'parcel no',
    'เลขพัสดุ', 'เลขติดตาม', 'เลขที่พัสดุ', 'หมายเลขพัสดุ', 'เลขแทรค',
  ],
  order_ref: [
    'order no', 'order number', 'order id', 'reference', 'ref no', 'ref',
    'customer ref', 'merchant order',
    'เลขออเดอร์', 'เลขที่ออเดอร์', 'เลขที่สั่งซื้อ', 'อ้างอิง', 'รหัสอ้างอิง',
  ],
  phone: [
    // ⚠️ เรียงจากเฉพาะเจาะจงที่สุดก่อนเสมอ — คำว่า "ผู้รับ" ต้องชนะคำว่า "เบอร์" เปล่า ๆ
    'receiver phone', 'consignee phone', 'recipient phone',
    'เบอร์ผู้รับ', 'เบอร์โทรผู้รับ', 'โทรผู้รับ',
    'phone no', 'phone', 'mobile', 'tel', 'contact',
    'เบอร์โทร', 'เบอร์', 'โทรศัพท์', 'โทร',
  ],
  postcode: [
    'postcode', 'post code', 'zipcode', 'zip code', 'zip', 'postal',
    'รหัสไปรษณีย์', 'ไปรษณีย์',
  ],
  recipient_name: [
    // ⚠️ เหมือนกัน : "ชื่อผู้รับ" ต้องชนะ "ชื่อ" เปล่า ๆ (ไฟล์ขนส่งมักมีชื่อผู้ส่งด้วย)
    'receiver name', 'consignee name', 'recipient name',
    'ชื่อผู้รับ', 'ชื่อผู้รับสินค้า', 'ผู้รับ',
    'recipient', 'receiver', 'customer name', 'name',
    'ชื่อลูกค้า', 'ชื่อ',
  ],
  carrier: ['carrier', 'courier', 'ขนส่ง', 'บริษัทขนส่ง'],
};

/** คำที่บอกว่าไฟล์นี้น่าจะของเจ้าไหน */
const COURIER_HINTS: Array<{ courier: Courier; words: string[] }> = [
  { courier: 'flash', words: ['flash', 'pno', 'แฟลช'] },
  { courier: 'kerry', words: ['kerry', 'kex', 'เคอรี่'] },
  { courier: 'jt', words: ['j&t', 'jt express', 'jne', 'เจแอนด์ที'] },
  { courier: 'thailand_post', words: ['thailand post', 'ems', 'ไปรษณีย์ไทย', 'ปณท'] },
];

function fold(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * เดาการจับคู่คอลัมน์จากหัวตาราง
 * คอลัมน์หนึ่งถูกใช้ได้ครั้งเดียว — กันเคส "ชื่อ" ไปโดนทั้งชื่อผู้รับและชื่อผู้ส่ง
 */
export function guessMapping(headers: string[]): ColumnMapping {
  const folded = headers.map((h) => ({ raw: h, key: fold(h) }));
  const used = new Set<string>();
  const mapping: ColumnMapping = {};

  const FIELD_ORDER: TrackingField[] = [
    'tracking_no', 'order_ref', 'phone', 'postcode', 'recipient_name', 'carrier',
  ];

  for (const field of FIELD_ORDER) {
    // รอบแรก : ตรงเป๊ะ
    let hit = folded.find((h) => !used.has(h.key) && HINTS[field].includes(h.key));

    /**
     * รอบสอง : มีคำนั้นอยู่ในชื่อคอลัมน์
     *
     * 🔴 ต้องวนที่ "คำใบ้" เป็นวงนอก ไม่ใช่วนที่คอลัมน์
     *    ตอนแรกเขียนกลับด้าน ทำให้ลำดับความเฉพาะเจาะจงของคำใบ้ไม่มีผลเลย
     *    ผลคือหัวตาราง ['เบอร์ผู้ส่งของ','เบอร์ผู้รับของ'] จะจับ "เบอร์ผู้ส่ง"
     *    เพราะเป็นคอลัมน์แรกที่มีคำว่า "เบอร์" — เลขพัสดุจะไปหาคนส่ง ไม่ใช่คนรับ
     */
    if (!hit) {
      for (const word of HINTS[field]) {
        hit = folded.find((h) => !used.has(h.key) && h.key.includes(word));
        if (hit) break;
      }
    }

    if (hit) {
      mapping[field] = hit.raw;
      used.add(hit.key);
    }
  }

  return mapping;
}

/** เดาขนส่งจากหัวตาราง + ชื่อไฟล์ */
export function guessCourier(headers: string[], filename = ''): Courier {
  const hay = fold([...headers, filename].join(' '));
  for (const { courier, words } of COURIER_HINTS) {
    if (words.some((w) => hay.includes(w))) return courier;
  }
  return 'custom';
}

/**
 * ตรวจว่าการจับคู่คอลัมน์พอใช้งานได้ไหม
 * 🔴 ต้องมี "เลขพัสดุ" เสมอ และต้องมีอย่างน้อยหนึ่งช่องที่ใช้จับคู่ออเดอร์ได้
 *    ไม่งั้นนำเข้าไปก็จับคู่ไม่ได้สักแถว เสียเวลาเปล่า
 */
export function mappingProblem(mapping: ColumnMapping): string | null {
  if (!mapping.tracking_no) {
    return 'หาคอลัมน์ "เลขพัสดุ" ไม่เจอ — เลือกคอลัมน์เองก่อนนำเข้า';
  }
  if (!mapping.order_ref && !mapping.phone) {
    return (
      'ต้องมีคอลัมน์ "เลขออเดอร์" หรือ "เบอร์ผู้รับ" อย่างน้อยหนึ่งอย่าง ' +
      'ไม่งั้นระบบจับคู่กับออเดอร์ไม่ได้เลย'
    );
  }
  return null;
}

/** ไฟล์ตัวอย่างให้เจ้าของร้านโหลดไปกรอก */
export const CSV_TEMPLATE_HEADERS = [
  'เลขออเดอร์', 'เลขพัสดุ', 'ขนส่ง', 'ชื่อผู้รับ', 'เบอร์ผู้รับ', 'รหัสไปรษณีย์',
];

export function csvTemplate(): string {
  const example = ['ORD-260823-001', 'TH1234567890', 'flash', 'คุณสมชาย ใจดี', '0812345678', '10230'];
  // ⭐ ใส่ BOM ให้ Excel เปิดแล้วภาษาไทยไม่เพี้ยน
  return `﻿${CSV_TEMPLATE_HEADERS.join(',')}\n${example.join(',')}\n`;
}
