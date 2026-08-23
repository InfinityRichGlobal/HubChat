/**
 * POST /api/auth/login — เข้าสู่ระบบ
 * -------------------------------------------------------------------------
 * ลำดับการทำงาน (สำคัญ ห้ามสลับ) :
 *   1. ตรวจ rate limit ก่อน  ← กันคนไล่เดารหัสผ่าน
 *   2. หาแอดมินจากอีเมล
 *   3. ตรวจรหัสผ่านด้วย argon2
 *   4. บันทึกผลลง login_attempts + activity_logs ทุกกรณี
 *   5. ออกตั๋ว session ใส่ httpOnly cookie
 *
 * ⚠️ ข้อความ error ต้อง "เหมือนกัน" ระหว่างกรณีไม่มีอีเมลนี้
 *    กับกรณีรหัสผ่านผิด — ไม่งั้นคนนอกจะไล่เดาได้ว่าอีเมลไหนมีอยู่จริง
 */
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { db } from '@/lib/supabase/admin';
import { serverEnv } from '@/config/env';
import { verifyPassword, hashPassword } from '@/lib/auth/password';
import { SESSION_COOKIE, signSession, sessionCookieOptions } from '@/lib/auth/session';
import { checkLoginRateLimit, recordLoginAttempt, clearFailedAttempts } from '@/lib/auth/rate-limit';
import { getClientIp, toPublicAdmin } from '@/lib/auth/current-admin';
import { logActivity, ACTIONS } from '@/lib/activity-log';
import { ok, fail, toErrorResponse } from '@/lib/api';
import type { Admin } from '@/types/db';

export const runtime = 'nodejs'; // argon2 ต้องใช้ Node ไม่ใช่ Edge

const bodySchema = z.object({
  email: z.string().email('รูปแบบอีเมลไม่ถูกต้อง'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
});

/** ข้อความเดียวกันเสมอ ไม่บอกว่าผิดที่อีเมลหรือรหัสผ่าน */
const GENERIC_FAIL = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';

/**
 * hash หลอกไว้เทียบตอน "ไม่พบอีเมลนี้"
 * เพื่อให้เวลาตอบกลับใกล้เคียงกับกรณีที่มีบัญชีจริง
 * คนภายนอกจะได้จับเวลาแล้วเดาไม่ได้ว่าอีเมลไหนมีอยู่ในระบบ
 */
let _dummyHash: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!_dummyHash) _dummyHash = hashPassword(crypto.randomUUID());
  return _dummyHash;
}

export async function POST(req: NextRequest) {
  try {
    const env = serverEnv();
    const ip = await getClientIp();
    const userAgent = req.headers.get('user-agent');
    const body = bodySchema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    // 1) rate limit ------------------------------------------------------
    const limit = await checkLoginRateLimit(email, ip);
    if (!limit.allowed) {
      await logActivity({
        adminId: null,
        action: ACTIONS.LOGIN_BLOCKED,
        detail: { email },
        ip,
      });
      return fail('rate_limited', limit.reason_th ?? 'ลองใหม่ภายหลัง', 429, {
        retry_after_seconds: limit.retryAfterSeconds,
      });
    }

    // 2) หาแอดมิน --------------------------------------------------------
    const { data: admin } = await db()
      .from('admins')
      .select('*')
      .ilike('email', email)
      .maybeSingle<Admin>();

    // 3) ตรวจรหัสผ่าน ----------------------------------------------------
    // ถ้าไม่พบบัญชี ก็ยังเสียเวลา hash เปล่า ๆ ให้พอ ๆ กัน
    // เพื่อไม่ให้คนภายนอกจับเวลาตอบกลับแล้วเดาได้ว่าอีเมลนี้มีจริงไหม
    const passwordOk = admin
      ? await verifyPassword(admin.password_hash, body.password)
      : await verifyPassword(await dummyHash(), body.password);

    if (!admin || !passwordOk) {
      await recordLoginAttempt({ email, ip, success: false, userAgent });
      await logActivity({
        adminId: admin?.id ?? null,
        action: ACTIONS.LOGIN_FAILED,
        detail: { email },
        ip,
      });
      return fail('invalid_credentials', GENERIC_FAIL, 401, {
        remaining_attempts: Math.max(0, limit.remaining - 1),
      });
    }

    if (!admin.is_active) {
      await recordLoginAttempt({ email, ip, success: false, userAgent });
      return fail('account_disabled', 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อเจ้าของร้าน', 403);
    }

    // 4) บันทึกผลสำเร็จ + ล้างประวัติที่ผิด -------------------------------
    await recordLoginAttempt({ email, ip, success: true, userAgent });
    await clearFailedAttempts(email);
    await db()
      .from('admins')
      .update({ last_login_ip: ip, last_seen_at: new Date().toISOString() })
      .eq('id', admin.id);
    await logActivity({ adminId: admin.id, action: ACTIONS.LOGIN_SUCCESS, ip, detail: { userAgent } });

    // 5) ออกตั๋ว ---------------------------------------------------------
    const token = await signSession(
      {
        sub: admin.id,
        sv: admin.session_version,
        role: admin.role,
        mcp: admin.must_change_password,
      },
      env.SESSION_SECRET,
      env.SESSION_TTL_HOURS,
    );

    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, sessionCookieOptions(env.SESSION_TTL_HOURS, env.NODE_ENV === 'production'));

    return ok({
      admin: toPublicAdmin({ ...admin, last_login_ip: ip }),
      must_change_password: admin.must_change_password,
      // หน้าเว็บใช้ตัวนี้ตัดสินว่าจะพาไปไหนต่อ
      next: admin.must_change_password ? '/change-password' : '/inbox',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
