/**
 * ทำข้อมูลจากไฟล์ขนส่งให้อยู่ในรูปเดียวกันก่อนเทียบ (รอบ 8)
 * ===========================================================================
 * ⚠️ ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ล้วน ๆ ห้ามต่อฐานข้อมูล ห้ามอ่านเวลาปัจจุบัน
 *
 * 🔴 กฎเหล็กของไฟล์นี้ :
 *    normalizePhone() ต้องให้ผลเหมือน normalize_phone_th() ใน migration 0011 เป๊ะ ๆ
 *    ถ้าสองที่คิดไม่ตรงกัน จะเกิดอาการที่หาสาเหตุยากที่สุด :
 *    "preview บอกจับคู่ได้ แต่พอกดลงจริงกลับไม่เจอออเดอร์"
 *    มีชุดทดสอบที่ยิงค่าชุดเดียวกันเข้าทั้งสองฝั่งแล้วเทียบกันไว้แล้ว
 */

/**
 * เบอร์โทรไทย → รูปมาตรฐาน 0XXXXXXXXX
 *
 * รองรับ : 0812345678 / 081-234-5678 / 081 234 5678 / 66812345678 / +66812345678
 * และเคสที่ Excel กินเลข 0 หน้าทิ้ง → 812345678 (9 หลักขึ้นต้น 6/8/9 เติม 0 คืน)
 *
 * คืน null เมื่อไม่ใช่เบอร์ที่ใช้ได้ — ห้ามเดา เพราะเบอร์ผิด = เลขพัสดุไปผิดคน
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;

  let v = input.replace(/[^0-9]/g, '');
  if (v === '') return null;

  if (v.length === 11 && v.startsWith('66')) {
    v = `0${v.slice(2)}`;
  } else if (v.length === 12 && v.startsWith('660')) {
    // เคส +66 แล้วพิมพ์ 0 ต่อท้ายเกินมา
    v = v.slice(2);
  }

  if (v.length === 9 && ['6', '8', '9'].includes(v[0])) {
    v = `0${v}`;
  }

  if (v.length < 9 || v.length > 10) return null;
  return v;
}

/**
 * เลขพัสดุ → ตัวพิมพ์ใหญ่ ไม่มีช่องว่าง
 * ⚠️ ไม่ตัดอักขระอื่นทิ้ง เพราะขนส่งบางเจ้าใช้ขีดในเลขจริง
 */
export function normalizeTracking(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const v = input.replace(/\s+/g, '').toUpperCase();
  return v.length === 0 ? null : v;
}

/** รหัสไปรษณีย์ไทย = ตัวเลข 5 หลักเท่านั้น */
export function normalizePostcode(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const v = input.replace(/[^0-9]/g, '');
  return v.length === 5 ? v : null;
}

/**
 * ชื่อผู้รับ → ตัดคำนำหน้าและช่องว่างซ้ำ
 * ใช้เทียบแบบ "คล้ายกัน" เท่านั้น — ห้ามเอาไปจับคู่อัตโนมัติเดี่ยว ๆ
 */
export function normalizeName(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const v = input
    .normalize('NFKC')
    .replace(/^(คุณ|นาย|นาง|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return v.length === 0 ? null : v;
}

/** เลขออเดอร์ของเรา เช่น ORD-260823-001 — ตัวพิมพ์ใหญ่ ไม่มีช่องว่าง */
export function normalizeOrderRef(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const v = input.replace(/\s+/g, '').toUpperCase();
  if (v.length === 0) return null;
  // ขนส่งบางเจ้าเติมข้อความอื่นในช่องอ้างอิง — ดึงเฉพาะรูปแบบเลขออเดอร์ของเราออกมา
  const m = v.match(/ORD-\d{6}-\d{3,}/);
  return m ? m[0] : v;
}

/**
 * ความคล้ายของชื่อแบบง่าย (0..1) — ใช้ "เสนอ" เท่านั้น ไม่ใช้ตัดสินเอง
 *
 * ⚠️ ตั้งใจไม่ใช้ระยะแก้ไข (Levenshtein) :
 *    ภาษาไทยไม่มีช่องว่างระหว่างคำ ระยะแก้ไขจึงให้คะแนนหลอกบ่อย
 *    การนับตัวอักษรที่ใช้ร่วมกันเรียบง่ายกว่าและอธิบายให้เจ้าของร้านเข้าใจได้
 */
export function nameSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const setA = new Set(a.replace(/\s/g, ''));
  const setB = new Set(b.replace(/\s/g, ''));
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const ch of setA) if (setB.has(ch)) shared += 1;

  // Jaccard — ตัวอักษรที่ใช้ร่วมกัน หารด้วยตัวอักษรทั้งหมดที่ปรากฏ
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}
