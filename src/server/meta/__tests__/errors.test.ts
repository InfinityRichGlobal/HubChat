/**
 * ชุดทดสอบการแยกประเภท error ของ Meta (สเปก 6.1 กฎเหล็กข้อ 3)
 * "ห้าม retry มั่ว" — error เชิงนโยบายห้ามลองใหม่เด็ดขาด
 */
import { describe, it, expect } from 'vitest';
import { classifyMetaError, isRetryable, isOutcomeUnknown, backoffMs } from '../errors';

describe('error ชั่วคราว → ลองใหม่ได้', () => {
  it('เซิร์ฟเวอร์ Meta ล่ม (5xx)', () => {
    const e = classifyMetaError({ message: 'internal' }, 500);
    expect(e.kind).toBe('transient');
    expect(isRetryable(e)).toBe(true);
  });

  it('ยิงถี่เกิน (HTTP 429)', () => {
    expect(isRetryable(classifyMetaError(null, 429))).toBe(true);
  });

  it.each([1, 2, 4, 17, 32, 613])('code %i ถือว่าชั่วคราว', (code) => {
    expect(isRetryable(classifyMetaError({ code }, 400))).toBe(true);
  });

  it('5xx ที่มีคำตอบของ Meta ชัดเจน = Meta ประมวลผลแล้วและไม่รับ → ลองใหม่ได้', () => {
    const e = classifyMetaError({ code: 2, message: 'temporary' }, 503);
    expect(e.kind).toBe('transient');
    expect(isRetryable(e)).toBe(true);
  });
});

describe('🔴 ไม่รู้ผล (ambiguous) → ห้ามลองใหม่เด็ดขาด', () => {
  it('คำขอออกไปแล้วแต่ไม่ได้รับคำตอบ (timeout/เน็ตขาด)', () => {
    const e = classifyMetaError({ message: 'aborted' }, 0, { networkFailure: true });
    expect(e.kind).toBe('ambiguous');
    expect(isRetryable(e)).toBe(false);
    expect(isOutcomeUnknown(e)).toBe(true);
  });

  it('gateway timeout 504 — คำขอน่าจะถึง Meta แล้วแต่คำตอบไม่กลับมา', () => {
    const e = classifyMetaError(null, 504);
    expect(e.kind).toBe('ambiguous');
    expect(isRetryable(e)).toBe(false);
  });

  it('408 request timeout ก็ถือว่าไม่รู้ผล', () => {
    expect(classifyMetaError(null, 408).kind).toBe('ambiguous');
  });

  it('5xx ที่อ่านคำตอบไม่ออกเลย → ไม่รู้ผล ปลอดภัยไว้ก่อน', () => {
    const e = classifyMetaError(null, 500);
    expect(e.kind).toBe('ambiguous');
    expect(isRetryable(e)).toBe(false);
  });

  it('ข้อความภาษาไทยต้องบอกให้คนไปตรวจเอง ไม่ใช่บอกว่าจะลองใหม่ให้', () => {
    const e = classifyMetaError({ message: 'aborted' }, 0, { networkFailure: true });
    expect(e.message_th).toContain('ไม่ทราบ');
    expect(e.message_th).toContain('ตรวจสอบ');
    expect(e.message_th).not.toContain('จะลองส่งใหม่ให้อัตโนมัติ');
  });

  it('ไม่รู้ผล ต้องไม่ถูกตีความว่ากรอบเวลาปิด (ไม่ไปแตะข้อสังเกตเชิงนโยบาย)', () => {
    const e = classifyMetaError({ error_subcode: 2018278 }, 0, { networkFailure: true });
    expect(e.window_actually_closed).toBe(false);
  });
});

describe('🔴 error เชิงนโยบาย → ห้ามลองใหม่เด็ดขาด', () => {
  it.each([10, 200, 551, 10900, 11000])('code %i ห้าม retry', (code) => {
    const e = classifyMetaError({ code }, 400);
    expect(e.kind).toBe('policy');
    expect(isRetryable(e)).toBe(false);
  });

  it('กรอบเวลาปิดแล้ว (subcode 2018278) ห้าม retry และต้องแก้ข้อมูลให้ตรงความจริง', () => {
    const e = classifyMetaError({ code: 10, error_subcode: 2018278, message: 'outside window' }, 400);
    expect(isRetryable(e)).toBe(false);
    expect(e.window_actually_closed).toBe(true);
    expect(e.message_th).toContain('กรอบเวลา');
  });

  it('ลูกค้าปิดรับข้อความ (subcode 2018108) ห้าม retry', () => {
    const e = classifyMetaError({ code: 10, error_subcode: 2018108 }, 400);
    expect(isRetryable(e)).toBe(false);
    expect(e.window_actually_closed).toBe(true);
  });
});

describe('error ถาวรอื่น ๆ', () => {
  it('ข้อมูลผิดรูปแบบ → ไม่ retry', () => {
    const e = classifyMetaError({ code: 100, message: 'Invalid parameter' }, 400);
    expect(e.kind).toBe('permanent');
    expect(isRetryable(e)).toBe(false);
  });
});

describe('เก็บข้อมูลไว้สืบย้อนหลังครบ', () => {
  it('เก็บ code / subcode / fbtrace_id ไว้ลง send_attempts', () => {
    const e = classifyMetaError(
      { code: 10, error_subcode: 2018278, message: 'nope', fbtrace_id: 'ABC123' },
      400,
    );
    expect(e.code).toBe(10);
    expect(e.subcode).toBe(2018278);
    expect(e.fbtrace_id).toBe('ABC123');
  });
});

describe('exponential backoff', () => {
  it('หน่วงนานขึ้นทุกครั้งที่ลองใหม่', () => {
    expect(backoffMs(1, 500)).toBe(500);
    expect(backoffMs(2, 500)).toBe(1000);
    expect(backoffMs(3, 500)).toBe(2000);
    expect(backoffMs(4, 500)).toBe(4000);
  });
});
