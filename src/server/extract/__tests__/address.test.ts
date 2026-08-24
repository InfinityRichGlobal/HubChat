/**
 * ชุดทดสอบตัวดึงที่อยู่ (สเปกหัวข้อ 5.2)
 * ===========================================================================
 * ใช้ข้อความแบบที่ลูกค้าไทยพิมพ์มาจริง ๆ ซึ่งไม่เป็นระเบียบเลย
 *
 * ⚠️ ตัวนี้ไม่ต้องแม่น 100% เพราะแอดมินต้องตรวจก่อนบันทึกเสมออยู่แล้ว
 *    แต่ต้อง "ไม่มั่ว" — เอาเบอร์ไปใส่ช่องไปรษณีย์ไม่ได้เด็ดขาด
 */
import { describe, it, expect } from 'vitest';
import { extractAddress, extractPhone, extractPostcode } from '../address';

describe('เบอร์โทร', () => {
  const cases: Array<[string, string | null]> = [
    ['0812345678', '0812345678'],
    ['081-234-5678', '0812345678'],
    ['081 234 5678', '0812345678'],
    ['เบอร์ 0912345678 ค่ะ', '0912345678'],
    ['06-1234-5678', '0612345678'],
    ['โทร.0898765432', '0898765432'],
    // ต้องไม่จับ
    ['02-123-4567', null],
    ['0712345678', null],
    ['12345', null],
    ['', null],
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" → ${expected ?? 'ไม่เจอ'}`, () => {
      expect(extractPhone(input)).toBe(expected);
    });
  }
});

describe('รหัสไปรษณีย์', () => {
  it('เลข 5 หลักที่ไม่ใช่เบอร์', () => {
    expect(extractPostcode('กรุงเทพ 10240', null)).toBe('10240');
  });

  it('🔴 ห้ามหยิบเลข 5 หลักที่อยู่ในเบอร์โทรมาใช้', () => {
    const text = 'โทร 0812345678';
    const phone = extractPhone(text);
    expect(extractPostcode(text, phone)).toBeNull();
  });

  it('มีทั้งเบอร์และไปรษณีย์ ต้องแยกถูก', () => {
    const text = '081-234-5678 กรุงเทพฯ 10110';
    const phone = extractPhone(text);
    expect(phone).toBe('0812345678');
    expect(extractPostcode(text, phone)).toBe('10110');
  });

  it('ไปรษณีย์ขึ้นต้นด้วย 0 ไม่มีจริง จึงไม่จับ', () => {
    expect(extractPostcode('เลข 01234', null)).toBeNull();
  });

  it('เลข 6 หลักไม่ใช่ไปรษณีย์', () => {
    expect(extractPostcode('รหัส 123456', null)).toBeNull();
  });
});

describe('ดึงทั้งชุดจากข้อความจริง', () => {
  it('ข้อความแบบที่ลูกค้าพิมพ์มาบ่อยที่สุด', () => {
    const text = `คุณสมหญิง ใจดี
081-234-5678
123/45 หมู่ 6 ต.บางรัก อ.เมือง จ.สมุทรปราการ
10270`;

    const r = extractAddress(text);
    expect(r.recipient_name).toBe('คุณสมหญิง ใจดี');
    expect(r.phone).toBe('0812345678');
    expect(r.postcode).toBe('10270');
    expect(r.address).toContain('ต.บางรัก');
    expect(r.confidence).toBe('high');
  });

  it('พิมพ์ติดกันมาบรรทัดเดียว ก็ยังได้เบอร์กับไปรษณีย์', () => {
    const r = extractAddress('ส่งที่ 99/1 ถ.สุขุมวิท แขวงคลองเตย กทม 10110 โทร 0898765432');
    expect(r.phone).toBe('0898765432');
    expect(r.postcode).toBe('10110');
    expect(r.address).toContain('ถ.สุขุมวิท');
  });

  it('มีคำว่า "ชื่อ" นำหน้า → ตัดออกให้', () => {
    const r = extractAddress('ชื่อ สมชาย รักดี\n0812345678');
    expect(r.recipient_name).toBe('สมชาย รักดี');
  });

  it('บรรทัดที่อยู่ต้องไม่ถูกหยิบมาเป็นชื่อ', () => {
    const r = extractAddress('ต.ในเมือง อ.เมือง จ.ขอนแก่น\nคุณมานี');
    expect(r.recipient_name).toBe('คุณมานี');
  });

  it('เบอร์ล้วน ๆ ไม่ควรกลายเป็นบรรทัดที่อยู่', () => {
    const r = extractAddress('0812345678\n11/22 ซอย 5 ต.คลองหนึ่ง\n12120');
    expect(r.address).not.toContain('0812345678');
    expect(r.address).toContain('ซอย 5');
  });

  it('ข้อความทักทายธรรมดา → ไม่ควรได้อะไรที่มั่ว', () => {
    const r = extractAddress('สนใจโปร 2 ชิ้นค่ะ ราคาเท่าไหร่');
    expect(r.phone).toBeNull();
    expect(r.postcode).toBeNull();
    expect(r.address).toBeNull();
    expect(r.confidence).toBe('low');
  });

  it('ข้อความว่าง / null → คืนค่าว่างโดยไม่ล้ม', () => {
    expect(extractAddress('')).toMatchObject({ phone: null, confidence: 'low' });
    expect(extractAddress(null)).toMatchObject({ phone: null });
    expect(extractAddress(undefined)).toMatchObject({ phone: null });
  });

  it('มีหลายบรรทัดที่อยู่ ต้องเก็บมาครบ', () => {
    const r = extractAddress(`บ้านเลขที่ 55
หมู่ 3 ต.หนองปรือ
อ.บางละมุง จ.ชลบุรี
20150`);
    expect(r.address?.split('\n')).toHaveLength(3);
    expect(r.postcode).toBe('20150');
  });
});
