import 'server-only';
/**
 * หา "แอดมินที่กำลังใช้งานอยู่" จาก cookie แล้วตรวจกับฐานข้อมูลอีกชั้น
 * -------------------------------------------------------------------------
 * นี่คือด่านจริง ไม่ใช่ middleware
 * middleware แค่ตรวจลายเซ็นตั๋วเพื่อ redirect ให้ไว
 * แต่ทุก API ที่แตะข้อมูลจริงต้องผ่าน requireAdmin() ตัวนี้เท่านั้น
 *
 * ตรวจ 3 อย่างกับฐานข้อมูล :
 *   1. บัญชียังมีอยู่ไหม
 *   2. is_active ยังเป็น true ไหม (เจ้าของอาจปิดใช้งานชั่วคราว)
 *   3. session_version ตรงกับในตั๋วไหม (ไม่ตรง = โดนเตะออกทุกเครื่องแล้ว)
 */
import { cookies, headers } from 'next/headers';
import { db } from '@/lib/supabase/admin';
import { serverEnv } from '@/config/env';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { can, canManageRuntimeSettings, type Permission } from '@/lib/auth/permissions';
import type { Admin, PublicAdmin } from '@/types/db';

/** เหตุผลที่เข้าไม่ได้ — ใช้ตัดสินใจว่าจะพาไปหน้าไหน */
export type AuthFailure =
  | 'no_session'          // ไม่มีตั๋ว / ตั๋วหมดอายุ
  | 'session_revoked'     // โดนเตะออกทุกเครื่อง
  | 'account_disabled'    // ถูกปิดใช้งาน
  | 'must_change_password'; // ต้องเปลี่ยนรหัสก่อน

export type AuthResult =
  | { ok: true; admin: PublicAdmin }
  | { ok: false; reason: AuthFailure; message_th: string };

const MESSAGES: Record<AuthFailure, string> = {
  no_session: 'กรุณาเข้าสู่ระบบ',
  session_revoked: 'บัญชีนี้ถูกออกจากระบบทุกอุปกรณ์ กรุณาเข้าสู่ระบบใหม่',
  account_disabled: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อเจ้าของร้าน',
  must_change_password: 'กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งาน',
};

/** ตัดฟิลด์ลับออกก่อนส่งให้ฝั่งหน้าเว็บ — password_hash ห้ามหลุดเด็ดขาด */
export function toPublicAdmin(row: Admin): PublicAdmin {
  const { password_hash: _ignored, ...rest } = row;
  void _ignored;
  return rest;
}

/**
 * อ่าน session แล้วคืนแอดมิน — ไม่โยน error
 * ใช้ในหน้าที่ "มีก็ดี ไม่มีก็ได้" เช่นหน้า login (ถ้ามีอยู่แล้วให้เด้งเข้าระบบ)
 */
export async function getCurrentAdmin(options?: { allowMustChangePassword?: boolean }): Promise<AuthResult> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return fail('no_session');

  const payload = await verifySession(token, serverEnv().SESSION_SECRET);
  if (!payload) return fail('no_session');

  const { data, error } = await db()
    .from('admins')
    .select('*')
    .eq('id', payload.sub)
    .maybeSingle<Admin>();

  if (error || !data) return fail('no_session');
  if (!data.is_active) return fail('account_disabled');

  // ⭐ หัวใจของ "เตะออกทุกอุปกรณ์ทันที" — เจ้าของบวก session_version ใน DB
  //    ตั๋วเก่าทุกใบที่ถือ sv เดิมจะใช้ไม่ได้ทันทีในคำขอถัดไป
  if (data.session_version !== payload.sv) return fail('session_revoked');

  if (data.must_change_password && !options?.allowMustChangePassword) {
    return fail('must_change_password');
  }

  return { ok: true, admin: toPublicAdmin(data) };
}

function fail(reason: AuthFailure): AuthResult {
  return { ok: false, reason, message_th: MESSAGES[reason] };
}

/**
 * ใช้ใน API route — ไม่ผ่านให้โยนออกไปเลย
 * caller จับด้วย toErrorResponse() ใน src/lib/api.ts
 */
export class AuthError extends Error {
  constructor(
    public reason: AuthFailure | 'forbidden',
    public message_th: string,
    public status: number,
  ) {
    super(message_th);
  }
}

/** ต้อง login แล้วเท่านั้น */
export async function requireAdmin(options?: { allowMustChangePassword?: boolean }): Promise<PublicAdmin> {
  const result = await getCurrentAdmin(options);
  if (!result.ok) {
    const status = result.reason === 'account_disabled' ? 403 : 401;
    throw new AuthError(result.reason, result.message_th, status);
  }
  return result.admin;
}

/** ต้อง login + ต้องมีสิทธิ์ตามตารางหัวข้อ 5.7 */
export async function requirePermission(permission: Permission): Promise<PublicAdmin> {
  const admin = await requireAdmin();
  if (!can(admin.role, permission)) {
    throw new AuthError('forbidden', 'บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้', 403);
  }
  return admin;
}

/** งานตั้งค่าระบบ/ความลับต้องเป็นเจ้าของร้านเท่านั้น — ไม่ผูกกับสิทธิ์ที่อาจขยายในอนาคต */
export async function requireOwner(): Promise<PublicAdmin> {
  const admin = await requireAdmin();
  if (!canManageRuntimeSettings(admin.role)) {
    throw new AuthError('forbidden', 'เฉพาะเจ้าของร้านเท่านั้นที่ตั้งค่าระบบได้', 403);
  }
  return admin;
}

/** ดึง IP จริงของผู้ใช้ (ผ่าน proxy ของ Railway/Render จึงต้องอ่านจาก header) */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return h.get('x-real-ip') ?? h.get('cf-connecting-ip');
}

/** อัปเดต last_seen_at ไว้โชว์ "สถานะออนไลน์" ในหน้าจัดการแอดมิน (หัวข้อ 5.7) */
export async function touchLastSeen(adminId: string): Promise<void> {
  await db().from('admins').update({ last_seen_at: new Date().toISOString() }).eq('id', adminId);
}
