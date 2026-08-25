/**
 * ชุดทดสอบคำอธิบายข้อผิดพลาดตอนซิงก์แชทเก่า (รอบ 7)
 * ===========================================================================
 * 🔴 บทเรียนจาก D-31 : ข้อความกลาง ๆ อย่าง "ทำรายการไม่สำเร็จ" ทำให้เจ้าของร้าน
 *    ไล่ปัญหาต่อเองไม่ได้เลย ต้องบอกให้ชัดว่า "ไปแก้ตรงไหน"
 */
import { describe, it, expect } from 'vitest';
import { explainSyncError } from '../conversations';

describe('แปลข้อผิดพลาดของ Meta ตอนซิงก์', () => {
  it('190 = token หมดอายุ → บอกให้ไปสร้าง token ใหม่', () => {
    expect(explainSyncError(190, 'อะไรสักอย่าง')).toContain('token');
    expect(explainSyncError(190, 'อะไรสักอย่าง')).toContain('ใหม่');
  });

  it('100 / 200 / 10 = สิทธิ์ไม่พอ → บอกชื่อสิทธิ์ที่ต้องมี', () => {
    for (const code of [100, 200, 10]) {
      expect(explainSyncError(code, '-')).toContain('pages_messaging');
    }
  });

  it('4 / 17 / 32 / 613 = ชนโควตา → บอกให้รอ และย้ำว่าของเดิมไม่หาย', () => {
    for (const code of [4, 17, 32, 613]) {
      const msg = explainSyncError(code, '-');
      expect(msg).toContain('รอ');
      expect(msg).toContain('ไม่หาย');
    }
  });

  it('รหัสที่ไม่รู้จัก ต้องคืนข้อความเดิมของ Meta ไม่ใช่กลบด้วยคำกลาง ๆ', () => {
    expect(explainSyncError(99999, 'ข้อความจริงจาก Meta')).toBe('ข้อความจริงจาก Meta');
    expect(explainSyncError(null, 'ข้อความจริงจาก Meta')).toBe('ข้อความจริงจาก Meta');
  });
});
