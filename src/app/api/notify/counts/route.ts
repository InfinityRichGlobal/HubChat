import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { unreadBadgeCount, unhandledCommentBadgeCount } from '@/server/notify/dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const admin = await requireAdmin();
    const [unreadChats, unhandledComments] = await Promise.all([
      unreadBadgeCount(admin.id, admin.role, admin.allowed_page_ids),
      unhandledCommentBadgeCount(admin.id, admin.role, admin.allowed_page_ids),
    ]);
    return ok({
      unread_chats: unreadChats,
      unhandled_comments: unhandledComments,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
