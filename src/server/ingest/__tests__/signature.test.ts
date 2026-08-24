/**
 * ชุดทดสอบการตรวจลายเซ็น webhook (เช็คลิสต์ความปลอดภัยข้อ 2)
 * ===========================================================================
 * นี่คือด่านเดียวที่กันคนแปลกหน้ายิงข้อความปลอมเข้าระบบ
 * ถ้าด่านนี้พลาด ใครก็สร้างแชทปลอม/ออเดอร์ปลอมได้
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyHubToken, verifyMetaSignature } from '../signature';

const SECRET = 'app-secret-สำหรับทดสอบ-1234567890';
const BODY = JSON.stringify({ object: 'page', entry: [{ id: '1', messaging: [] }] });

function sign(body: string, secret = SECRET): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

describe('ตรวจลายเซ็นของ Meta', () => {
  it('ลายเซ็นถูกต้อง → ผ่าน', () => {
    expect(verifyMetaSignature(BODY, sign(BODY), SECRET)).toEqual({ ok: true });
  });

  it('ไม่มีหัวข้อลายเซ็น → ไม่ผ่าน', () => {
    const r = verifyMetaSignature(BODY, null, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_header');
  });

  it('ยังไม่ได้ตั้ง META_APP_SECRET → ไม่ผ่าน (ห้ามปล่อยผ่านเด็ดขาด)', () => {
    const r = verifyMetaSignature(BODY, sign(BODY), undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_app_secret');
  });

  it('เซ็นด้วย secret คนละตัว → ไม่ผ่าน', () => {
    const r = verifyMetaSignature(BODY, sign(BODY, 'secret-ของคนอื่น'), SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('mismatch');
  });

  it('เนื้อหาถูกแก้แม้แต่ตัวอักษรเดียว → ไม่ผ่าน', () => {
    const signature = sign(BODY);
    const tampered = BODY.replace('"1"', '"2"');
    expect(tampered).not.toBe(BODY);
    const r = verifyMetaSignature(tampered, signature, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('mismatch');
  });

  it('ลายเซ็นของก้อนอื่น เอามาใช้กับก้อนนี้ไม่ได้', () => {
    const other = JSON.stringify({ object: 'page', entry: [] });
    const r = verifyMetaSignature(BODY, sign(other), SECRET);
    expect(r.ok).toBe(false);
  });

  const badFormats = ['sha1=abcdef', 'abcdef', 'sha256=', 'sha256=ไม่ใช่ฐานสิบหก', `sha256=${'a'.repeat(63)}`];
  for (const header of badFormats) {
    it(`รูปแบบผิด "${header.slice(0, 20)}" → ไม่ผ่าน`, () => {
      const r = verifyMetaSignature(BODY, header, SECRET);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['bad_format', 'mismatch']).toContain(r.reason);
    });
  }

  it('ตัวพิมพ์ใหญ่ในลายเซ็นยังใช้ได้ (Meta เคยส่งมาทั้งสองแบบ)', () => {
    const upper = sign(BODY).toUpperCase().replace('SHA256=', 'sha256=');
    expect(verifyMetaSignature(BODY, upper, SECRET)).toEqual({ ok: true });
  });

  it('เนื้อหาภาษาไทยเซ็นแล้วตรวจได้ถูกต้อง', () => {
    const thai = JSON.stringify({ text: 'สนใจโปร 2 ชิ้นค่ะ 🙏' });
    expect(verifyMetaSignature(thai, sign(thai), SECRET)).toEqual({ ok: true });
  });
});

describe('ตรวจ token ตอนยืนยันความเป็นเจ้าของ URL', () => {
  it('ตรงกัน → ผ่าน', () => {
    expect(verifyHubToken('ค่าลับ-123', 'ค่าลับ-123')).toBe(true);
  });
  it('ไม่ตรง → ไม่ผ่าน', () => {
    expect(verifyHubToken('ค่าลับ-123', 'ค่าลับ-124')).toBe(false);
  });
  it('ความยาวต่างกัน → ไม่ผ่าน (ห้ามโยน error)', () => {
    expect(verifyHubToken('สั้น', 'ยาวกว่ามาก ๆ')).toBe(false);
  });
  it('ยังไม่ได้ตั้งค่า → ไม่ผ่าน', () => {
    expect(verifyHubToken('อะไรก็ได้', undefined)).toBe(false);
    expect(verifyHubToken(null, 'ค่าลับ')).toBe(false);
  });
});
