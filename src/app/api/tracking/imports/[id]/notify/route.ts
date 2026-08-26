/**
 * /api/tracking/imports/[id]/notify — ทยอยส่งข้อความแจ้งลูกค้า (รอบ 8)
 *
 * 🔴 กฎที่เส้นนี้ต้องรักษา :
 *    • ไม่ยิง Meta เอง — ตัวรันเรียก sendMessage() ซึ่งผ่าน Policy Engine เสมอ
 *    • เบราว์เซอร์กำหนดเนื้อข้อความ / transport / psid / ตราประทับไม่ได้เลย
 *    • ส่งได้ครั้งเดียวต่อออเดอร์ต่อเหตุการณ์ (unique ที่ฐานข้อมูล)
 *    • Policy Engine ห้าม = จดว่า "ยังไม่ได้แจ้ง" ไม่ใช่ฝืนส่ง
 *    • ไม่ทราบผล = ไม่ลองใหม่อัตโนมัติ
 *
 * ⚠️ กดหนึ่งครั้งส่งได้จำนวนจำกัด แล้วคืน remaining มาให้กดต่อ
 *    เพราะคำขอเดียวที่ยาวเป็นสิบนาทีจะถูกตัดกลางทางแน่นอน
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { logActivity } from '@/lib/activity-log';
import { getImport, TrackingError } from '@/server/tracking/service';
import { runNotificationQueue, MAX_PER_RUN } from '@/server/tracking/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  confirm: z.literal(true),
  limit: z.number().int().min(1).max(MAX_PER_RUN).optional(),
  /** แอดมินยืนยันว่าจะส่งตอนนี้จริง ๆ ถึงจะดึกก็ตาม */
  ignore_quiet_hours: z.boolean().optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id } = await ctx.params;
    const body = schema.parse(await req.json().catch(() => ({})));

    const view = await getImport(admin, id);
    if (view.status !== 'applied') {
      return fail('not_applied', 'ต้องลงเลขพัสดุให้เรียบร้อยก่อนถึงจะแจ้งลูกค้าได้', 409);
    }

    const summary = await runNotificationQueue(admin.id, id, {
      limit: body.limit,
      ignoreQuietHours: body.ignore_quiet_hours,
    });

    await logActivity({
      adminId: admin.id,
      action: 'tracking.notify_run',
      targetType: 'tracking_import',
      targetId: id,
      detail: { ...summary },
    });

    console.log(
      `[tracking-notify] import=${id} ลอง=${summary.attempted} ส่งแล้ว=${summary.sent} ` +
        `ส่งไม่ได้=${summary.blocked} ไม่ทราบผล=${summary.unknown} ` +
        `ล้มเหลว=${summary.failed} เหลือ=${summary.remaining}` +
        (summary.quiet_hours ? ' ⏸ อยู่ในช่วงเวลาห้ามรบกวน' : ''),
    );

    return ok({ summary, import: await getImport(admin, id) });
  } catch (err) {
    if (err instanceof TrackingError) return fail('cannot_notify', err.message_th, 409);
    return toErrorResponse(err);
  }
}
