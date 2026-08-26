/**
 * ชุดทดสอบการจับคู่แถวในไฟล์ขนส่งกับออเดอร์ (รอบ 8)
 * ===========================================================================
 * 🔴 กฎที่ชุดนี้คุ้มครอง :
 *    จับคู่ผิด = ลูกค้าได้เลขพัสดุของคนอื่น = แก้ไม่ได้
 *    ดังนั้น "ไม่แน่ใจ" ต้องแปลว่า "ให้คนเลือก" เสมอ ห้ามเดาให้เด็ดขาด
 */
import { describe, it, expect } from 'vitest';
import { matchRow, summarise, type CandidateOrder } from '../match';
import { validateRows } from '../validate';
import { parseCsv } from '../csv';
import type { ParsedRow } from '../validate';

function order(over: Partial<CandidateOrder> = {}): CandidateOrder {
  return {
    id: over.id ?? 'o1',
    order_no: over.order_no ?? 'ORD-260823-001',
    phone_normalized: over.phone_normalized ?? '0812345678',
    postcode: over.postcode ?? '10230',
    name_normalized: over.name_normalized ?? 'สมชาย ใจดี',
    status: over.status ?? 'confirmed',
    tracking_no: over.tracking_no ?? null,
    created_at: over.created_at ?? '2026-08-01T00:00:00Z',
  };
}

function row(over: Partial<ParsedRow> = {}): ParsedRow {
  return {
    row_index: over.row_index ?? 1,
    raw: {},
    tracking_no: over.tracking_no ?? 'TH1234567890',
    order_ref: over.order_ref ?? null,
    phone_raw: over.phone_raw ?? null,
    phone_normalized: over.phone_normalized ?? null,
    postcode: over.postcode ?? null,
    recipient_name: over.recipient_name ?? null,
    name_normalized: over.name_normalized ?? null,
    carrier_raw: over.carrier_raw ?? null,
    problems: over.problems ?? [],
    row_hash: over.row_hash ?? 'h',
    duplicate_of: over.duplicate_of ?? null,
  };
}

describe('ลำดับที่ 1 — เลขออเดอร์', () => {
  it('เลขออเดอร์ตรง = จับคู่อัตโนมัติ', () => {
    const out = matchRow(row({ order_ref: 'ORD-260823-001' }), [order()]);
    expect(out.status).toBe('auto');
    expect(out.method).toBe('order_ref');
    expect(out.order_id).toBe('o1');
  });

  it('⭐ เลขออเดอร์ชนะเบอร์เสมอ แม้เบอร์จะชี้ไปคนละใบ', () => {
    const pool = [
      order({ id: 'byref', order_no: 'ORD-260823-001', phone_normalized: '0999999999' }),
      order({ id: 'byphone', order_no: 'ORD-260823-999', phone_normalized: '0812345678' }),
    ];
    const out = matchRow(row({ order_ref: 'ORD-260823-001', phone_normalized: '0812345678' }), pool);
    expect(out.order_id).toBe('byref');
  });
});

describe('ลำดับที่ 2-4 — เบอร์โทร', () => {
  it('เบอร์ตรง เจอใบเดียว = อัตโนมัติ', () => {
    const out = matchRow(row({ phone_normalized: '0812345678' }), [order()]);
    expect(out.status).toBe('auto');
    expect(out.method).toBe('phone');
  });

  it('⭐ เบอร์ตรงหลายใบ + ไปรษณีย์ช่วยตัดได้ = อัตโนมัติ', () => {
    const pool = [
      order({ id: 'a', postcode: '10230' }),
      order({ id: 'b', postcode: '50000' }),
    ];
    const out = matchRow(row({ phone_normalized: '0812345678', postcode: '50000' }), pool);
    expect(out.status).toBe('auto');
    expect(out.method).toBe('phone_postcode');
    expect(out.order_id).toBe('b');
  });

  it('🔴 เบอร์ตรงหลายใบ ตัดไม่ได้ = ต้องให้แอดมินเลือก ห้ามเดา', () => {
    const pool = [
      order({ id: 'a', postcode: '10230' }),
      order({ id: 'b', postcode: '10230' }),
    ];
    const out = matchRow(row({ phone_normalized: '0812345678', postcode: '10230' }), pool);
    expect(out.status).toBe('ambiguous');
    expect(out.order_id).toBeNull();
    expect(out.candidate_order_ids.sort()).toEqual(['a', 'b']);
  });

  it('เบอร์ตรงหลายใบ แต่เหลือใบที่ยังไม่จบใบเดียว = ชัดพอ', () => {
    const pool = [
      order({ id: 'old', status: 'completed' }),
      order({ id: 'live', status: 'confirmed' }),
    ];
    const out = matchRow(row({ phone_normalized: '0812345678' }), pool);
    // ทั้งสองใบยังไม่ถือว่า "ปิด" (completed ไม่ใช่ cancelled) จึงต้องให้คนเลือก
    expect(out.status).toBe('ambiguous');
  });

  it('เบอร์ตรงหลายใบ แต่ที่เหลือถูกยกเลิกไปหมด = เลือกใบที่ยังใช้ได้', () => {
    const pool = [
      order({ id: 'dead', status: 'cancelled' }),
      order({ id: 'live', status: 'confirmed' }),
    ];
    const out = matchRow(row({ phone_normalized: '0812345678' }), pool);
    expect(out.status).toBe('auto');
    expect(out.order_id).toBe('live');
  });
});

describe('ออเดอร์ที่ถูกยกเลิก', () => {
  it('🔴 จับคู่เจอแต่ถูกยกเลิก = ข้าม พร้อมบอกเหตุผล ไม่ใช่ใส่เลขให้เงียบ ๆ', () => {
    const out = matchRow(row({ order_ref: 'ORD-260823-001' }), [order({ status: 'cancelled' })]);
    expect(out.status).toBe('skipped');
    expect(out.note_th).toContain('ยกเลิก');
  });

  it('ตีกลับก็เหมือนกัน', () => {
    const out = matchRow(row({ order_ref: 'ORD-260823-001' }), [order({ status: 'returned' })]);
    expect(out.status).toBe('skipped');
  });
});

describe('ลำดับที่ 5 — ชื่อ + ไปรษณีย์', () => {
  it('🔴 ชื่อคล้าย + ไปรษณีย์ตรง = เสนอเท่านั้น ห้ามอัตโนมัติเด็ดขาด', () => {
    const out = matchRow(
      row({ name_normalized: 'สมชาย ใจดี', postcode: '10230' }),
      [order({ id: 'guess' })],
    );
    expect(out.status).toBe('ambiguous');
    expect(out.order_id).toBeNull();
    expect(out.candidate_order_ids).toEqual(['guess']);
  });

  it('ชื่อคนละคน = ไม่เสนอ', () => {
    const out = matchRow(
      row({ name_normalized: 'วิภาวรรณ พงศ์ไพบูลย์', postcode: '10230' }),
      [order({ name_normalized: 'สมชาย ใจดี' })],
    );
    expect(out.status).toBe('unmatched');
  });
});

describe('ลำดับที่ 6 — ไม่เจอ', () => {
  it('ไม่มีอะไรตรงเลย', () => {
    const out = matchRow(row({ phone_normalized: '0999999999' }), [order()]);
    expect(out.status).toBe('unmatched');
    expect(out.note_th).toContain('ไม่เจอ');
  });

  it('กองว่างเปล่าก็ต้องไม่ระเบิด', () => {
    expect(matchRow(row({ phone_normalized: '0812345678' }), []).status).toBe('unmatched');
  });
});

describe('ผลลัพธ์ต้องเหมือนเดิมทุกครั้ง (deterministic)', () => {
  it('⭐ สลับลำดับกองผู้สมัคร ต้องได้คำตอบเดิมเป๊ะ', () => {
    const pool = [
      order({ id: 'a', created_at: '2026-08-01T00:00:00Z' }),
      order({ id: 'b', created_at: '2026-08-05T00:00:00Z' }),
      order({ id: 'c', created_at: '2026-08-03T00:00:00Z' }),
    ];
    const r = row({ phone_normalized: '0812345678', postcode: '10230' });
    const first = matchRow(r, pool);
    const second = matchRow(r, [...pool].reverse());
    expect(second.status).toBe(first.status);
    expect(second.candidate_order_ids.sort()).toEqual(first.candidate_order_ids.sort());
  });
});

describe('สรุปทั้งไฟล์', () => {
  it('นับแยกหมวดถูกต้อง', () => {
    const csv = [
      'เลขออเดอร์,เลขพัสดุ,เบอร์ผู้รับ',
      'ORD-260823-001,TH1234567890,0812345678',
      ',,',
      'ORD-260823-001,TH1234567890,0812345678',
    ].join('\n');
    const table = parseCsv(csv);
    const rows = validateRows(table, {
      order_ref: 'เลขออเดอร์',
      tracking_no: 'เลขพัสดุ',
      phone: 'เบอร์ผู้รับ',
    });
    const s = summarise(
      rows.map((r) => ({
        match_status: 'unmatched' as const,
        problems: r.problems,
        duplicate_of: r.duplicate_of,
      })),
    );
    expect(s.total).toBe(3);
    expect(s.errors).toBeGreaterThan(0);
    expect(s.duplicates).toBe(1);
  });
});
