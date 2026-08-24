/**
 * /api/pages/[id] — แก้ไขเพจรายตัว (เจ้าของเท่านั้น)
 *
 * ⚠️ ตั้งใจ "ไม่มี" ปุ่มลบเพจ
 *    ลบเพจ = ลบลูกค้า ห้องแชท และประวัติข้อความทั้งหมดตามไปด้วย (on delete cascade)
 *    เป็นการทำลายข้อมูลที่กู้คืนไม่ได้จากหน้าเว็บ
 *    ถ้าจะเลิกใช้เพจไหน ให้ปิด is_active แทน — ข้อมูลเก่ายังอยู่ครบ
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission, getClientIp } from '@/lib/auth/current-admin';
import { logActivity, ACTIONS } from '@/lib/activity-log';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { updatePage } from '@/server/pages/service';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  page_name: z.string().trim().min(1).max(200).optional(),
  display_name: z.string().trim().max(100).optional().nullable(),
  tag_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'สีต้องเป็นรหัสแบบ #rrggbb')
    .optional(),
  is_active: z.boolean().optional(),
  /** ใส่มา = เปลี่ยน token / ไม่ใส่ = ไม่แตะของเดิม */
  access_token: z.string().trim().min(1).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const me = await requirePermission('page.manage');
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());

    const page = await updatePage(id, body);
    if (!page) return fail('not_found', 'ไม่พบเพจนี้', 404);

    await logActivity({
      adminId: me.id,
      action: body.is_active === false ? ACTIONS.PAGE_DISCONNECTED : 'page.updated',
      targetType: 'page',
      targetId: page.id,
      // ⚠️ จดแค่ว่า "มีการเปลี่ยน token" ห้ามจดตัว token
      detail: {
        page_id: page.page_id,
        is_active: page.is_active,
        token_changed: body.access_token !== undefined,
      },
      ip: await getClientIp(),
    });

    return ok({ page });
  } catch (err) {
    return toErrorResponse(err);
  }
}
