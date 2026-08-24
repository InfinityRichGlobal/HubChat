/**
 * ตรวจลายเซ็นของ webhook (เช็คลิสต์ความปลอดภัยข้อ 2)
 * ===========================================================================
 * ทำไมสำคัญมาก :
 *   URL ของ webhook เป็นที่อยู่สาธารณะ ใครก็ยิงเข้ามาได้
 *   ถ้าไม่ตรวจลายเซ็น ใครก็ปลอมเป็นลูกค้าทักเข้ามาได้
 *   → สร้างแชทปลอม สร้างออเดอร์ปลอม หรือหลอกให้ระบบตอบกลับ
 *
 * Meta เซ็นด้วย HMAC-SHA256 ของ "เนื้อคำขอดิบ" ด้วย App Secret
 * แล้วใส่มาในหัวข้อ X-Hub-Signature-256 เป็น `sha256=<ค่าฐานสิบหก>`
 *
 * ⚠️ ต้องตรวจกับ "เนื้อดิบ" (ตัวอักษรตามที่ส่งมาเป๊ะ ๆ) เท่านั้น
 *    ห้าม JSON.parse แล้ว stringify ใหม่ เพราะช่องว่างและลำดับคีย์จะเปลี่ยน
 *    แล้วลายเซ็นจะไม่มีวันตรง
 */
import crypto from 'node:crypto';

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: 'missing_header' | 'bad_format' | 'mismatch' | 'no_app_secret'; message_th: string };

const MESSAGES: Record<Exclude<SignatureResult, { ok: true }>['reason'], string> = {
  missing_header: 'คำขอนี้ไม่มีลายเซ็น X-Hub-Signature-256',
  bad_format: 'รูปแบบลายเซ็นไม่ถูกต้อง (ต้องขึ้นต้นด้วย sha256=)',
  mismatch: 'ลายเซ็นไม่ตรง — คำขอนี้ไม่ได้มาจาก Meta หรือเนื้อหาถูกแก้กลางทาง',
  no_app_secret: 'ยังไม่ได้ตั้งค่า META_APP_SECRET บนเซิร์ฟเวอร์ จึงตรวจลายเซ็นไม่ได้',
};

function deny(reason: Exclude<SignatureResult, { ok: true }>['reason']): SignatureResult {
  return { ok: false, reason, message_th: MESSAGES[reason] };
}

/**
 * @param rawBody   เนื้อคำขอดิบ ต้องเป็นตัวอักษรชุดเดียวกับที่ Meta ส่งมาเป๊ะ ๆ
 * @param header    ค่าจากหัวข้อ X-Hub-Signature-256
 * @param appSecret META_APP_SECRET
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string | undefined,
): SignatureResult {
  if (!appSecret) return deny('no_app_secret');
  if (!header) return deny('missing_header');
  if (!header.startsWith('sha256=')) return deny('bad_format');

  const provided = header.slice('sha256='.length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return deny('bad_format');

  const expected = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  // ⚠️ ต้องเทียบแบบ "เวลาคงที่" ไม่ใช่ === ธรรมดา
  //    การเทียบธรรมดาจะหยุดทันทีที่เจอตัวอักษรต่างกัน
  //    คนที่คอยจับเวลาสามารถเดาลายเซ็นทีละตัวอักษรได้จากความต่างของเวลา
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return deny('mismatch');
  if (!crypto.timingSafeEqual(a, b)) return deny('mismatch');

  return { ok: true };
}

/**
 * ตรวจ token ตอน Meta มาขอ "ยืนยันความเป็นเจ้าของ URL" (คำขอแบบ GET ครั้งแรก)
 * เทียบแบบเวลาคงที่เหมือนกัน
 */
export function verifyHubToken(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
