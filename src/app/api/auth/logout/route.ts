/**
 * POST /api/auth/logout — ออกจากระบบเครื่องนี้
 * (ถ้าต้องการเตะออก "ทุกเครื่อง" ใช้ /api/admins/[id]/force-logout แทน)
 */
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { getCurrentAdmin, getClientIp } from '@/lib/auth/current-admin';
import { logActivity, ACTIONS } from '@/lib/activity-log';
import { ok, toErrorResponse } from '@/lib/api';

export const runtime = 'nodejs';

export async function POST() {
  try {
    // อนุญาตให้ออกจากระบบได้แม้ยังไม่ได้เปลี่ยนรหัสผ่านครั้งแรก
    const result = await getCurrentAdmin({ allowMustChangePassword: true });
    if (result.ok) {
      await logActivity({ adminId: result.admin.id, action: ACTIONS.LOGOUT, ip: await getClientIp() });
    }
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    return ok({ message_th: 'ออกจากระบบแล้ว' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
