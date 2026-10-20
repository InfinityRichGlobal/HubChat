/**
 * GET /api/conversations — ลิสต์แชท (สเปกหัวข้อ 5.1)
 *
 * ⚠️ การกรองสิทธิ์รายเพจอยู่ในชั้นบริการ ไม่ใช่ที่นี่
 *    ถึงหน้าเว็บจะส่ง page_ids อะไรมา ก็จะได้เฉพาะเพจที่ตัวเองมีสิทธิ์เท่านั้น
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { listConversations } from '@/server/inbox/service';
import type { InboxGroup, ListFilters } from '@/server/inbox/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INBOX_GROUPS = new Set<InboxGroup>([
  'all', 'facebook', 'instagram', 'ai_handoff', 'ai_reply', 'important',
  'unread', 'follow_up', 'done', 'spam', 'assigned',
]);

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin();

    const params = req.nextUrl.searchParams;
    const requestedGroup = params.get('group') as InboxGroup | null;
    const group = requestedGroup && INBOX_GROUPS.has(requestedGroup) ? requestedGroup : 'all';
    const platform = params.get('platform');
    const assigned = params.get('assigned_admin_id');
    const orderCount = params.get('order_count');

    const result = await listConversations(admin, {
      page_ids: params.get('page_ids')?.split(',').filter(Boolean),
      tag_ids: params.get('tag_ids')?.split(',').filter(Boolean),
      search: params.get('search') ?? undefined,
      group,
      order_count: orderCount && ['0', '1', '2', '3', '4', '5_10', '11_plus'].includes(orderCount) ? orderCount as ListFilters['order_count'] : undefined,
      platform: platform === 'facebook' || platform === 'instagram' ? platform : undefined,
      assigned_admin_id: assigned === 'unassigned' || (assigned && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assigned)) ? assigned : undefined,
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
      // cursor = last_message_at ของห้องสุดท้ายที่หน้าเว็บถืออยู่ (ขอของเก่ากว่านั้น)
      before: params.get('before'),
      before_id: params.get('before_id'),
      since: params.get('since'),
      since_id: params.get('since_id'),
    });

    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
