/**
 * ชุดทดสอบระบบ login
 * -------------------------------------------------------------------------
 * ทดสอบเฉพาะส่วนที่ไม่ต้องต่อฐานข้อมูล :
 *   • hash / verify รหัสผ่าน
 *   • เกณฑ์ความแข็งแรงของรหัสผ่าน
 *   • ตั๋ว session — เซ็น / ตรวจ / หมดอายุ / แก้ค่าแล้วต้องไม่ผ่าน
 *   • ตารางสิทธิ์ 3 ระดับ ตามสเปกหัวข้อ 5.7
 *   • เข้ารหัส / ถอดรหัส access token
 *
 * รัน : npm test
 */
import { describe, it, expect, beforeAll } from 'vitest';

const SECRET = 'ทดสอบ-secret-ที่ยาวเกินสามสิบสองตัวอักษรแน่นอนจริง ๆ นะ';

describe('รหัสผ่าน (argon2)', () => {
  it('hash แล้ว verify กลับต้องผ่าน', async () => {
    const { hashPassword, verifyPassword } = await import('@/lib/auth/password');
    const hash = await hashPassword('SomPhong#2026');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'SomPhong#2026')).toBe(true);
  });

  it('รหัสผิดต้องไม่ผ่าน', async () => {
    const { hashPassword, verifyPassword } = await import('@/lib/auth/password');
    const hash = await hashPassword('SomPhong#2026');
    expect(await verifyPassword(hash, 'somphong#2026')).toBe(false);
  });

  it('hash เสียหายต้องคืน false ไม่ใช่โยน error', async () => {
    const { verifyPassword } = await import('@/lib/auth/password');
    expect(await verifyPassword('ไม่ใช่ hash', 'อะไรก็ได้')).toBe(false);
  });

  it('รหัสผ่านสองครั้งต้องได้ hash คนละค่า (มี salt)', async () => {
    const { hashPassword } = await import('@/lib/auth/password');
    const a = await hashPassword('samepassword');
    const b = await hashPassword('samepassword');
    expect(a).not.toBe(b);
  });
});

describe('เกณฑ์รหัสผ่าน', () => {
  it('สั้นกว่า 8 ตัวไม่ผ่าน', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    expect(validatePasswordStrength('1234567').ok).toBe(false);
  });
  it('ตัวเลขล้วนไม่ผ่าน', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    expect(validatePasswordStrength('123456789').ok).toBe(false);
  });
  it('รหัสยอดฮิตไม่ผ่าน', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    expect(validatePasswordStrength('password').ok).toBe(false);
  });
  it('รหัสปกติผ่าน', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    expect(validatePasswordStrength('lipstick2026').ok).toBe(true);
  });
});

describe('ตั๋ว session', () => {
  it('เซ็นแล้วตรวจกลับได้ค่าเดิม', async () => {
    const { signSession, verifySession } = await import('@/lib/auth/session');
    const token = await signSession({ sub: 'admin-1', sv: 3, role: 'owner', mcp: false }, SECRET, 1);
    const payload = await verifySession(token, SECRET);
    expect(payload).toEqual({ sub: 'admin-1', sv: 3, role: 'owner', mcp: false });
  });

  it('ใช้ secret คนละตัวต้องไม่ผ่าน', async () => {
    const { signSession, verifySession } = await import('@/lib/auth/session');
    const token = await signSession({ sub: 'admin-1', sv: 1, role: 'admin', mcp: false }, SECRET, 1);
    expect(await verifySession(token, `${SECRET}-อีกตัว`)).toBeNull();
  });

  it('แก้เนื้อในตั๋วแล้วต้องไม่ผ่าน (กันปลอมสิทธิ์เป็นเจ้าของ)', async () => {
    const { signSession, verifySession } = await import('@/lib/auth/session');
    const token = await signSession({ sub: 'admin-1', sv: 1, role: 'viewer', mcp: false }, SECRET, 1);
    const [h, p, s] = token.split('.');
    const body = JSON.parse(Buffer.from(p!, 'base64url').toString());
    body.role = 'owner'; // พยายามเลื่อนขั้นตัวเอง
    const forged = `${h}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${s}`;
    expect(await verifySession(forged, SECRET)).toBeNull();
  });

  it('ตั๋วหมดอายุต้องไม่ผ่าน', async () => {
    const { signSession, verifySession } = await import('@/lib/auth/session');
    const token = await signSession({ sub: 'a', sv: 1, role: 'admin', mcp: false }, SECRET, -1);
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it('ข้อความมั่ว ๆ ต้องไม่ผ่าน', async () => {
    const { verifySession } = await import('@/lib/auth/session');
    expect(await verifySession('ไม่ใช่ตั๋ว', SECRET)).toBeNull();
  });
});

describe('ตารางสิทธิ์ตามหัวข้อ 5.7', () => {
  it('ตอบแชท : เจ้าของ ✅ / แอดมิน ✅ / ผู้ดู ❌', async () => {
    const { can } = await import('@/lib/auth/permissions');
    expect(can('owner', 'chat.reply')).toBe(true);
    expect(can('admin', 'chat.reply')).toBe(true);
    expect(can('viewer', 'chat.reply')).toBe(false);
  });

  it('ลบออเดอร์ : เจ้าของเท่านั้น', async () => {
    const { can } = await import('@/lib/auth/permissions');
    expect(can('owner', 'order.delete')).toBe(true);
    expect(can('admin', 'order.delete')).toBe(false);
    expect(can('viewer', 'order.delete')).toBe(false);
  });

  it('แก้ชุดคำตอบ/คีย์เวิร์ด : แอดมินดูได้อย่างเดียว', async () => {
    const { can } = await import('@/lib/auth/permissions');
    expect(can('admin', 'content.view')).toBe(true);
    expect(can('admin', 'content.manage')).toBe(false);
    expect(can('owner', 'content.manage')).toBe(true);
  });

  it('เชื่อมเพจ / เห็น token : เจ้าของเท่านั้น', async () => {
    const { can } = await import('@/lib/auth/permissions');
    expect(can('owner', 'page.manage')).toBe(true);
    expect(can('admin', 'page.manage')).toBe(false);
    expect(can('viewer', 'page.manage')).toBe(false);
  });

  it('สร้าง/ลบแอดมิน : เจ้าของเท่านั้น', async () => {
    const { can } = await import('@/lib/auth/permissions');
    expect(can('owner', 'admin.manage')).toBe(true);
    expect(can('admin', 'admin.manage')).toBe(false);
    expect(can('viewer', 'admin.manage')).toBe(false);
  });

  it('เจ้าของเห็นทุกเพจ / คนอื่นเห็นเฉพาะที่ได้รับสิทธิ์', async () => {
    const { canSeePage } = await import('@/lib/auth/permissions');
    expect(canSeePage('owner', [], 'page-x')).toBe(true);
    expect(canSeePage('admin', ['page-a'], 'page-a')).toBe(true);
    expect(canSeePage('admin', ['page-a'], 'page-b')).toBe(false);
  });
});

describe('เข้ารหัส access token', () => {
  beforeAll(() => {
    // คีย์ทดสอบ 32 ไบต์
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'.repeat(40);
    process.env.SESSION_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'y'.repeat(40);
  });

  it('เข้ารหัสแล้วถอดกลับได้ค่าเดิม', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto');
    const token = 'EAAG-page-access-token-ตัวอย่าง';
    const enc = encryptSecret(token);
    expect(enc).not.toContain(token);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(decryptSecret(enc)).toBe(token);
  });

  it('เข้ารหัสค่าเดิมสองครั้งต้องได้ผลต่างกัน (IV สุ่มใหม่ทุกครั้ง)', async () => {
    const { encryptSecret } = await import('@/lib/crypto');
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('ถ้าข้อมูลถูกแก้ ต้องโยน error ไม่ใช่คืนค่ามั่ว', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto');
    const enc = encryptSecret('secret-value');
    const parts = enc.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${Buffer.from('แก้ไขแล้ว').toString('base64url')}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('maskSecret ต้องไม่โชว์ค่ากลาง', async () => {
    const { maskSecret } = await import('@/lib/crypto');
    expect(maskSecret('ABCDEFGHIJKLMNOP')).toBe('ABCD••••MNOP');
  });
});
