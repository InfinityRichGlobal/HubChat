/**
 * ชุดทดสอบการเดาขนส่ง + เดาคอลัมน์ (รอบ 8)
 */
import { describe, it, expect } from 'vitest';
import { csvTemplate, guessCourier, guessMapping, mappingProblem } from '../columns';
import { parseCsv } from '../csv';

describe('เดาคอลัมน์', () => {
  it('หัวตารางภาษาไทย', () => {
    const m = guessMapping(['เลขออเดอร์', 'เลขพัสดุ', 'ชื่อผู้รับ', 'เบอร์ผู้รับ', 'รหัสไปรษณีย์']);
    expect(m.order_ref).toBe('เลขออเดอร์');
    expect(m.tracking_no).toBe('เลขพัสดุ');
    expect(m.recipient_name).toBe('ชื่อผู้รับ');
    expect(m.phone).toBe('เบอร์ผู้รับ');
    expect(m.postcode).toBe('รหัสไปรษณีย์');
  });

  it('หัวตารางภาษาอังกฤษ', () => {
    const m = guessMapping(['Order No', 'Tracking No', 'Receiver Name', 'Phone', 'Postcode']);
    expect(m.order_ref).toBe('Order No');
    expect(m.tracking_no).toBe('Tracking No');
    expect(m.phone).toBe('Phone');
  });

  it('⭐ คอลัมน์หนึ่งถูกใช้ได้ครั้งเดียว — กัน "ชื่อ" ไปโดนสองช่อง', () => {
    const m = guessMapping(['ชื่อผู้รับ', 'ชื่อผู้ส่ง', 'เลขพัสดุ', 'เบอร์โทร']);
    expect(m.recipient_name).toBe('ชื่อผู้รับ');
    // ช่องอื่นต้องไม่ถูกจับไปที่คอลัมน์เดียวกัน
    const used = Object.values(m);
    expect(new Set(used).size).toBe(used.length);
  });

  it('🔴 ไฟล์ขนส่งที่มีทั้งผู้ส่งและผู้รับ ต้องเลือก "ผู้รับ" เสมอ', () => {
    // เคยพลาดจริง : คำใบ้ถูกวนผิดด้าน ทำให้คอลัมน์แรกที่มีคำว่า "เบอร์" ชนะ
    // ผลคือระบบเอาเบอร์ของ "ผู้ส่ง" (คือร้านเราเอง) ไปจับคู่ออเดอร์
    const m = guessMapping([
      'เลขพัสดุ', 'ชื่อผู้ส่งของ', 'เบอร์ผู้ส่งของ', 'ชื่อผู้รับของ', 'เบอร์ผู้รับของ',
    ]);
    expect(m.phone).toBe('เบอร์ผู้รับของ');
    expect(m.recipient_name).toBe('ชื่อผู้รับของ');
  });

  it('หัวตารางภาษาอังกฤษที่มีทั้งสองฝั่ง ก็ต้องเลือกผู้รับ', () => {
    const m = guessMapping(['Tracking No', 'Sender Phone', 'Receiver Phone', 'Sender Name', 'Receiver Name']);
    expect(m.phone).toBe('Receiver Phone');
    expect(m.recipient_name).toBe('Receiver Name');
  });

  it('หัวตารางที่ไม่รู้จัก = ไม่เดามั่ว', () => {
    const m = guessMapping(['ก', 'ข', 'ค']);
    expect(m.tracking_no).toBeUndefined();
  });
});

describe('เดาขนส่ง', () => {
  it('จากหัวตาราง', () => {
    expect(guessCourier(['PNO', 'Receiver'], '')).toBe('flash');
    expect(guessCourier(['Kerry Tracking'], '')).toBe('kerry');
  });

  it('จากชื่อไฟล์', () => {
    expect(guessCourier(['a', 'b'], 'jt express 2026-08.csv')).toBe('jt');
    expect(guessCourier(['a'], 'ไปรษณีย์ไทย-สิงหา.csv')).toBe('thailand_post');
  });

  it('เดาไม่ออก = custom ไม่ใช่เดามั่ว', () => {
    expect(guessCourier(['x'], 'file.csv')).toBe('custom');
  });
});

describe('ตรวจว่าจับคู่คอลัมน์พอใช้งานได้ไหม', () => {
  it('ครบ = ไม่มีปัญหา', () => {
    expect(mappingProblem({ tracking_no: 'a', phone: 'b' })).toBeNull();
    expect(mappingProblem({ tracking_no: 'a', order_ref: 'b' })).toBeNull();
  });

  it('🔴 ขาดเลขพัสดุ = ปฏิเสธ', () => {
    expect(mappingProblem({ phone: 'b' })).toContain('เลขพัสดุ');
  });
});

describe('ไฟล์ตัวอย่าง', () => {
  it('ระบบต้องอ่านไฟล์ตัวอย่างของตัวเองได้ และจับคู่คอลัมน์ได้ครบ', () => {
    const table = parseCsv(csvTemplate());
    const m = guessMapping(table.headers);
    expect(mappingProblem(m)).toBeNull();
    expect(m.tracking_no).toBeTruthy();
    expect(m.order_ref).toBeTruthy();
  });

  it('มี BOM เพื่อให้ Excel เปิดแล้วภาษาไทยไม่เพี้ยน', () => {
    expect(csvTemplate().charCodeAt(0)).toBe(0xfeff);
  });
});
