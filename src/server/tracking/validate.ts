/**
 * ตรวจแต่ละแถวของไฟล์ขนส่ง (รอบ 8)
 * ===========================================================================
 * ⚠️ ฟังก์ชันบริสุทธิ์ล้วน ๆ
 *
 * 🔴 หลักการ : "ไฟล์พังต้องไม่ทำให้ระบบล้ม"
 *    แถวที่มีปัญหาต้องกลายเป็น "รายงานที่อ่านรู้เรื่อง" ไม่ใช่ exception
 *    แถวที่ดีในไฟล์เดียวกันต้องเดินต่อได้ตามปกติ (partial failure)
 */
import { normalizeName, normalizeOrderRef, normalizePhone, normalizePostcode, normalizeTracking } from './normalize';
import { rowToObject, type CsvTable } from './csv';
import type { ColumnMapping } from './columns';

export type RowProblem = {
  level: 'error' | 'warning';
  code: string;
  message_th: string;
};

export type ParsedRow = {
  /** ลำดับแถวในไฟล์ เริ่มที่ 1 (ไม่นับหัวตาราง) — ใช้เป็นกุญแจกันซ้ำระดับฐานข้อมูล */
  row_index: number;
  raw: Record<string, string>;
  tracking_no: string | null;
  order_ref: string | null;
  phone_raw: string | null;
  phone_normalized: string | null;
  postcode: string | null;
  recipient_name: string | null;
  /** ชื่อที่ normalize แล้ว — ใช้เทียบเท่านั้น ไม่เอาไปแสดง */
  name_normalized: string | null;
  carrier_raw: string | null;
  problems: RowProblem[];
  /** ลายนิ้วมือของ "เนื้อหาแถว" — ใช้จับแถวซ้ำภายในไฟล์เดียวกัน */
  row_hash: string;
  /** ถ้าแถวนี้ซ้ำกับแถวก่อนหน้า จะชี้ไปที่ row_index ของตัวแรก */
  duplicate_of: number | null;
};

/** เลขพัสดุที่สั้นหรือยาวผิดปกติ = พิมพ์ผิดแน่ ๆ ไม่ควรปล่อยผ่าน */
const TRACKING_MIN = 6;
const TRACKING_MAX = 40;

function fingerprint(parts: Array<string | null>): string {
  return parts.map((p) => p ?? '').join('|');
}

/**
 * แกะ + ตรวจทุกแถวของไฟล์
 *
 * ⚠️ แถวซ้ำในไฟล์เดียวกันต้องได้ผลเหมือนเดิมทุกครั้งที่รัน (deterministic) :
 *    ตัวแรกที่เจอชนะเสมอ ตัวหลังกลายเป็น "ซ้ำ" — ไม่ใช่สุ่มว่าใครชนะ
 */
export function validateRows(table: CsvTable, mapping: ColumnMapping): ParsedRow[] {
  const out: ParsedRow[] = [];
  const seen = new Map<string, number>();

  const pick = (obj: Record<string, string>, field: keyof ColumnMapping): string | null => {
    const col = mapping[field];
    if (!col) return null;
    const v = obj[col];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };

  for (let i = 0; i < table.rows.length; i += 1) {
    const raw = rowToObject(table.headers, table.rows[i]);
    const problems: RowProblem[] = [];

    const trackingRaw = pick(raw, 'tracking_no');
    const tracking_no = normalizeTracking(trackingRaw);
    const order_ref = normalizeOrderRef(pick(raw, 'order_ref'));
    const phone_raw = pick(raw, 'phone');
    const phone_normalized = normalizePhone(phone_raw);
    const postcode = normalizePostcode(pick(raw, 'postcode'));
    const recipient_name = pick(raw, 'recipient_name');
    const carrier_raw = pick(raw, 'carrier');

    /* ---- ตรวจเลขพัสดุ : ผิดที่นี่คือผิดหนัก จึงเป็น error ---- */
    if (!tracking_no) {
      problems.push({
        level: 'error',
        code: 'tracking_missing',
        message_th: 'แถวนี้ไม่มีเลขพัสดุ',
      });
    } else if (tracking_no.length < TRACKING_MIN || tracking_no.length > TRACKING_MAX) {
      problems.push({
        level: 'error',
        code: 'tracking_length',
        message_th: `เลขพัสดุ "${tracking_no}" ยาว ${tracking_no.length} ตัว ซึ่งผิดปกติ (ต้อง ${TRACKING_MIN}-${TRACKING_MAX} ตัว)`,
      });
    } else if (!/^[A-Z0-9][A-Z0-9-]*$/.test(tracking_no)) {
      problems.push({
        level: 'error',
        code: 'tracking_charset',
        message_th: `เลขพัสดุ "${tracking_no}" มีอักขระที่ไม่ใช่ตัวเลข/ตัวอักษร`,
      });
    }

    /* ---- ต้องมีอะไรสักอย่างให้จับคู่ ---- */
    if (!order_ref && !phone_normalized) {
      if (phone_raw) {
        problems.push({
          level: 'error',
          code: 'phone_invalid',
          message_th: `เบอร์ "${phone_raw}" ไม่ใช่เบอร์ที่ใช้ได้ และแถวนี้ไม่มีเลขออเดอร์ด้วย`,
        });
      } else {
        problems.push({
          level: 'error',
          code: 'no_key',
          message_th: 'แถวนี้ไม่มีทั้งเลขออเดอร์และเบอร์ผู้รับ จับคู่ไม่ได้',
        });
      }
    } else if (phone_raw && !phone_normalized) {
      // มีเลขออเดอร์อยู่แล้ว เบอร์เสียจึงแค่เตือน
      problems.push({
        level: 'warning',
        code: 'phone_invalid',
        message_th: `เบอร์ "${phone_raw}" อ่านไม่ออก แต่ยังจับคู่ด้วยเลขออเดอร์ได้`,
      });
    }

    if (!postcode && pick(raw, 'postcode')) {
      problems.push({
        level: 'warning',
        code: 'postcode_invalid',
        message_th: 'รหัสไปรษณีย์ไม่ใช่ตัวเลข 5 หลัก — จะไม่ถูกใช้ช่วยจับคู่',
      });
    }

    /* ---- แถวซ้ำภายในไฟล์เดียวกัน ---- */
    const row_hash = fingerprint([tracking_no, order_ref, phone_normalized]);
    let duplicate_of: number | null = null;
    const first = seen.get(row_hash);
    if (first !== undefined && row_hash !== '||') {
      duplicate_of = first;
      problems.push({
        level: 'warning',
        code: 'duplicate_row',
        message_th: `ซ้ำกับแถวที่ ${first} ในไฟล์เดียวกัน — จะข้ามแถวนี้`,
      });
    } else {
      seen.set(row_hash, i + 1);
    }

    out.push({
      row_index: i + 1,
      raw,
      tracking_no,
      order_ref,
      phone_raw,
      phone_normalized,
      postcode,
      recipient_name,
      name_normalized: normalizeName(recipient_name),
      carrier_raw,
      problems,
      row_hash,
      duplicate_of,
    });
  }

  return out;
}

export function hasError(row: ParsedRow): boolean {
  return row.problems.some((p) => p.level === 'error');
}
