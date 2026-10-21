import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { listComments, type CommentFeed } from '@/server/comments/service';
import { listPagesFor, type SafePage } from '@/server/pages/service';
import CommentsClient from './comments-client';

/** ฟีดคอมเมนต์ — สเปกหัวข้อ 5.5 */
export const dynamic = 'force-dynamic';

export default async function CommentsPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (!can(result.admin.role, 'chat.reply')) redirect('/inbox');

  let feed: CommentFeed = {
    comments: [],
    has_more: false,
    unhandled_count: 0,
    review_count: 0,
    next_cursor: null,
  };
  let initialError: string | null = null;
  let pages: SafePage[] = [];

  try {
    const [f, p] = await Promise.all([
      listComments(result.admin, { status: 'all' }),
      listPagesFor(result.admin),
    ]);
    feed = f;
    pages = p;
  } catch (err) {
    initialError = 'โหลดคอมเมนต์ไม่สำเร็จ กรุณาลองใหม่';
    console.error('[CommentsPage] โหลดข้อมูลคอมเมนต์เริ่มต้นไม่สำเร็จ:', err);
    try {
      pages = await listPagesFor(result.admin);
    } catch {}
  }

  return (
    <CommentsClient
      initial={feed}
      initialError={initialError}
      pages={pages}
      canManageBot={can(result.admin.role, 'content.manage')}
    />
  );
}
