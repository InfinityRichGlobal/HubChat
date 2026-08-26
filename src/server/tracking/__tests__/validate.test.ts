/**
 * ชุดทดสอบการตรวจแต่ละแถวของไฟล์ขนส่ง (รอบ 8)
 * ===========================================================================
 * หลักการที่ชุดนี้คุ้มครอง : "แถวเสียต้องรายงานชัด แถวดีต้องเดินต่อได้"
 */
import { describe, it, expect } from 'vitest';
import { parseCsv } from '../csv';
import { hasError, validateRows } from '../validate';
import { guessMapping, mappingProblem } from '../columns';

const HEADER = 'เลขออเดอร์,เลขพัสดุ,ชื่อผู้รับ,เบอร์ผู้รับ,รหัสไปรษณีย์';

function run(...lines: string[]) {
  const table = parseCsv([HEADER, ...lines].join('\n'));
  return validateRows(table, guessMapping(table.headers));
}

describe('แถวปกติ', () => {
  it('ครบทุกช่อง = ไม่มีปัญหา', () => {
    const [r] = run('ORD-260823-001,TH1234567890,คุณสมชาย,081-234-5678,10230');
    expect(r.problems).toEqual([]);
    expect(r.tracking_no).toBe('TH1234567890');
    expect(r.order_ref).toBe('ORD-260823-001');
    expect(r.phone_normalized).toBe('0812345678');
    expect(r.postcode).toBe('10230');
    expect(r.name_normalized).toBe('สมชาย');
    expect(hasError(r)).toBe(false);
  });

  it('ลำดับแถวเริ่มที่ 1 ไม่นับหัวตาราง', () => {
    const rows = run(
      'ORD-1,TH1234567890,ก,0812345678,10230',
      'ORD-2,TH0987654321,ข,0898765432,10230',
    );
    expect(rows.map((r) => r.row_index)).toEqual([1, 2]);
  });
});

describe('เลขพัสดุ', () => {
  it('🔴 ไม่มีเลขพัสดุ = error', () => {
    const [r] = run('ORD-260823-001,,คุณสมชาย,0812345678,10230');
    expect(hasError(r)).toBe(true);
    expect(r.problems[0].code).toBe('tracking_missing');
  });

  it('🔴 สั้นผิดปกติ = error (พิมพ์ตกแน่ ๆ)', () => {
    const [r] = run('ORD-260823-001,TH1,คุณสมชาย,0812345678,10230');
    expect(r.problems.some((p) => p.code === 'tracking_length')).toBe(true);
  });

  it('🔴 มีอักขระแปลก = error', () => {
    const [r] = run('ORD-260823-001,"TH123@456#78",คุณสมชาย,0812345678,10230');
    expect(r.problems.some((p) => p.code === 'tracking_charset')).toBe(true);
  });
});

describe('กุญแจสำหรับจับคู่', () => {
  it('🔴 ไม่มีทั้งเลขออเดอร์และเบอร์ = error', () => {
    const [r] = run(',TH1234567890,คุณสมชาย,,10230');
    expect(r.problems.some((p) => p.code === 'no_key')).toBe(true);
  });

  it('🔴 เบอร์เสียและไม่มีเลขออเดอร์ = error พร้อมบอกเบอร์ที่มีปัญหา', () => {
    const [r] = run(',TH1234567890,คุณสมชาย,abc,10230');
    const p = r.problems.find((x) => x.code === 'phone_invalid');
    expect(p?.level).toBe('error');
    expect(p?.message_th).toContain('abc');
  });

  it('เบอร์เสียแต่มีเลขออเดอร์ = แค่เตือน ยังเดินต่อได้', () => {
    const [r] = run('ORD-260823-001,TH1234567890,คุณสมชาย,abc,10230');
    const p = r.problems.find((x) => x.code === 'phone_invalid');
    expect(p?.level).toBe('warning');
    expect(hasError(r)).toBe(false);
  });
});

describe('รหัสไปรษณีย์', () => {
  it('ไม่ใช่ 5 หลัก = เตือนอย่างเดียว ไม่ถึงกับ error', () => {
    const [r] = run('ORD-260823-001,TH1234567890,คุณสมชาย,0812345678,102');
    expect(r.problems.some((p) => p.code === 'postcode_invalid' && p.level === 'warning')).toBe(true);
    expect(hasError(r)).toBe(false);
  });
});

describe('แถวซ้ำในไฟล์เดียวกัน', () => {
  it('⭐ ตัวแรกชนะเสมอ ตัวหลังกลายเป็นซ้ำ (ผลเหมือนเดิมทุกครั้งที่รัน)', () => {
    const rows = run(
      'ORD-260823-001,TH1234567890,ก,0812345678,10230',
      'ORD-260823-001,TH1234567890,ก,0812345678,10230',
      'ORD-260823-002,TH0987654321,ข,0898765432,10230',
    );
    expect(rows[0].duplicate_of).toBeNull();
    expect(rows[1].duplicate_of).toBe(1);
    expect(rows[2].duplicate_of).toBeNull();
  });

  it('รันซ้ำได้ผลเดิมเป๊ะ', () => {
    const lines = [
      'ORD-260823-001,TH1234567890,ก,0812345678,10230',
      'ORD-260823-001,TH1234567890,ก,0812345678,10230',
    ];
    const a = run(...lines).map((r) => r.duplicate_of);
    const b = run(...lines).map((r) => r.duplicate_of);
    expect(b).toEqual(a);
  });

  it('เบอร์เขียนคนละแบบแต่เป็นเบอร์เดียวกัน ก็ถือว่าซ้ำ', () => {
    const rows = run(
      'ORD-260823-001,TH1234567890,ก,0812345678,10230',
      'ORD-260823-001,th 1234 5678 90,ก,081-234-5678,10230',
    );
    expect(rows[1].duplicate_of).toBe(1);
  });
});

describe('คอลัมน์ขาด', () => {
  it('🔴 ไม่มีคอลัมน์เลขพัสดุเลย = ปฏิเสธทั้งไฟล์', () => {
    const table = parseCsv('เลขออเดอร์,ชื่อผู้รับ\nORD-1,ก\n');
    expect(mappingProblem(guessMapping(table.headers))).toContain('เลขพัสดุ');
  });

  it('🔴 มีเลขพัสดุแต่ไม่มีอะไรให้จับคู่เลย = ปฏิเสธทั้งไฟล์', () => {
    const table = parseCsv('เลขพัสดุ,ชื่อผู้รับ\nTH1,ก\n');
    expect(mappingProblem(guessMapping(table.headers))).toContain('เลขออเดอร์');
  });
});
