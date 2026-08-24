import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { listPagesFor } from '@/server/pages/service';
import PagesClient from './pages-client';

/**
 * หน้าจัดการเพจ — สเปกหัวข้อ 5.6 / 6.6 (เจ้าของเท่านั้น)
 * ดึงข้อมูลฝั่งเซิร์ฟเวอร์ก่อน แล้วส่งให้คอมโพเนนต์ฝั่งหน้าเว็บจัดการต่อ
 *
 * ⚠️ ข้อมูลที่ส่งไปฝั่งหน้าเว็บผ่าน listPagesFor() แล้ว จึงไม่มี access token ติดไปด้วย
 */
export const dynamic = 'force-dynamic';

export default async function PagesSettingsPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (!can(result.admin.role, 'page.manage')) redirect('/settings');

  const pages = await listPagesFor(result.admin);

  return <PagesClient initialPages={pages} />;
}
