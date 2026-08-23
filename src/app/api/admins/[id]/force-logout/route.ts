/**
 * POST /api/admins/[id]/force-logout — "เตะออกทุกอุปกรณ์ทันที"
 * -------------------------------------------------------------------------
 * กรณีใช้จริง : มือถือแอดมินหาย / คนลาออก / สงสัยว่ารหัสหลุด
 *
 * วิธี : บวก session_version 1
 *   ตั๋วทุกใบที่ออกไปแล้วถือ sv เดิม → requireAdmin() เทียบแล้วไม่ตรง → เด้งออกทันที
 *   ไม่ต้องไล่ลบ session ทีละเครื่อง และไม่ต้องรอตั๋วหมดอายุ
 */
import { NextRequest } from 'next/server';
import { db } from '@/lib/supabase/admin';
import { requirePermission, getClientIp } from '@/lib/auth/current-admin';
import { logActivity, ACTIONS } from '@/lib/activity-log';
import { ok, fail, toErrorResponse } from '@/lib/api';
import type { Admin } from '@/types/db';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const me = await requirePermission('admin.manage');
    const { id } = await ctx.params;

    const { data: target } = await db()
      .from('admins')
      .select('id,name,email,session_version')
      .eq('id', id)
      .maybeSingle<Pick<Admin, 'id' | 'name' | 'email' | 'session_version'>>();
    if (!target) return fail('not_found', 'ไม่พบแอดมินคนนี้', 404);

    const { error } = await db()
      .from('admins')
      .update({ session_version: target.session_version + 1 })
      .eq('id', id);
    if (error) throw error;

    await logActivity({
      adminId: me.id,
      action: ACTIONS.ADMIN_FORCE_LOGOUT,
      targetType: 'admin',
      targetId: id,
      detail: { email: target.email },
      ip: await getClientIp(),
    });

    return ok({
      message_th: `เตะ ${target.name} ออกจากทุกอุปกรณ์แล้ว ต้องเข้าสู่ระบบใหม่`,
      session_version: target.session_version + 1,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
