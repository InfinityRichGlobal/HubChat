/**
 * ยิงแจ้งเตือนทดสอบมาที่ตัวเอง (รอบ 10)
 * ===========================================================================
 * ⭐ ทำไมต้องมี : แจ้งเตือนเป็นของที่ "ไม่รู้ว่าพังจนถึงวันที่ต้องใช้"
 *    ปุ่มนี้ทำให้รู้ทันทีว่าเครื่องนี้รับได้จริงไหม โดยไม่ต้องรอลูกค้าทัก
 *
 * ⚠️ ยิงเข้าเครื่องของตัวเองเท่านั้น ไม่มีทางยิงใส่คนอื่น
 * ⚠️ ไม่ผ่านคิว notification_jobs โดยตั้งใจ — ทดสอบต้องได้ทุกครั้งที่กด
 *    ถ้าผ่านคิว กุญแจกันซ้ำจะทำให้กดครั้งที่สองแล้วเงียบ แล้วคนจะคิดว่าพัง
 */
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { isPushConfigured, sendPushToAdmin } from '@/server/notify/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const admin = await requireAdmin();

    if (!isPushConfigured()) {
      return fail(
        'push_not_configured',
        'ยังไม่ได้ตั้งค่ากุญแจแจ้งเตือนบนเซิร์ฟเวอร์ (VAPID) — ดูวิธีที่ docs/NOTIFICATIONS.md',
        503,
      );
    }

    const result = await sendPushToAdmin(admin.id, {
      title: '🔔 ทดสอบแจ้งเตือน HubChat',
      body: 'ถ้าเห็นข้อความนี้ แปลว่าเครื่องนี้พร้อมรับแจ้งเตือนแล้ว',
      link: '/settings/notifications',
      tag: 'hubchat-test',
    });

    if (result.sent === 0) {
      return fail(
        'no_device',
        result.disabled > 0
          ? 'เครื่องที่เคยลงทะเบียนไว้ถูกปลดออกแล้ว — กด "เปิดแจ้งเตือนบนเครื่องนี้" อีกครั้ง'
          : 'ยังไม่มีเครื่องไหนเปิดแจ้งเตือนไว้ — กด "เปิดแจ้งเตือนบนเครื่องนี้" ก่อน',
        400,
        { detail: result },
      );
    }

    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
