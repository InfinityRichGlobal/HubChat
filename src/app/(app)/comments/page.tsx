import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { getFilterWords, listComments, type CommentRow } from '@/server/comments/service';
import { listPagesFor, type SafePage } from '@/server/pages/service';
import CommentsClient from './comments-client';

/** ฟีดคอมเมนต์ — สเปกหัวข้อ 5.5 */
export const dynamic = 'force-dynamic';

export default async function CommentsPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (!can(result.admin.role, 'chat.reply')) redirect('/inbox');

  let feed: { comments: CommentRow[]; has_more: boolean; unhandled_count: number } = {
    comments: [],
    has_more: false,
    unhandled_count: 0,
  };
  let words: string[] = [];
  let pages: SafePage[] = [];

  try {
    const [f, w, p] = await Promise.all([
      listComments(result.admin, {}),
      getFilterWords(),
      listPagesFor(result.admin),
    ]);
    feed = f;
    words = w;
    pages = p;
  } catch (err) {
    console.error('[CommentsPage] โหลดข้อมูลคอมเมนต์เริ่มต้นไม่สำเร็จ:', err);
    try {
      pages = await listPagesFor(result.admin);
    } catch {}
  }

  return (
    <CommentsClient
      initial={feed}
      initialWords={words}
      pages={pages}
      canManageWords={can(result.admin.role, 'content.manage')}
    />
  );
}
