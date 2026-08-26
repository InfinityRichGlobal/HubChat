/**
 * ชุดทดสอบชื่อที่แสดงแทนลูกค้า
 * 🔴 กฎที่ห้ามพัง : มีชื่อจริงเมื่อไหร่ ต้องใช้ชื่อจริงเสมอ
 */
import { describe, it, expect } from 'vitest';
import { displayName, fallbackName, hasRealName } from '../customer-name';
import { initialsOf } from '@/components/customer-avatar';

describe('ชื่อที่แสดง', () => {
  it('มีชื่อจริง = ใช้ชื่อจริง', () => {
    expect(displayName({ customer_name: 'สมชาย ใจดี', psid: '1234567890' })).toBe('สมชาย ใจดี');
  });

  it('ไม่มีชื่อ = ใช้ชื่อสำรองที่อ่านออก', () => {
    expect(displayName({ customer_name: null, psid: '1234567890' })).toBe('ลูกค้า 567890');
  });

  it('🔴 ชื่อที่เป็นช่องว่างล้วน ต้องนับว่าไม่มีชื่อ', () => {
    expect(displayName({ customer_name: '   ', psid: '1234567890' })).toBe('ลูกค้า 567890');
    expect(hasRealName({ customer_name: '   ', psid: '1' })).toBe(false);
  });

  it('ตัดช่องว่างหน้าหลังออกให้', () => {
    expect(displayName({ customer_name: '  สมหญิง  ', psid: '1' })).toBe('สมหญิง');
  });

  it('psid สั้นกว่า 6 ตัวก็ต้องไม่พัง', () => {
    expect(fallbackName('123')).toBe('ลูกค้า 123');
  });
});

describe('ตัวอักษรย่อบนรูปแทน', () => {
  it('🔴 ต้องรองรับภาษาไทย — สระต้องไม่หลุดมาลอย ๆ', () => {
    /**
     * ถ้าใช้ str[0] กับคำที่ขึ้นต้นด้วยสระประสม จะได้อักขระที่อ่านไม่ออก
     * ต้องใช้ [...str] ซึ่งแบ่งตามอักขระจริง
     */
    expect(initialsOf('สมชาย ใจดี')).toBe('สใ');
    expect(initialsOf('เอกชัย')).toBe('เ');
  });

  it('ชื่ออังกฤษได้ตัวใหญ่', () => {
    expect(initialsOf('john smith')).toBe('JS');
  });

  it('ชื่อว่างต้องไม่พัง', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
  });
});
