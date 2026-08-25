import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { listConversations } from '@/server/inbox/service';
import InboxClient from './inbox-client';

/**
 * อินบ็อกซ์ — สเปกหัวข้อ 5.1
 * ดึงข้อมูลชุดแรกฝั่งเซิร์ฟเวอร์ เพื่อให้เปิดหน้ามาแล้วเห็นแชททันที
 * จากนั้นฝั่งหน้าเว็บจะดึงซ้ำเป็นระยะเอง
 */
export const dynamic = 'force-dynamic';

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');

  const [{ conversations, pages, has_more }, sp] = await Promise.all([
    listConversations(result.admin),
    searchParams,
  ]);

  return (
    <InboxClient
      me={{ id: result.admin.id, name: result.admin.name }}
      canReply={can(result.admin.role, 'chat.reply')}
      initialConversations={conversations}
      initialHasMore={has_more}
      initialConversationId={sp.c ?? null}
      pages={pages}
    />
  );
}
