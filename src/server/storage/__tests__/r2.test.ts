/**
 * ชุดทดสอบตัวช่วยของที่เก็บไฟล์ (D-17)
 * ===========================================================================
 * ทดสอบเฉพาะส่วนที่เป็นฟังก์ชันบริสุทธิ์ — ไม่ต้องมีบัญชี R2 จริง
 */
import { describe, it, expect } from 'vitest';
import { buildKey, extensionFor, sha256Of } from '../r2';

const AT = new Date('2026-08-25T10:00:00.000Z');

describe('การตั้งชื่อไฟล์', () => {
  it('ใช้ลายนิ้วมือของไฟล์เป็นชื่อ — ไฟล์เดิมได้ชื่อเดิมเสมอ', () => {
    const bytes = new TextEncoder().encode('สลิปโอนเงิน').buffer;
    const a = buildKey('inbound', sha256Of(bytes), 'image/jpeg', AT);
    const b = buildKey('inbound', sha256Of(bytes), 'image/jpeg', AT);
    expect(a).toBe(b);
  });

  it('⭐ ไฟล์คนละอัน ต้องได้ชื่อคนละชื่อ', () => {
    const one = sha256Of(new TextEncoder().encode('รูป ก').buffer);
    const two = sha256Of(new TextEncoder().encode('รูป ข').buffer);
    expect(buildKey('inbound', one, 'image/jpeg', AT)).not.toBe(
      buildKey('inbound', two, 'image/jpeg', AT),
    );
  });

  it('แยกโฟลเดอร์ตามปี/เดือน เพื่อไม่ให้ไฟล์กองรวมกันเป็นล้าน', () => {
    const key = buildKey('inbound', 'abc123', 'image/png', AT);
    expect(key).toMatch(/^inbound\/2026\/08\/abc123\.png$/);
  });

  it('⭐ prefix แปลก ๆ ต้องถูกล้าง — กันการหนีออกจากโฟลเดอร์', () => {
    // ถ้าไม่ล้าง '../' จะเขียนไฟล์ทับที่อื่นในถังได้
    const key = buildKey('../../etc', 'abc', 'image/png', AT);
    expect(key).not.toContain('..');
    expect(key).toMatch(/^etc\//);
  });

  it('prefix ว่างเปล่า ต้องมีที่อยู่สำรอง ไม่ใช่ขึ้นต้นด้วย /', () => {
    expect(buildKey('!!!', 'abc', 'image/png', AT)).toMatch(/^misc\//);
  });

  it('นามสกุลไฟล์ตามชนิดจริง ไม่ใช่เดาจากชื่อ', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('IMAGE/PNG')).toBe('png');
    expect(extensionFor('application/pdf')).toBe('pdf');
    // ชนิดที่ไม่รู้จัก → .bin ปลอดภัยกว่าเดา
    expect(extensionFor('application/x-weird')).toBe('bin');
  });
});

describe('ลายนิ้วมือไฟล์', () => {
  it('เนื้อหาเดียวกันได้ค่าเดียวกัน', () => {
    const a = new TextEncoder().encode('เหมือนกัน').buffer;
    const b = new TextEncoder().encode('เหมือนกัน').buffer;
    expect(sha256Of(a)).toBe(sha256Of(b));
  });

  it('เป็นเลขฐาน 16 ยาว 64 ตัว', () => {
    expect(sha256Of(new TextEncoder().encode('x').buffer)).toMatch(/^[0-9a-f]{64}$/);
  });
});
