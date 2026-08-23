/**
 * Session — เก็บใน httpOnly cookie (เช็คลิสต์ความปลอดภัยข้อ 5)
 * -------------------------------------------------------------------------
 * ทำไมใช้ JWT ที่เซ็นด้วย SESSION_SECRET แทนตาราง session :
 *   • middleware ของ Next รันบน Edge ต่อฐานข้อมูลไม่ได้ → ตรวจลายเซ็นได้เลย เร็ว
 *   • ข้างในเก็บ session_version มาด้วย พอเจ้าของกด "เตะออกทุกเครื่อง"
 *     เราบวก session_version ใน DB → ตั๋วเก่าทุกใบใช้ไม่ได้ทันที
 *
 * ⚠️ ลายเซ็นผ่าน "ไม่ได้" แปลว่าใช้ได้จริง — ทุก request ที่แตะข้อมูลจริง
 *    ต้องเรียก requireAdmin() ที่ไปเทียบ session_version กับฐานข้อมูลอีกชั้น
 *
 * ไฟล์นี้ใช้ jose (ทำงานได้ทั้ง Node และ Edge) จึงห้าม import argon2 หรือ supabase มาที่นี่
 */
import { SignJWT, jwtVerify } from 'jose';
import type { AdminRole } from '@/types/db';

export const SESSION_COOKIE = 'hubchat_session';

export type SessionPayload = {
  /** admin id */
  sub: string;
  /** session_version ณ ตอนออกตั๋ว */
  sv: number;
  /** สิทธิ์ — ใส่ไว้ให้ middleware ตัดสินใจเบื้องต้นได้เร็ว ๆ */
  role: AdminRole;
  /** ต้องเปลี่ยนรหัสผ่านก่อนใช้งานไหม */
  mcp: boolean;
};

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** ออกตั๋ว session ใหม่ */
export async function signSession(
  payload: SessionPayload,
  secret: string,
  ttlHours: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sv: payload.sv, role: payload.role, mcp: payload.mcp })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlHours * 3600)
    .sign(secretKey(secret));
}

/** ตรวจตั๋ว — คืน null ถ้าลายเซ็นผิดหรือหมดอายุ (ไม่โยน error ให้ caller ต้อง try/catch) */
export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string') return null;
    return {
      sub: payload.sub,
      sv: typeof payload.sv === 'number' ? payload.sv : 0,
      role: (payload.role as AdminRole) ?? 'viewer',
      mcp: payload.mcp === true,
    };
  } catch {
    return null;
  }
}

/** ค่าตั้ง cookie ที่ใช้ร่วมกันทั้งตอน set และตอนลบ */
export function sessionCookieOptions(ttlHours: number, isProd: boolean) {
  return {
    httpOnly: true,            // JavaScript ในหน้าเว็บอ่านไม่ได้ → กันขโมย session ผ่าน XSS
    secure: isProd,            // ส่งผ่าน HTTPS เท่านั้นตอนขึ้นจริง
    sameSite: 'lax' as const,  // กัน CSRF ระดับพื้นฐาน
    path: '/',
    maxAge: ttlHours * 3600,
  };
}
