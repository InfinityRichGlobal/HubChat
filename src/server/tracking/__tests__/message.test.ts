/**
 * ชุดทดสอบข้อความแจ้งเลขพัสดุ (รอบ 8)
 * ===========================================================================
 * 🔴 กฎของ Meta ที่พลาดไม่ได้ :
 *    ข้อความหมวด utility ต้องเป็นการ "แจ้งข้อมูล" ล้วน ๆ
 *    ถ้าแทรกการขายเข้าไป จะหลุดจากหมวดนี้ทันที = เสี่ยงโดนระงับ
 */
import { describe, it, expect } from 'vitest';
import { buildTrackingMessage, carrierLabel, looksLikeSales, trackUrl } from '../message';

describe('ประกอบข้อความ', () => {
  it('ครบทุกช่อง', () => {
    const text = buildTrackingMessage({
      order_no: 'ORD-260823-001',
      recipient: 'สมชาย',
      tracking_no: 'TH1234567890',
      carrier: 'flash',
    });
    expect(text).toContain('คุณสมชาย');
    expect(text).toContain('ORD-260823-001');
    expect(text).toContain('TH1234567890');
    expect(text).toContain('Flash Express');
    expect(text).toContain('flashexpress.co.th');
  });

  it('ไม่มีชื่อผู้รับ ก็ยังอ่านรู้เรื่อง', () => {
    const text = buildTrackingMessage({
      order_no: 'ORD-1',
      tracking_no: 'TH1',
      recipient: null,
      carrier: null,
    });
    expect(text).toContain('ORD-1');
    expect(text).not.toContain('คุณ ');
  });

  it('ขนส่งที่ไม่รู้จัก = แสดงชื่อตามที่กรอกมา ไม่มีลิงก์', () => {
    const text = buildTrackingMessage({
      order_no: 'ORD-1',
      tracking_no: 'X1234567',
      carrier: 'ขนส่งเจ้าเล็ก',
    });
    expect(text).toContain('ขนส่งเจ้าเล็ก');
    expect(text).not.toContain('http');
  });

  it('🔴 ห้ามมีคำขายในเทมเพลตเด็ดขาด', () => {
    const text = buildTrackingMessage({
      order_no: 'ORD-1',
      recipient: 'สมชาย',
      tracking_no: 'TH1234567890',
      carrier: 'kerry',
    });
    expect(looksLikeSales(text)).toBe(false);
  });

  it('ตัวจับคำขายต้องทำงานจริง (กันคนแก้เทมเพลตในอนาคต)', () => {
    expect(looksLikeSales('ออเดอร์จัดส่งแล้ว สนใจโปรโมชันเพิ่มไหมคะ')).toBe(true);
  });
});

describe('ชื่อขนส่งและลิงก์', () => {
  it('แปลงรหัสเป็นชื่อที่ลูกค้าอ่านออก', () => {
    expect(carrierLabel('flash')).toBe('Flash Express');
    expect(carrierLabel('thailand_post')).toBe('ไปรษณีย์ไทย');
    expect(carrierLabel(null)).toBeNull();
  });

  it('ลิงก์ตรวจสถานะใส่เลขพัสดุแบบเข้ารหัส URL แล้ว', () => {
    const url = trackUrl('kerry', 'TH 1234');
    expect(url).toContain('TH%201234');
  });

  it('ขนส่งที่ไม่รู้จัก = ไม่มีลิงก์ (ดีกว่าให้ลิงก์ผิด)', () => {
    expect(trackUrl('เจ้าเล็ก', 'X1')).toBeNull();
  });
});
