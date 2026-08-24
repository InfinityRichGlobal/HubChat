/**
 * ดึงที่อยู่ / เบอร์ / ชื่อผู้รับ จากข้อความที่ลูกค้าพิมพ์มา (สเปกหัวข้อ 5.2)
 * ===========================================================================
 * ⭐ ใช้ regex ธรรมดา ไม่ใช้ AI — ตามสเปกชัดเจน
 *    เร็ว ฟรี ตรวจสอบได้ และไม่ส่งข้อมูลลูกค้าออกไปไหน
 *
 * ⚠️ ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ ห้ามต่อฐานข้อมูล ห้ามยิงเน็ต
 *
 * 🔴 กฎเหล็กของการใช้งาน (สเปกเขียนไว้ตัวหนา) :
 *    ผลลัพธ์จากที่นี่ต้อง "ให้แอดมินตรวจและแก้ก่อนบันทึกเสมอ"
 *    ห้ามเอาไปเขียนทับข้อมูลลูกค้าโดยอัตโนมัติเด็ดขาด
 *    เพราะที่อยู่ผิด = ของส่งไปผิดบ้าน = เสียเงินจริงและเสียลูกค้าจริง
 */

export type ExtractedAddress = {
  recipient_name: string | null;
  phone: string | null;
  postcode: string | null;
  address: string | null;
  /** ความมั่นใจคร่าว ๆ ไว้เตือนแอดมินว่าควรตรวจให้ดีแค่ไหน */
  confidence: 'high' | 'medium' | 'low';
};

export const EMPTY_EXTRACT: ExtractedAddress = {
  recipient_name: null,
  phone: null,
  postcode: null,
  address: null,
  confidence: 'low',
};

/* ------------------------------------------------------------------------ */
/* เบอร์โทร                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * เบอร์มือถือไทย : ขึ้นต้น 06 / 08 / 09 แล้วตามด้วยอีก 8 หลัก
 * ยอมรับขีดกับเว้นวรรคคั่นกลาง เช่น 081-234-5678 หรือ 081 234 5678
 *
 * ⚠️ ตั้งใจไม่รับเบอร์บ้าน (02-xxx-xxxx) เพราะสับสนกับเลขอื่นง่ายมาก
 *    ลูกค้าออนไลน์แทบทั้งหมดให้เบอร์มือถืออยู่แล้ว
 */
export function extractPhone(text: string): string | null {
  // ตัดตัวคั่นออกก่อน แล้วค่อยหาเลข 10 หลักที่ขึ้นต้นถูกแบบ
  const flat = text.replace(/[-\s().]/g, '');
  const match = flat.match(/0[689]\d{8}/);
  return match ? match[0] : null;
}

/* ------------------------------------------------------------------------ */
/* รหัสไปรษณีย์                                                               */
/* ------------------------------------------------------------------------ */

/**
 * เลข 5 หลักที่ "ไม่ได้เป็นส่วนหนึ่งของเบอร์โทร"
 * วิธีกัน : ลบเบอร์ที่หาเจอออกจากข้อความก่อน แล้วค่อยหาเลข 5 หลัก
 *
 * ⚠️ รหัสไปรษณีย์ไทยหลักแรกคือ 1-9 (ไม่มีขึ้นต้นด้วย 0)
 */
export function extractPostcode(text: string, knownPhone: string | null): string | null {
  let cleaned = text;

  if (knownPhone) {
    // ลบเบอร์ทุกรูปแบบที่เขียนได้ (มีขีด มีเว้นวรรค หรือไม่มี)
    const digits = knownPhone.split('');
    const loose = digits.join('[-\\s.]*');
    cleaned = cleaned.replace(new RegExp(loose, 'g'), ' ');
  }

  // หาเลข 5 หลักที่ยืนเดี่ยว ๆ ไม่ติดกับตัวเลขอื่น
  const match = cleaned.match(/(?<!\d)[1-9]\d{4}(?!\d)/);
  return match ? match[0] : null;
}

/* ------------------------------------------------------------------------ */
/* ที่อยู่                                                                     */
/* ------------------------------------------------------------------------ */

/** คำที่บอกว่าบรรทัดนี้น่าจะเป็นที่อยู่ (ตามสเปก 5.2) */
const ADDRESS_HINTS = [
  'ต.', 'อ.', 'จ.', 'ถ.', 'หมู่', 'ซอย', 'ซ.', 'ม.',
  'ตำบล', 'อำเภอ', 'จังหวัด', 'ถนน', 'แขวง', 'เขต', 'บ้านเลขที่',
];

function looksLikeAddress(line: string): boolean {
  return ADDRESS_HINTS.some((h) => line.includes(h));
}

/**
 * รวมบรรทัดที่ดูเป็นที่อยู่เข้าด้วยกัน
 * ⚠️ ตัดบรรทัดที่เป็นเบอร์โทรล้วน ๆ หรือรหัสไปรษณีย์ล้วน ๆ ออก
 *    เพราะมีช่องกรอกของตัวเองอยู่แล้ว ใส่ซ้ำจะสับสน
 */
export function extractAddressLines(
  lines: string[],
  knownPhone: string | null,
  knownPostcode: string | null,
): string | null {
  const picked = lines.filter((line) => {
    const t = line.trim();
    if (t.length === 0) return false;
    if (!looksLikeAddress(t)) return false;

    const onlyDigits = t.replace(/[-\s().]/g, '');
    if (knownPhone && onlyDigits === knownPhone) return false;
    if (knownPostcode && onlyDigits === knownPostcode) return false;
    return true;
  });

  if (picked.length === 0) return null;
  return picked.map((l) => l.trim()).join('\n');
}

/* ------------------------------------------------------------------------ */
/* ชื่อผู้รับ                                                                  */
/* ------------------------------------------------------------------------ */

/** คำนำหน้าที่คนไทยชอบพิมพ์มา — ตัดออกไม่ได้ แต่ใช้เป็นสัญญาณว่าเป็นชื่อ */
const NAME_HINTS = ['คุณ', 'นาย', 'นาง', 'นางสาว', 'น.ส.', 'ชื่อ', 'ผู้รับ'];

/**
 * บรรทัดแรกที่ไม่มีตัวเลข (ตามสเปก)
 * เพิ่มเงื่อนไขกันพลาด : ต้องไม่ใช่บรรทัดที่ดูเป็นที่อยู่ และต้องไม่ยาวเกินไป
 */
export function extractRecipientName(lines: string[]): string | null {
  for (const raw of lines) {
    const t = raw.trim();
    if (t.length === 0) continue;
    if (/\d/.test(t)) continue;
    if (looksLikeAddress(t)) continue;
    if (t.length > 60) continue; // ยาวขนาดนี้ไม่ใช่ชื่อคนแล้ว

    // ตัดคำว่า "ชื่อ" / "ผู้รับ" ที่นำหน้าออก แต่เก็บ "คุณ/นาย/นาง" ไว้
    const cleaned = t.replace(/^(ชื่อผู้รับ|ชื่อ|ผู้รับ)\s*[:：]?\s*/, '').trim();
    if (cleaned.length === 0) continue;
    return cleaned;
  }

  // ถ้าไม่เจอบรรทัดที่ไม่มีตัวเลขเลย ลองหาบรรทัดที่มีคำนำหน้าชื่อ
  for (const raw of lines) {
    const t = raw.trim();
    if (NAME_HINTS.some((h) => t.startsWith(h))) {
      const cleaned = t.replace(/[0-9]/g, '').trim();
      if (cleaned.length > 1) return cleaned;
    }
  }

  return null;
}

/* ------------------------------------------------------------------------ */
/* ตัวหลัก                                                                    */
/* ------------------------------------------------------------------------ */

export function extractAddress(text: string | null | undefined): ExtractedAddress {
  if (!text || text.trim().length === 0) return EMPTY_EXTRACT;

  const lines = text.split(/\r?\n/);

  const phone = extractPhone(text);
  const postcode = extractPostcode(text, phone);
  const address = extractAddressLines(lines, phone, postcode);
  const recipient_name = extractRecipientName(lines);

  // นับว่าได้ของสำคัญมากี่อย่าง — ใช้บอกแอดมินว่าควรตรวจหนักแค่ไหน
  const found = [phone, postcode, address, recipient_name].filter(Boolean).length;
  const confidence: ExtractedAddress['confidence'] =
    found >= 4 ? 'high' : found >= 2 ? 'medium' : 'low';

  return { recipient_name, phone, postcode, address, confidence };
}

/** มีอะไรให้กรอกไหม — ใช้ตัดสินว่าจะเปิดฟอร์มให้หรือบอกว่าไม่เจอ */
export function hasAnything(result: ExtractedAddress): boolean {
  return Boolean(result.recipient_name || result.phone || result.postcode || result.address);
}
