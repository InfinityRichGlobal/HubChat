/**
 * ชุดทดสอบตัวจับคีย์เวิร์ด (รอบ 6)
 * ===========================================================================
 * ตัวนี้ตัดสินว่าระบบจะพิมพ์หาลูกค้าเองหรือไม่ จึงทดสอบละเอียดกว่าปกติ
 */
import { describe, it, expect } from 'vitest';
import {
  normalize, orderRules, isRuleLive, ruleAppliesToPage, findMatchingRule,
  type MatchableRule,
} from '../matcher';

const PAGE_A = '11111111-1111-1111-1111-111111111111';
const PAGE_B = '22222222-2222-2222-2222-222222222222';

function rule(over: Partial<MatchableRule> = {}): MatchableRule {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    page_ids: [],
    match_type: 'contains',
    keywords: ['ราคา'],
    reply_text: 'ราคา 290 บาทค่ะ',
    priority: 100,
    is_active: true,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...over,
  };
}

/* ================================================================== */
describe('normalize', () => {
  it('ตัดช่องว่างหัวท้าย และยุบช่องว่างซ้ำ', () => {
    expect(normalize('  ราคา   เท่าไหร่  ')).toBe('ราคา เท่าไหร่');
  });

  it('ขึ้นบรรทัดใหม่กับ tab นับเป็นช่องว่างเหมือนกัน', () => {
    expect(normalize('ราคา\n\tเท่าไหร่')).toBe('ราคา เท่าไหร่');
  });

  it('อังกฤษตัวใหญ่เล็กถือว่าเหมือนกัน', () => {
    expect(normalize('PRICE')).toBe('price');
  });

  it('⭐ สระอำ กับ นิคหิต+สระอา ต้องถือว่าเป็นคำเดียวกัน', () => {
    // สองสตริงนี้มองด้วยตาเหมือนกัน แต่ลำดับ code point ต่างกัน
    // ⚠️ NFC รวมให้ไม่ได้ ต้องใช้ NFKC — เทสต์นี้คือตัวที่จับได้ตอนเขียนผิด
    const composed = 'ก\u0E33';               // ก + สระอำ
    const decomposed = 'ก\u0E4D\u0E32';       // ก + นิคหิต + สระอา
    expect(composed).not.toBe(decomposed);    // ยืนยันว่าต่างกันจริงก่อน
    expect(normalize(composed)).toBe(normalize(decomposed));
  });

  it('⭐ ตัวอักษรเต็มความกว้างจากคีย์บอร์ดมือถือ ต้องเทียบกับตัวปกติได้', () => {
    expect(normalize('\uFF30\uFF32\uFF29\uFF23\uFF25')).toBe('price');
  });

  it('ค่าที่ไม่ใช่สตริงต้องไม่ทำให้ระเบิด', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

/* ================================================================== */
describe('การเทียบคำ', () => {
  it('contains — เจอคำอยู่กลางประโยคก็ตรง', () => {
    const m = findMatchingRule('สวัสดีค่ะ อยากทราบราคาหน่อย', PAGE_A, [rule()]);
    expect(m?.matched_keyword).toBe('ราคา');
  });

  it('exact — ต้องตรงทั้งข้อความเท่านั้น', () => {
    const r = rule({ match_type: 'exact', keywords: ['ราคา'] });
    expect(findMatchingRule('ราคา', PAGE_A, [r])).not.toBeNull();
    expect(findMatchingRule('ราคาเท่าไหร่', PAGE_A, [r])).toBeNull();
  });

  it('exact — ช่องว่างหัวท้ายไม่ควรทำให้พลาด', () => {
    const r = rule({ match_type: 'exact', keywords: ['ราคา'] });
    expect(findMatchingRule('  ราคา  ', PAGE_A, [r])).not.toBeNull();
  });

  it('starts_with — ต้องอยู่ต้นข้อความ', () => {
    const r = rule({ match_type: 'starts_with', keywords: ['สนใจ'] });
    expect(findMatchingRule('สนใจสินค้าค่ะ', PAGE_A, [r])).not.toBeNull();
    expect(findMatchingRule('ค่ะ สนใจสินค้า', PAGE_A, [r])).toBeNull();
  });

  it('⭐ ภาษาไทยที่ไม่มีช่องว่างระหว่างคำ ต้องจับได้', () => {
    const r = rule({ keywords: ['เก็บเงินปลายทาง'] });
    const m = findMatchingRule('มีเก็บเงินปลายทางไหมคะ', PAGE_A, [r]);
    expect(m?.matched_keyword).toBe('เก็บเงินปลายทาง');
  });

  it('⭐ คีย์เวิร์ดว่างต้องไม่ตรงกับอะไรเลย (ไม่งั้นจะตอบทุกข้อความ)', () => {
    const r = rule({ keywords: ['', '   '] });
    expect(findMatchingRule('สวัสดีค่ะ', PAGE_A, [r])).toBeNull();
  });

  it('ข้อความว่าง (ลูกค้าส่งแต่รูป/สติกเกอร์) ต้องไม่ตอบอัตโนมัติ', () => {
    expect(findMatchingRule('', PAGE_A, [rule()])).toBeNull();
    expect(findMatchingRule(null, PAGE_A, [rule()])).toBeNull();
    expect(findMatchingRule('    ', PAGE_A, [rule()])).toBeNull();
  });

  it('กฎที่ keywords ไม่ใช่อาเรย์ ต้องไม่ทำให้ระเบิด', () => {
    const broken = { ...rule(), keywords: null as unknown as string[] };
    expect(findMatchingRule('ราคา', PAGE_A, [broken])).toBeNull();
  });
});

/* ================================================================== */
describe('สถานะของกฎ', () => {
  it('กฎที่ปิดอยู่ ต้องไม่ถูกใช้', () => {
    expect(findMatchingRule('ราคา', PAGE_A, [rule({ is_active: false })])).toBeNull();
  });

  it('⭐ กฎที่เก็บเข้ากรุแล้ว ต้องไม่ถูกใช้ แม้ is_active ยังเป็น true', () => {
    const archived = rule({ is_active: true, archived_at: '2026-02-01T00:00:00.000Z' });
    expect(isRuleLive(archived)).toBe(false);
    expect(findMatchingRule('ราคา', PAGE_A, [archived])).toBeNull();
  });

  it('กฎที่ไม่มีข้อความตอบ ต้องไม่ถูกใช้ (ส่งข้อความว่างไม่ได้)', () => {
    expect(findMatchingRule('ราคา', PAGE_A, [rule({ reply_text: null })])).toBeNull();
    expect(findMatchingRule('ราคา', PAGE_A, [rule({ reply_text: '   ' })])).toBeNull();
  });
});

/* ================================================================== */
describe('ขอบเขตเพจ', () => {
  it('page_ids ว่าง = ใช้ได้ทุกเพจ', () => {
    expect(ruleAppliesToPage(rule({ page_ids: [] }), PAGE_A)).toBe(true);
    expect(ruleAppliesToPage(rule({ page_ids: [] }), PAGE_B)).toBe(true);
  });

  it('⭐ กฎที่ผูกเพจ A ต้องไม่ทำงานกับเพจ B', () => {
    const r = rule({ page_ids: [PAGE_A] });
    expect(findMatchingRule('ราคา', PAGE_A, [r])).not.toBeNull();
    expect(findMatchingRule('ราคา', PAGE_B, [r])).toBeNull();
  });
});

/* ================================================================== */
describe('ลำดับความสำคัญ', () => {
  const low = rule({ id: 'bbbbbbbb-0000-0000-0000-000000000002', priority: 10, reply_text: 'ด่วน' });
  const high = rule({ id: 'cccccccc-0000-0000-0000-000000000003', priority: 200, reply_text: 'ทั่วไป' });

  it('⭐ ตรงสองกฎ → เลขน้อยกว่าชนะ', () => {
    expect(findMatchingRule('ราคา', PAGE_A, [high, low])?.rule.id).toBe(low.id);
    // สลับลำดับที่ส่งเข้าไป ผลต้องเหมือนเดิม
    expect(findMatchingRule('ราคา', PAGE_A, [low, high])?.rule.id).toBe(low.id);
  });

  it('⭐ priority เท่ากัน → กฎที่สร้างก่อนชนะ', () => {
    const older = rule({ id: 'dddddddd-0000-0000-0000-000000000004', created_at: '2026-01-01T00:00:00.000Z' });
    const newer = rule({ id: 'aaaaaaaa-0000-0000-0000-000000000005', created_at: '2026-06-01T00:00:00.000Z' });
    // newer มี id เรียงมาก่อน — ถ้าตัดสินด้วย id จะได้ผิด ต้องได้ older
    expect(findMatchingRule('ราคา', PAGE_A, [newer, older])?.rule.id).toBe(older.id);
  });

  it('⭐ ทุกอย่างเท่ากันหมด → ตัดสินด้วย id เพื่อให้ผลคงที่', () => {
    const a = rule({ id: 'aaaaaaaa-9999-0000-0000-000000000001' });
    const b = rule({ id: 'ffffffff-9999-0000-0000-000000000002' });
    expect(findMatchingRule('ราคา', PAGE_A, [b, a])?.rule.id).toBe(a.id);
  });

  it('⭐ เรียกซ้ำ 50 ครั้งด้วยลำดับสุ่ม ต้องได้กฎเดิมทุกครั้ง', () => {
    const pool = [
      rule({ id: 'aaaaaaaa-1111-0000-0000-000000000001', priority: 50 }),
      rule({ id: 'bbbbbbbb-1111-0000-0000-000000000002', priority: 50 }),
      rule({ id: 'cccccccc-1111-0000-0000-000000000003', priority: 50 }),
      rule({ id: 'dddddddd-1111-0000-0000-000000000004', priority: 10 }),
    ];
    const expected = findMatchingRule('ราคา', PAGE_A, pool)?.rule.id;
    expect(expected).toBe('dddddddd-1111-0000-0000-000000000004');

    for (let i = 0; i < 50; i += 1) {
      // สลับลำดับแบบวนรอบ — ไม่ใช้ Math.random เพื่อให้เทสต์ทำซ้ำได้
      const shuffled = pool.slice(i % pool.length).concat(pool.slice(0, i % pool.length));
      expect(findMatchingRule('ราคา', PAGE_A, shuffled)?.rule.id).toBe(expected);
    }
  });

  it('orderRules ไม่แก้อาเรย์ต้นฉบับ', () => {
    const pool = [high, low];
    orderRules(pool);
    expect(pool[0].id).toBe(high.id);
  });

  it('⭐ ตรงหลายคำในกฎเดียว → คำที่รายงานต้องคงที่เสมอ', () => {
    const r = rule({ keywords: ['ส่ง', 'ราคา', 'โปร'] });
    const text = 'ราคาเท่าไหร่ ส่งยังไง มีโปรไหม';
    const first = findMatchingRule(text, PAGE_A, [r])?.matched_keyword;
    for (let i = 0; i < 10; i += 1) {
      expect(findMatchingRule(text, PAGE_A, [r])?.matched_keyword).toBe(first);
    }
  });
});

/* ================================================================== */
describe('ความทนทานต่อข้อมูลพัง', () => {
  it('รายการกฎว่าง → ไม่ตรง ไม่ระเบิด', () => {
    expect(findMatchingRule('ราคา', PAGE_A, [])).toBeNull();
  });

  it('ข้อความยาวมาก ต้องไม่ทำให้ช้าผิดปกติ', () => {
    // 🔴 เทสต์นี้มีไว้กันการเผลอใส่ regex ที่ระเบิดแบบ ReDoS ในอนาคต
    const huge = 'ก'.repeat(100_000) + 'ราคา';
    const started = Date.now();
    expect(findMatchingRule(huge, PAGE_A, [rule()])).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('match_type ที่โค้ดยังไม่รู้จัก → ถือว่าไม่ตรง (ปลอดภัยกว่าเดา)', () => {
    const weird = { ...rule(), match_type: 'regex' as never };
    expect(findMatchingRule('ราคา', PAGE_A, [weird])).toBeNull();
  });
});
