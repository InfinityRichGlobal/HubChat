/**
 * /api/pages — รายชื่อเพจที่เชื่อมไว้ + เชื่อมเพจใหม่
 * ===========================================================================
 * GET  : แอดมินทุกระดับเรียกได้ แต่เห็นเฉพาะเพจที่ตัวเองมีสิทธิ์ (สเปกหัวข้อ 6.6)
 * POST : เจ้าของร้านเท่านั้น (สเปกหัวข้อ 5.7 — "เชื่อมเพจ / เห็น token")
 *
 * ⚠️ ทั้งสองเส้นทางไม่มีทางส่ง access token กลับออกไป
 *    ตัวตัดออกอยู่ใน src/server/pages/service.ts (toSafe)
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requirePermission, getClientIp } from '@/lib/auth/current-admin';
import { logActivity, ACTIONS } from '@/lib/activity-log';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { createPage, listPagesFor, PageConflictError } from '@/server/pages/service';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const me = await requireAdmin();
    const pages = await listPagesFor(me);
    return ok({ pages });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const createSchema = z.object({
  platform: z.enum(['facebook', 'instagram']),
  // id ของเพจฝั่ง Meta เป็นตัวเลขยาว ๆ
  page_id: z.string().trim().min(1, 'กรุณากรอก Page ID').max(64),
  page_name: z.string().trim().min(1, 'กรุณากรอกชื่อเพจ').max(200),
  display_name: z.string().trim().max(100).optional().nullable(),
  tag_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'สีต้องเป็นรหัสแบบ #rrggbb')
    .optional(),
  access_token: z.string().trim().min(1).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const me = await requirePermission('page.manage');
    const body = createSchema.parse(await req.json());

    const page = await createPage(body);

    await logActivity({
      adminId: me.id,
      action: ACTIONS.PAGE_CONNECTED,
      targetType: 'page',
      targetId: page.id,
      // ⚠️ จดได้แค่ว่า "มี token ไหม" ห้ามจดตัว token ลง activity log เด็ดขาด
      detail: { platform: page.platform, page_id: page.page_id, has_token: page.has_token },
      ip: await getClientIp(),
    });

    return ok({ page }, { status: 201 });
  } catch (err) {
    if (err instanceof PageConflictError) return fail('duplicate_page', err.message, 409);
    return toErrorResponse(err);
  }
}
