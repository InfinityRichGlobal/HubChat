/**
 * GET /api/auth/me — ข้อมูลของคนที่ login อยู่ + สิทธิ์ที่ทำได้
 * หน้าเว็บใช้ตัวนี้ตัดสินว่าจะโชว์ปุ่มไหนบ้าง
 * (แต่การตรวจสิทธิ์จริงอยู่ที่ฝั่งเซิร์ฟเวอร์เสมอ ห้ามเชื่อฝั่งหน้าเว็บ)
 */
import { requireAdmin, touchLastSeen } from '@/lib/auth/current-admin';
import { can, ROLE_LABEL_TH } from '@/lib/auth/permissions';
import { ok, toErrorResponse } from '@/lib/api';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const admin = await requireAdmin({ allowMustChangePassword: true });
    // แตะ last_seen_at ไว้โชว์สถานะออนไลน์ในหน้าจัดการแอดมิน
    await touchLastSeen(admin.id);

    return ok({
      admin,
      role_label_th: ROLE_LABEL_TH[admin.role],
      permissions: {
        chat_reply: can(admin.role, 'chat.reply'),
        order_create: can(admin.role, 'order.create'),
        order_delete: can(admin.role, 'order.delete'),
        content_view: can(admin.role, 'content.view'),
        content_manage: can(admin.role, 'content.manage'),
        page_manage: can(admin.role, 'page.manage'),
        admin_manage: can(admin.role, 'admin.manage'),
        dashboard_view_all: can(admin.role, 'dashboard.view.all'),
        activity_view: can(admin.role, 'activity.view'),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
