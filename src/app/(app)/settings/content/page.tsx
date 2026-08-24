import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { listCanned, listTags } from '@/server/content/service';
import ContentClient from './content-client';

/**
 * ชุดคำตอบ + แท็ก — สเปกหัวข้อ 5.6
 * เจ้าของแก้ได้ / แอดมินทั่วไปดูได้อย่างเดียว (ตารางสิทธิ์ 5.7)
 */
export const dynamic = 'force-dynamic';

export default async function ContentSettingsPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (!can(result.admin.role, 'content.view')) redirect('/settings');

  const [canned, tags] = await Promise.all([listCanned(), listTags()]);

  return (
    <ContentClient
      canManage={can(result.admin.role, 'content.manage')}
      initialCanned={canned}
      initialTags={tags}
    />
  );
}
