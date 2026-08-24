import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { listRules, listAutoReplyLogs } from '@/server/autoreply/service';
import { db } from '@/lib/supabase/admin';
import AutoReplyClient from './autoreply-client';

/**
 * หน้ากฎตอบอัตโนมัติ — สเปกหัวข้อ 5.5
 * 🔴 หน้านี้คุมสิ่งที่ทำให้ระบบพิมพ์หาลูกค้าเอง จึงแสดงประวัติการทำงานจริงไว้ด้วย
 *    เจ้าของร้านต้องเห็นได้ตลอดว่าบอทตอบอะไรไปบ้าง
 */
export const dynamic = 'force-dynamic';

export default async function AutoReplyPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (!can(result.admin.role, 'content.view')) redirect('/inbox');

  const [rules, logs, { data: pages }] = await Promise.all([
    listRules(),
    listAutoReplyLogs(30),
    db().from('pages').select('id,display_name,page_name,tag_color').order('created_at'),
  ]);

  return (
    <AutoReplyClient
      canManage={can(result.admin.role, 'content.manage')}
      initialRules={rules}
      initialLogs={logs}
      pages={
        (pages ?? []) as Array<{
          id: string;
          display_name: string | null;
          page_name: string;
          tag_color: string;
        }>
      }
    />
  );
}
