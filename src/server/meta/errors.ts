/**
 * แยกประเภท error ที่ Meta ตอบกลับมา (สเปก 6.1 กฎเหล็กข้อ 3)
 * ===========================================================================
 * "ห้าม retry มั่ว" — retry ได้เฉพาะ error ชั่วคราวเท่านั้น
 *
 *   ชั่วคราว (transient) : เซิร์ฟเวอร์ Meta ล่ม / ยิงถี่เกิน / เน็ตหลุด
 *       → ลองใหม่แบบ exponential backoff ได้
 *
 *   เชิงนโยบาย (policy)  : พ้นกรอบเวลา / ไม่มี permission / ถูกบล็อก
 *       → ห้าม retry เด็ดขาด ยิงซ้ำเท่ากับจงใจฝ่าฝืน เสี่ยงโดนระงับแอป
 *
 *   ถาวรอื่น ๆ (permanent): ข้อมูลผิดรูปแบบ / ผู้รับไม่มีอยู่จริง
 *       → ห้าม retry เช่นกัน แต่เป็นบั๊กของเรา ไม่ใช่เรื่องนโยบาย
 */

export type MetaErrorKind = 'transient' | 'policy' | 'permanent';

export type MetaErrorInfo = {
  kind: MetaErrorKind;
  code: number | null;
  subcode: number | null;
  message: string;
  fbtrace_id: string | null;
  /** ข้อความภาษาไทยให้แอดมินอ่านรู้เรื่อง */
  message_th: string;
  /** ถ้าจริง = ต้องอัปเดตสถานะในฐานข้อมูลให้ตรงความจริง (feedback loop) */
  window_actually_closed: boolean;
};

/**
 * รหัส error ที่ถือว่า "ชั่วคราว"
 *   1    ปัญหาไม่ทราบสาเหตุชั่วคราวของ API
 *   2    บริการขัดข้องชั่วคราว
 *   4    ยิงเกินโควตาของแอป
 *   17   ยิงเกินโควตาของผู้ใช้
 *   32   ยิงเกินโควตาของเพจ
 *   613  ยิงถี่เกินกำหนด
 */
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 613]);

/**
 * รหัส error เชิงนโยบาย — ห้าม retry
 *   10   ไม่มี permission ที่ต้องใช้
 *   200  ไม่มีสิทธิ์ทำรายการนี้
 *   551  ผู้ใช้ไม่พร้อมรับข้อความ (บล็อก/ปิดรับ)
 *   10900 ขึ้นไป เป็นกลุ่มข้อจำกัดด้านนโยบายการส่งข้อความ
 */
const POLICY_CODES = new Set([10, 200, 551]);

/**
 * subcode ที่บอกว่า "กรอบเวลาปิดไปแล้ว" ทั้งที่เราคำนวณว่ายังเปิด
 * เจอแล้วต้องแก้ข้อมูลในฐานข้อมูลให้ตรงความจริงทันที (feedback loop)
 *   2018278 พ้นกรอบเวลามาตรฐานแล้ว
 *   2018108 ผู้ใช้ไม่อนุญาตให้ส่งข้อความ
 */
const WINDOW_CLOSED_SUBCODES = new Set([2018278, 2018108]);

export type RawMetaError = {
  code?: number;
  error_subcode?: number;
  message?: string;
  type?: string;
  fbtrace_id?: string;
};

/** แปลง error ดิบจาก Meta ให้เป็นข้อมูลที่ระบบตัดสินใจต่อได้ */
export function classifyMetaError(raw: RawMetaError | null, httpStatus: number): MetaErrorInfo {
  const code = raw?.code ?? null;
  const subcode = raw?.error_subcode ?? null;
  const message = raw?.message ?? `HTTP ${httpStatus}`;
  const fbtrace = raw?.fbtrace_id ?? null;
  const windowClosed = subcode !== null && WINDOW_CLOSED_SUBCODES.has(subcode);

  // 5xx = ฝั่ง Meta ล่ม ถือว่าชั่วคราวเสมอ
  if (httpStatus >= 500) {
    return info('transient', code, subcode, message, fbtrace, windowClosed);
  }
  if (httpStatus === 429) {
    return info('transient', code, subcode, message, fbtrace, windowClosed);
  }
  if (code !== null && TRANSIENT_CODES.has(code)) {
    return info('transient', code, subcode, message, fbtrace, windowClosed);
  }
  if (windowClosed) {
    return info('policy', code, subcode, message, fbtrace, true);
  }
  if (code !== null && (POLICY_CODES.has(code) || code >= 10900)) {
    return info('policy', code, subcode, message, fbtrace, windowClosed);
  }
  return info('permanent', code, subcode, message, fbtrace, windowClosed);
}

function info(
  kind: MetaErrorKind,
  code: number | null,
  subcode: number | null,
  message: string,
  fbtrace_id: string | null,
  window_actually_closed: boolean,
): MetaErrorInfo {
  return { kind, code, subcode, message, fbtrace_id, message_th: describeTh(kind, window_actually_closed), window_actually_closed };
}

function describeTh(kind: MetaErrorKind, windowClosed: boolean): string {
  if (windowClosed) {
    return 'กรอบเวลาที่ Meta อนุญาตปิดไปแล้ว หรือลูกค้าปิดรับข้อความจากเพจนี้';
  }
  switch (kind) {
    case 'transient':
      return 'ระบบของ Meta ขัดข้องชั่วคราว ระบบจะลองส่งใหม่ให้อัตโนมัติ';
    case 'policy':
      return 'Meta ปฏิเสธการส่งด้วยเหตุผลด้านนโยบาย ระบบจะไม่ลองส่งซ้ำ';
    default:
      return 'ส่งไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบพร้อมเวลาที่เกิดเหตุ';
  }
}

/** retry ได้เฉพาะ transient เท่านั้น */
export function isRetryable(err: MetaErrorInfo): boolean {
  return err.kind === 'transient';
}

/** หน่วงเวลาก่อนลองใหม่แบบ exponential backoff (มิลลิวินาที) */
export function backoffMs(attempt: number, baseMs = 500): number {
  return baseMs * 2 ** Math.max(0, attempt - 1);
}
