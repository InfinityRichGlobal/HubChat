import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { getFilterWords, listComments } from '@/server/comments/service';
import CommentsClient from './comments-client';

/** ฟีดคอมเมนต์ — สเปกหัวข้อ 5.5 */
export const dynamic = 'force-dynamic';

export default async function CommentsPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (!can(result.admin.role, 'chat.reply')) redirect('/inbox');

  const [feed, words] = await Promise.all([
    listComments(result.admin, {}),
    getFilterWords(),
  ]);

  return (
    <CommentsClient
      initial={feed}
      initialWords={words}
      canManageWords={can(result.admin.role, 'content.manage')}
    />
  );
}
