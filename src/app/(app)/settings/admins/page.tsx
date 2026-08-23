import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/supabase/admin';
import AdminsClient, { type AdminRow, type PageOption } from './admins-client';

/**
 * หน้าจัดการแอดมิน — สเปกหัวข้อ 5.7 (เจ้าของเท่านั้น)
 * ดึงข้อมูลฝั่งเซิร์ฟเวอร์ก่อน แล้วส่งให้คอมโพเนนต์ฝั่งหน้าเว็บจัดการต่อ
 */
export const dynamic = 'force-dynamic';

export default async function AdminsPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (!can(result.admin.role, 'admin.manage')) {
    // ไม่ใช่เจ้าของ — ไม่ควรมาถึงหน้านี้อยู่แล้ว แต่กันไว้อีกชั้น
    redirect('/settings');
  }

  const [{ data: admins }, { data: pages }] = await Promise.all([
    db()
      .from('admins')
      .select('id,name,email,role,allowed_page_ids,must_change_password,is_active,last_seen_at,last_login_ip,created_at')
      .order('created_at', { ascending: true }),
    db().from('pages').select('id,display_name,page_name,platform,tag_color').order('created_at'),
  ]);

  return (
    <AdminsClient
      meId={result.admin.id}
      initialAdmins={(admins ?? []) as AdminRow[]}
      pages={(pages ?? []) as PageOption[]}
    />
  );
}
