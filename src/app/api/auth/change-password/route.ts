/**
 * POST /api/auth/change-password — เปลี่ยนรหัสผ่านของตัวเอง
 * -------------------------------------------------------------------------
 * ใช้ 2 กรณี :
 *   • login ครั้งแรกด้วยรหัสชั่วคราว → บังคับเปลี่ยน (must_change_password)
 *   • เปลี่ยนเองเมื่อไหร่ก็ได้
 *
 * เปลี่ยนรหัสสำเร็จ = บวก session_version → ตั๋วเก่าทุกใบใช้ไม่ได้
 * แล้วออกตั๋วใหม่ให้เครื่องนี้เครื่องเดียว
 * (ถ้ารหัสหลุด คนที่ขโมยไปจะหลุดจากระบบทันที)
 */
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { db } from '@/lib/supabase/admin';
import { serverEnv } from '@/config/env';
import { hashPassword, verifyPassword, validatePasswordStrength } from '@/lib/auth/password';
import { SESSION_COOKIE, signSession, sessionCookieOptions } from '@/lib/auth/session';
import { requireAdmin, getClientIp } from '@/lib/auth/current-admin';
import { logActivity, ACTIONS } from '@/lib/activity-log';
import { ok, fail, toErrorResponse } from '@/lib/api';
import type { Admin } from '@/types/db';

export const runtime = 'nodejs';

const bodySchema = z.object({
  current_password: z.string().min(1, 'กรุณากรอกรหัสผ่านปัจจุบัน'),
  new_password: z.string().min(1, 'กรุณากรอกรหัสผ่านใหม่'),
});

export async function POST(req: NextRequest) {
  try {
    const env = serverEnv();
    const me = await requireAdmin({ allowMustChangePassword: true });
    const body = bodySchema.parse(await req.json());

    // ต้องรู้รหัสเดิมก่อนถึงจะเปลี่ยนได้ (กันคนแอบใช้เครื่องที่เปิดค้างไว้)
    const { data: row } = await db().from('admins').select('*').eq('id', me.id).maybeSingle<Admin>();
    if (!row) return fail('not_found', 'ไม่พบบัญชีนี้', 404);

    if (!(await verifyPassword(row.password_hash, body.current_password))) {
      return fail('invalid_credentials', 'รหัสผ่านปัจจุบันไม่ถูกต้อง', 401);
    }

    const strength = validatePasswordStrength(body.new_password);
    if (!strength.ok) return fail('weak_password', strength.reason_th!, 422);

    if (await verifyPassword(row.password_hash, body.new_password)) {
      return fail('same_password', 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม', 422);
    }

    const nextVersion = row.session_version + 1;
    await db()
      .from('admins')
      .update({
        password_hash: await hashPassword(body.new_password),
        must_change_password: false,
        session_version: nextVersion, // ← ตั๋วเก่าทุกใบตายทันที
      })
      .eq('id', me.id);

    await logActivity({
      adminId: me.id,
      action: ACTIONS.PASSWORD_CHANGED,
      targetType: 'admin',
      targetId: me.id,
      ip: await getClientIp(),
    });

    // ออกตั๋วใหม่ให้เครื่องนี้ ไม่งั้นคนที่เพิ่งเปลี่ยนรหัสจะหลุดออกเองด้วย
    const token = await signSession(
      { sub: me.id, sv: nextVersion, role: row.role, mcp: false },
      env.SESSION_SECRET,
      env.SESSION_TTL_HOURS,
    );
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, sessionCookieOptions(env.SESSION_TTL_HOURS, env.NODE_ENV === 'production'));

    return ok({ message_th: 'เปลี่ยนรหัสผ่านเรียบร้อย', next: '/inbox' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
