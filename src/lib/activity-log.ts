import 'server-only';
/**
 * Activity log — ใครแก้ / ลบอะไร login จาก IP ไหน เมื่อไหร่ (สเปกหัวข้อ 5.7)
 * -------------------------------------------------------------------------
 * หลักการ : บันทึกให้ครบ แต่ห้ามทำให้งานหลักพัง
 * ถ้าเขียน log ไม่สำเร็จ ให้กลืน error แล้วปล่อยงานหลักเดินต่อ
 * (log พังไม่ควรทำให้แอดมินตอบลูกค้าไม่ได้)
 */
import { db } from '@/lib/supabase/admin';

/** ชื่อ action มาตรฐาน — เขียนเป็นค่าคงที่กันพิมพ์ไม่ตรงกันในแต่ละไฟล์ */
export const ACTIONS = {
  LOGIN_SUCCESS: 'login.success',
  LOGIN_FAILED: 'login.failed',
  LOGIN_BLOCKED: 'login.blocked',
  LOGOUT: 'logout',
  PASSWORD_CHANGED: 'password.changed',
  ADMIN_CREATED: 'admin.created',
  ADMIN_UPDATED: 'admin.updated',
  ADMIN_DISABLED: 'admin.disabled',
  ADMIN_ENABLED: 'admin.enabled',
  ADMIN_DELETED: 'admin.deleted',
  ADMIN_FORCE_LOGOUT: 'admin.force_logout',
  ADMIN_PASSWORD_RESET: 'admin.password_reset',
  PAGE_CONNECTED: 'page.connected',
  PAGE_DISCONNECTED: 'page.disconnected',
} as const;

export type ActionName = (typeof ACTIONS)[keyof typeof ACTIONS] | (string & {});

export async function logActivity(params: {
  adminId: string | null;
  action: ActionName;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  try {
    const { error } = await db().from('activity_logs').insert({
      admin_id: params.adminId,
      action: params.action,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      detail: params.detail ?? {},
      ip_address: params.ip ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    // ตั้งใจไม่โยนต่อ — ดูรายละเอียดได้จาก log ของเซิร์ฟเวอร์
    console.error('[activity-log] บันทึกไม่สำเร็จ:', err);
  }
}
