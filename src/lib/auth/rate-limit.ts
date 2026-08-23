import 'server-only';
/**
 * จำกัดจำนวนครั้งที่ลอง login (เช็คลิสต์ความปลอดภัยข้อ 3)
 * -------------------------------------------------------------------------
 * กติกา : ผิดเกิน LOGIN_MAX_ATTEMPTS ครั้ง (ค่าเริ่มต้น 5) ภายใน
 *         LOGIN_LOCK_MINUTES นาที (ค่าเริ่มต้น 15) → ล็อกไว้จนครบเวลา
 *
 * นับ 2 แกนคู่กัน :
 *   • ต่ออีเมล — กันคนไล่เดารหัสของบัญชีใดบัญชีหนึ่ง
 *   • ต่อ IP   — กันสคริปต์ยิงรัว ๆ หลายบัญชีจากเครื่องเดียว
 *
 * เก็บในตาราง Postgres ไม่ใช้ Redis ตามหลักคิดข้อ 3 ของสเปก
 * (แอดมิน 3-5 คน จำนวน request น้อยมาก ตารางเอาอยู่สบาย)
 */
import { db } from '@/lib/supabase/admin';
import { serverEnv } from '@/config/env';

export type RateLimitResult = {
  allowed: boolean;
  /** เหลืออีกกี่ครั้งถึงจะโดนล็อก */
  remaining: number;
  /** ถ้าโดนล็อก — ปลดล็อกเมื่อไหร่ */
  retryAfterSeconds?: number;
  reason_th?: string;
};

/** ตรวจก่อนยอมให้ลอง login */
export async function checkLoginRateLimit(email: string, ip: string | null): Promise<RateLimitResult> {
  const env = serverEnv();
  const windowStart = new Date(Date.now() - env.LOGIN_LOCK_MINUTES * 60_000).toISOString();
  const supabase = db();

  // นับครั้งที่ "ผิด" ในช่วงเวลาที่กำหนด แยกตามอีเมล
  const byEmail = await supabase
    .from('login_attempts')
    .select('created_at', { count: 'exact' })
    .eq('email', email.toLowerCase())
    .eq('success', false)
    .gte('created_at', windowStart)
    .order('created_at', { ascending: false })
    .limit(env.LOGIN_MAX_ATTEMPTS);

  const emailFails = byEmail.count ?? 0;

  if (emailFails >= env.LOGIN_MAX_ATTEMPTS) {
    const oldest = byEmail.data?.[byEmail.data.length - 1]?.created_at as string | undefined;
    const unlockAt = oldest
      ? new Date(new Date(oldest).getTime() + env.LOGIN_LOCK_MINUTES * 60_000)
      : new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000);
    const retryAfterSeconds = Math.max(1, Math.ceil((unlockAt.getTime() - Date.now()) / 1000));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      reason_th: `ใส่รหัสผ่านผิดหลายครั้งเกินไป กรุณารออีก ${Math.ceil(retryAfterSeconds / 60)} นาทีแล้วลองใหม่`,
    };
  }

  // นับตาม IP ด้วย เผื่อมีคนไล่เดาหลายบัญชีจากเครื่องเดียว (ให้โควตามากกว่าหน่อย)
  if (ip) {
    const ipLimit = env.LOGIN_MAX_ATTEMPTS * 4;
    const byIp = await supabase
      .from('login_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .eq('success', false)
      .gte('created_at', windowStart);
    if ((byIp.count ?? 0) >= ipLimit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: env.LOGIN_LOCK_MINUTES * 60,
        reason_th: `มีการลองเข้าสู่ระบบผิดหลายครั้งจากเครือข่ายนี้ กรุณารอ ${env.LOGIN_LOCK_MINUTES} นาที`,
      };
    }
  }

  return { allowed: true, remaining: env.LOGIN_MAX_ATTEMPTS - emailFails };
}

/** บันทึกผลการลอง login ทุกครั้ง ทั้งสำเร็จและไม่สำเร็จ */
export async function recordLoginAttempt(params: {
  email: string;
  ip: string | null;
  success: boolean;
  userAgent?: string | null;
}): Promise<void> {
  await db().from('login_attempts').insert({
    email: params.email.toLowerCase(),
    ip_address: params.ip,
    success: params.success,
    user_agent: params.userAgent ?? null,
  });
}

/** login สำเร็จแล้วล้างประวัติที่ผิดของอีเมลนี้ทิ้ง เพื่อไม่ให้ค้างล็อก */
export async function clearFailedAttempts(email: string): Promise<void> {
  await db().from('login_attempts').delete().eq('email', email.toLowerCase()).eq('success', false);
}
