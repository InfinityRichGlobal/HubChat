/**
 * จับคู่แถวในไฟล์ขนส่งกับออเดอร์ (รอบ 8 — สเปกหัวข้อ 5.8)
 * ===========================================================================
 * ⚠️ ฟังก์ชันบริสุทธิ์ล้วน ๆ — รับ "กองออเดอร์ที่เป็นไปได้" เข้ามา ไม่ค้นเอง
 *    ทำแบบนี้เพื่อให้ทดสอบทุกเส้นทางได้โดยไม่ต้องมีฐานข้อมูล
 *
 * 🔴 กฎที่สำคัญที่สุดของทั้งรอบ :
 *    จับคู่ผิด = ลูกค้าได้เลขพัสดุของคนอื่น = แก้ไม่ได้
 *    ดังนั้น "ไม่แน่ใจ" ต้องแปลว่า "ให้คนเลือก" เสมอ ห้ามเดาให้เด็ดขาด
 *
 * ลำดับการจับคู่ (ตามสเปก) :
 *    1. เลขออเดอร์ตรง                → อัตโนมัติ
 *    2. เบอร์ตรง เจอออเดอร์เดียว      → อัตโนมัติ
 *    3. เบอร์ + ไปรษณีย์ตรงทั้งคู่     → อัตโนมัติ
 *    4. เบอร์ตรง แต่เจอหลายออเดอร์    → ให้แอดมินเลือก
 *    5. ชื่อคล้าย + ไปรษณีย์ตรง       → เสนอเท่านั้น
 *    6. ไม่เจอ                       → ให้คนหาเอง
 */
import { nameSimilarity } from './normalize';
import type { ParsedRow } from './validate';

export type MatchStatus = 'auto' | 'ambiguous' | 'manual' | 'unmatched' | 'skipped';
export type MatchMethod = 'order_ref' | 'phone' | 'phone_postcode' | 'name_postcode' | 'manual';

export type CandidateOrder = {
  id: string;
  order_no: string;
  phone_normalized: string | null;
  postcode: string | null;
  name_normalized: string | null;
  status: string;
  tracking_no: string | null;
  /** ISO — ใช้ตัดสินลำดับให้คงที่ */
  created_at: string;
};

export type MatchOutcome = {
  status: MatchStatus;
  method: MatchMethod | null;
  order_id: string | null;
  candidate_order_ids: string[];
  note_th: string | null;
};

/** ออเดอร์ที่จบไปแล้ว ไม่ควรถูกใส่เลขพัสดุใหม่ */
const CLOSED_STATUSES = new Set(['cancelled', 'returned']);

/** ชื่อคล้ายแค่ไหนถึงจะ "เสนอ" ได้ — ตั้งไว้สูงโดยตั้งใจ เพราะเป็นวิธีที่เชื่อถือน้อยที่สุด */
const NAME_THRESHOLD = 0.8;

/**
 * เรียงผู้สมัครให้คงที่เสมอ : ใหม่ก่อน แล้วตัดสินด้วย id
 * ⚠️ จำเป็นมาก — ถ้าลำดับไม่คงที่ การนำเข้าไฟล์เดิมซ้ำอาจได้ผลคนละแบบ
 */
function stable(list: CandidateOrder[]): CandidateOrder[] {
  return [...list].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function outcomeFor(order: CandidateOrder, method: MatchMethod): MatchOutcome {
  if (CLOSED_STATUSES.has(order.status)) {
    return {
      status: 'skipped',
      method,
      order_id: order.id,
      candidate_order_ids: [order.id],
      note_th: `เจอออเดอร์ ${order.order_no} แต่ถูกยกเลิก/ตีกลับแล้ว จึงไม่ใส่เลขพัสดุให้`,
    };
  }
  return {
    status: 'auto',
    method,
    order_id: order.id,
    candidate_order_ids: [order.id],
    note_th: null,
  };
}

/**
 * จับคู่แถวหนึ่งแถว
 * @param pool ออเดอร์ที่ "อาจจะ" เกี่ยวข้อง (ดึงมาจากฐานข้อมูลด้วยเบอร์/เลขออเดอร์/ไปรษณีย์)
 */
export function matchRow(row: ParsedRow, pool: CandidateOrder[]): MatchOutcome {
  const orders = stable(pool);

  /* ---- 1) เลขออเดอร์ตรง — แม่นที่สุด ใช้ก่อนเสมอ ---- */
  if (row.order_ref) {
    const exact = orders.filter((o) => o.order_no.toUpperCase() === row.order_ref);
    if (exact.length === 1) return outcomeFor(exact[0], 'order_ref');
    if (exact.length > 1) {
      // เลขออเดอร์ซ้ำกันไม่ควรเกิด (มี unique index) แต่ถ้าเกิดต้องให้คนดู ไม่ใช่เดา
      return {
        status: 'ambiguous',
        method: 'order_ref',
        order_id: null,
        candidate_order_ids: exact.map((o) => o.id),
        note_th: 'เจอเลขออเดอร์นี้มากกว่าหนึ่งใบ — ต้องให้แอดมินเลือก',
      };
    }
  }

  /* ---- 2 & 3) เบอร์โทร ---- */
  if (row.phone_normalized) {
    const byPhone = orders.filter((o) => o.phone_normalized === row.phone_normalized);
    const openByPhone = byPhone.filter((o) => !CLOSED_STATUSES.has(o.status));

    if (byPhone.length === 1) return outcomeFor(byPhone[0], 'phone');

    if (byPhone.length > 1) {
      // เบอร์เดียวกันหลายออเดอร์ → ลองตัดด้วยรหัสไปรษณีย์ก่อน
      if (row.postcode) {
        const byBoth = byPhone.filter((o) => o.postcode === row.postcode);
        if (byBoth.length === 1) return outcomeFor(byBoth[0], 'phone_postcode');
      }

      // ยังเหลือหลายใบ → ถ้ามีใบที่ยังไม่จบเพียงใบเดียว ก็ชัดพอ
      if (openByPhone.length === 1) return outcomeFor(openByPhone[0], 'phone');

      return {
        status: 'ambiguous',
        method: 'phone',
        order_id: null,
        candidate_order_ids: (openByPhone.length > 0 ? openByPhone : byPhone).map((o) => o.id),
        note_th: `เบอร์นี้มี ${byPhone.length} ออเดอร์ — ต้องให้แอดมินเลือกว่าใบไหน`,
      };
    }
  }

  /* ---- 5) ชื่อคล้าย + ไปรษณีย์ตรง — เสนอเท่านั้น ห้ามอัตโนมัติ ---- */
  if (row.name_normalized && row.postcode) {
    const scored = orders
      .filter((o) => o.postcode === row.postcode && !CLOSED_STATUSES.has(o.status))
      .map((o) => ({ o, score: nameSimilarity(row.name_normalized, o.name_normalized) }))
      .filter((x) => x.score >= NAME_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      return {
        status: 'ambiguous',
        method: 'name_postcode',
        order_id: null,
        candidate_order_ids: scored.slice(0, 5).map((x) => x.o.id),
        note_th:
          'เดาจากชื่อ + รหัสไปรษณีย์ได้ แต่วิธีนี้เชื่อถือไม่ได้พอ — ' +
          'ต้องให้แอดมินยืนยันเองว่าใช่ใบไหน',
      };
    }
  }

  /* ---- 6) ไม่เจอ ---- */
  return {
    status: 'unmatched',
    method: null,
    order_id: null,
    candidate_order_ids: [],
    note_th: 'หาออเดอร์ที่ตรงไม่เจอ — ค้นหาเองในหน้าออเดอร์ หรือข้ามแถวนี้ไป',
  };
}

/** สรุปผลทั้งไฟล์ ใช้โชว์บนหน้า preview */
export type MatchSummary = {
  total: number;
  auto: number;
  ambiguous: number;
  manual: number;
  unmatched: number;
  skipped: number;
  errors: number;
  warnings: number;
  duplicates: number;
};

export function summarise(
  rows: Array<{ match_status: MatchStatus; problems: Array<{ level: string }>; duplicate_of: number | null }>,
): MatchSummary {
  const s: MatchSummary = {
    total: rows.length,
    auto: 0, ambiguous: 0, manual: 0, unmatched: 0, skipped: 0,
    errors: 0, warnings: 0, duplicates: 0,
  };
  for (const r of rows) {
    s[r.match_status] += 1;
    if (r.problems.some((p) => p.level === 'error')) s.errors += 1;
    else if (r.problems.some((p) => p.level === 'warning')) s.warnings += 1;
    if (r.duplicate_of !== null) s.duplicates += 1;
  }
  return s;
}
