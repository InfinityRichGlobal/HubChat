import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { loadDashboard } from '@/server/dashboard/service';
import DashboardClient from './dashboard-client';

/**
 * สรุปยอด — สเปกหัวข้อ 5.4
 * ดึงชุดแรกฝั่งเซิร์ฟเวอร์ เพื่อให้เปิดหน้ามาเห็นตัวเลขทันที
 */
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');

  const admin = result.admin;
  if (!can(admin.role, 'dashboard.view.all') && !can(admin.role, 'dashboard.view.self')) {
    redirect('/inbox');
  }

  return <DashboardClient initial={await loadDashboard(admin, '7d')} />;
}
