/**
 * /api/admins — รายชื่อแอดมิน + เพิ่มแอดมินใหม่ (เจ้าของเท่านั้น)
 * สเปกหัวข้อ 5.7
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase/admin';
import { hashPassword, validatePasswordStrength, generateTempPassword } from '@/lib/auth/password';
import { requirePermission, getClientIp } from '@/lib/auth/current-admin';
import { logActivity, ACTIONS } from '@/lib/activity-log';
import { ok, fail, toErrorResponse } from '@/lib/api';
import type { Admin } from '@/types/db';

export const runtime = 'nodejs';

/** ถือว่า "ออนไลน์" ถ้ามีการใช้งานภายใน 3 นาทีที่ผ่านมา */
const ONLINE_WINDOW_MS = 3 * 60 * 1000;

/** GET — รายชื่อแอดมินพร้อมสถานะออนไลน์ */
export async function GET() {
  try {
    await requirePermission('admin.manage');

    const { data, error } = await db()
      .from('admins')
      .select(
        'id,name,email,role,allowed_page_ids,must_change_password,is_active,last_seen_at,last_login_ip,session_version,created_by,created_at,updated_at',
      )
      .order('created_at', { ascending: true });
    if (error) throw error;

    const now = Date.now();
    const admins = (data ?? []).map((a) => ({
      ...a,
      // สถานะออนไลน์ — ใครกำลังทำงานอยู่ (สเปก 5.7)
      is_online:
        !!a.last_seen_at && now - new Date(a.last_seen_at as string).getTime() < ONLINE_WINDOW_MS,
    }));

    return ok({ admins });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100),
  email: z.string().email('รูปแบบอีเมลไม่ถูกต้อง'),
  role: z.enum(['owner', 'admin', 'viewer']).default('admin'),
  allowed_page_ids: z.array(z.string().uuid()).default([]),
  // ไม่ส่งมา = ระบบสุ่มรหัสชั่วคราวให้
  temp_password: z.string().optional(),
});

/** POST — เพิ่มแอดมิน (บังคับเปลี่ยนรหัสตอน login แรกเสมอ) */
export async function POST(req: NextRequest) {
  try {
    const me = await requirePermission('admin.manage');
    const body = createSchema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    // อีเมลซ้ำไม่ได้
    const { data: existing } = await db().from('admins').select('id').ilike('email', email).maybeSingle();
    if (existing) return fail('duplicate_email', 'อีเมลนี้มีในระบบแล้ว', 409);

    const tempPassword = body.temp_password?.trim() || generateTempPassword();
    const strength = validatePasswordStrength(tempPassword);
    if (!strength.ok) return fail('weak_password', strength.reason_th!, 422);

    const { data: created, error } = await db()
      .from('admins')
      .insert({
        name: body.name,
        email,
        password_hash: await hashPassword(tempPassword),
        role: body.role,
        allowed_page_ids: body.allowed_page_ids,
        must_change_password: true, // ← บังคับเปลี่ยนรหัสตอน login ครั้งแรก
        is_active: true,
        created_by: me.id,
      })
      .select('id,name,email,role,allowed_page_ids,is_active,created_at')
      .single<Pick<Admin, 'id' | 'name' | 'email' | 'role' | 'allowed_page_ids' | 'is_active' | 'created_at'>>();
    if (error) throw error;

    await logActivity({
      adminId: me.id,
      action: ACTIONS.ADMIN_CREATED,
      targetType: 'admin',
      targetId: created.id,
      detail: { email, role: body.role },
      ip: await getClientIp(),
    });

    return ok(
      {
        admin: created,
        // ⚠️ รหัสชั่วคราวโชว์ครั้งเดียวตรงนี้เท่านั้น ในฐานข้อมูลเก็บแค่ hash
        temp_password: tempPassword,
        message_th: 'สร้างแอดมินแล้ว — คัดลอกรหัสผ่านชั่วคราวส่งให้เจ้าตัว รหัสนี้จะไม่แสดงอีก',
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
