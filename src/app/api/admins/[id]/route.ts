/**
 * /api/admins/[id] — แก้ไข / ลบแอดมินรายคน (เจ้าของเท่านั้น)
 *
 * ตัวกันพลาดที่ต้องมี :
 *   • ห้ามปิดใช้งาน / ลด role / ลบ "เจ้าของคนสุดท้าย" ไม่งั้นจะไม่มีใครเข้าระบบได้อีก
 *   • ห้ามลบหรือปิดตัวเอง (กันเผลอกดจนล็อกตัวเองออก)
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase/admin';
import { requirePermission, getClientIp } from '@/lib/auth/current-admin';
import { hashPassword, validatePasswordStrength, generateTempPassword } from '@/lib/auth/password';
import { logActivity, ACTIONS } from '@/lib/activity-log';
import { ok, fail, toErrorResponse } from '@/lib/api';
import type { Admin } from '@/types/db';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(['owner', 'admin', 'viewer']).optional(),
  allowed_page_ids: z.array(z.string().uuid()).optional(),
  is_active: z.boolean().optional(),
  /** true = ตั้งรหัสชั่วคราวใหม่ + บังคับเปลี่ยนตอน login ถัดไป */
  reset_password: z.boolean().optional(),
});

/** นับว่ายังเหลือเจ้าของที่ใช้งานอยู่กี่คน */
async function countActiveOwners(excludeId?: string): Promise<number> {
  let q = db().from('admins').select('id', { count: 'exact', head: true }).eq('role', 'owner').eq('is_active', true);
  if (excludeId) q = q.neq('id', excludeId);
  const { count } = await q;
  return count ?? 0;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const me = await requirePermission('admin.manage');
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());

    const { data: target } = await db().from('admins').select('*').eq('id', id).maybeSingle<Admin>();
    if (!target) return fail('not_found', 'ไม่พบแอดมินคนนี้', 404);

    // กันไม่ให้เหลือระบบที่ไม่มีเจ้าของ
    const losingOwner =
      target.role === 'owner' &&
      ((body.role && body.role !== 'owner') || body.is_active === false);
    if (losingOwner && (await countActiveOwners(target.id)) === 0) {
      return fail('last_owner', 'ต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คนเสมอ', 409);
    }
    if (body.is_active === false && target.id === me.id) {
      return fail('self_disable', 'ปิดใช้งานบัญชีตัวเองไม่ได้', 409);
    }

    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.role !== undefined) update.role = body.role;
    if (body.allowed_page_ids !== undefined) update.allowed_page_ids = body.allowed_page_ids;
    if (body.is_active !== undefined) update.is_active = body.is_active;

    // เปลี่ยนสิทธิ์หรือปิดใช้งาน = ต้องเตะออกทุกเครื่องด้วย
    // ไม่งั้นเครื่องที่เปิดค้างไว้จะยังใช้สิทธิ์เดิมได้จนกว่าตั๋วจะหมดอายุ
    if (body.role !== undefined || body.is_active === false || body.allowed_page_ids !== undefined) {
      update.session_version = target.session_version + 1;
    }

    let tempPassword: string | null = null;
    if (body.reset_password) {
      tempPassword = generateTempPassword();
      const strength = validatePasswordStrength(tempPassword);
      if (!strength.ok) return fail('weak_password', strength.reason_th!, 422);
      update.password_hash = await hashPassword(tempPassword);
      update.must_change_password = true;
      update.session_version = target.session_version + 1;
    }

    if (Object.keys(update).length === 0) {
      return fail('nothing_to_update', 'ไม่มีข้อมูลที่ต้องแก้ไข', 400);
    }

    const { data: updated, error } = await db()
      .from('admins')
      .update(update)
      .eq('id', id)
      .select('id,name,email,role,allowed_page_ids,must_change_password,is_active,last_seen_at,session_version,created_at,updated_at')
      .single();
    if (error) throw error;

    const ip = await getClientIp();
    await logActivity({
      adminId: me.id,
      action: body.reset_password ? ACTIONS.ADMIN_PASSWORD_RESET : ACTIONS.ADMIN_UPDATED,
      targetType: 'admin',
      targetId: id,
      detail: { changed: Object.keys(update) },
      ip,
    });
    if (body.is_active === false) {
      await logActivity({ adminId: me.id, action: ACTIONS.ADMIN_DISABLED, targetType: 'admin', targetId: id, ip });
    }
    if (body.is_active === true) {
      await logActivity({ adminId: me.id, action: ACTIONS.ADMIN_ENABLED, targetType: 'admin', targetId: id, ip });
    }

    return ok({
      admin: updated,
      temp_password: tempPassword,
      message_th: tempPassword
        ? 'ตั้งรหัสผ่านชั่วคราวใหม่แล้ว — คัดลอกส่งให้เจ้าตัว รหัสนี้จะไม่แสดงอีก'
        : 'บันทึกแล้ว',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const me = await requirePermission('admin.manage');
    const { id } = await ctx.params;

    if (id === me.id) return fail('self_delete', 'ลบบัญชีตัวเองไม่ได้', 409);

    const { data: target } = await db().from('admins').select('*').eq('id', id).maybeSingle<Admin>();
    if (!target) return fail('not_found', 'ไม่พบแอดมินคนนี้', 404);

    if (target.role === 'owner' && (await countActiveOwners(target.id)) === 0) {
      return fail('last_owner', 'ต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คนเสมอ', 409);
    }

    const { error } = await db().from('admins').delete().eq('id', id);
    if (error) throw error;

    await logActivity({
      adminId: me.id,
      action: ACTIONS.ADMIN_DELETED,
      targetType: 'admin',
      targetId: id,
      detail: { email: target.email, name: target.name },
      ip: await getClientIp(),
    });

    return ok({ message_th: 'ลบแอดมินแล้ว' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
