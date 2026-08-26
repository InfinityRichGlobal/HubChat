/**
 * /api/orders/[id]/notify — แจ้งลูกค้าว่าจัดส่งแล้ว (ทีละใบ, รอบ 8)
 *
 * 🔴 กฎที่ห้ามพัง :
 *    • ไม่ยิง Meta เอง — ผ่าน sendMessage() → Policy Engine เสมอ
 *    • เบราว์เซอร์กำหนดเนื้อข้อความ / transport / message tag / psid ไม่ได้เลย
 *    • หนึ่งออเดอร์ต่อหนึ่งเหตุการณ์ ส่งได้ครั้งเดียว (unique ที่ฐานข้อมูล)
 *    • ⚠️ ครั้งก่อน "ไม่ทราบผล" → ห้ามกดส่งซ้ำง่าย ๆ
 *      ต้องเป็นเจ้าของร้าน + ติ๊กยอมรับความเสี่ยงว่าลูกค้าอาจได้ข้อความสองครั้ง
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { logActivity } from '@/lib/activity-log';
import { getOrder, OrderAccessError } from '@/server/orders/service';
import {
  requestOrderNotification, runSingleNotification, getOrderNotifications, NotifyRefusedError,
} from '@/server/tracking/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  confirm: z.literal(true),
  /** ต้องติ๊กเองเท่านั้น ไม่มีค่าเริ่มต้นเป็น true เด็ดขาด */
  acknowledged_duplicate_risk: z.boolean().optional(),
  ignore_quiet_hours: z.boolean().optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id } = await ctx.params;
    const body = schema.parse(await req.json().catch(() => ({})));

    // ตรวจสิทธิ์เพจของออเดอร์ก่อนแตะอะไรทั้งสิ้น
    await getOrder(admin, id);

    const queued = await requestOrderNotification({
      order_id: id,
      admin_id: admin.id,
      is_owner: admin.role === 'owner',
      acknowledged_duplicate_risk: body.acknowledged_duplicate_risk,
    });

    const summary = await runSingleNotification(queued.notification_id, admin.id, {
      ignoreQuietHours: body.ignore_quiet_hours,
    });

    await logActivity({
      adminId: admin.id,
      action: 'tracking.notify_order',
      targetType: 'order',
      targetId: id,
      detail: { event: queued.event, ...summary },
    });

    console.log(
      `[tracking-notify] order=${id} event=${queued.event} ส่งแล้ว=${summary.sent} ` +
        `ส่งไม่ได้=${summary.blocked} ไม่ทราบผล=${summary.unknown} ล้มเหลว=${summary.failed}` +
        (summary.quiet_hours ? ' ⏸ ช่วงเวลาห้ามรบกวน' : ''),
    );

    return ok({ summary, notifications: await getOrderNotifications(id) });
  } catch (err) {
    if (err instanceof NotifyRefusedError) return fail(err.code, err.message_th, 409);
    if (err instanceof OrderAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id } = await ctx.params;
    await getOrder(admin, id);
    return ok({ notifications: await getOrderNotifications(id) });
  } catch (err) {
    if (err instanceof OrderAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
