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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const params = req.nextUrl.searchParams;

    const result = await listConversations(admin, {
      page_ids: params.get('page_ids')?.split(',').filter(Boolean),
      tag_ids: params.get('tag_ids')?.split(',').filter(Boolean),
      search: params.get('search') ?? undefined,
      unread_only: params.get('unread') === '1',
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
      // cursor = last_message_at ของห้องสุดท้ายที่หน้าเว็บถืออยู่ (ขอของเก่ากว่านั้น)
      before: params.get('before'),
    });

    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
