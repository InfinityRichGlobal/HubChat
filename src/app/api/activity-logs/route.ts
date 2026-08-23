/**
 * GET /api/activity-logs — ประวัติการกระทำ (เจ้าของเท่านั้น)
 * ใครแก้/ลบอะไร login จาก IP ไหน เมื่อไหร่ — สเปกหัวข้อ 5.7
 */
import { NextRequest } from 'next/server';
import { db } from '@/lib/supabase/admin';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requirePermission('activity.view');

    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
    const adminId = url.searchParams.get('admin_id');
    const action = url.searchParams.get('action');

    let q = db()
      .from('activity_logs')
      .select('id,admin_id,action,target_type,target_id,detail,ip_address,created_at,admins(name,email)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (adminId) q = q.eq('admin_id', adminId);
    if (action) q = q.eq('action', action);

    const { data, error } = await q;
    if (error) throw error;

    return ok({ logs: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
