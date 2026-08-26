import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { getPrefs } from '@/server/notify/prefs';
import { isPushConfigured } from '@/server/notify/push';
import { isTelegramConfigured } from '@/server/notify/telegram';
import NotificationsClient from './notifications-client';

/**
 * ตั้งค่าแจ้งเตือน — สเปกหัวข้อ 6.7
 *
 * ⭐ ทุกคนที่ตอบแชทได้เข้าหน้านี้ได้ เพราะเป็นค่าตั้งส่วนตัวของแต่ละคน
 *    ส่วนของ Telegram (ทดสอบ/ค้นหากลุ่ม) เห็นเฉพาะเจ้าของร้าน
 *
 * 🔴 หน้านี้ไม่แสดงค่า token หรือกุญแจลับใด ๆ
 *    บอกได้แค่ "ตั้งแล้ว/ยังไม่ได้ตั้ง" เท่านั้น
 */
export const dynamic = 'force-dynamic';

export default async function NotificationSettingsPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');

  return (
    <NotificationsClient
      initial={await getPrefs(result.admin)}
      pushConfigured={await isPushConfigured()}
      telegramConfigured={await isTelegramConfigured()}
      isOwner={can(result.admin.role, 'page.manage')}
      canReply={can(result.admin.role, 'chat.reply')}
    />
  );
}
