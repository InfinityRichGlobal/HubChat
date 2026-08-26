/**
 * /api/tracking/imports/[id]/apply — ลงเลขพัสดุจริง (รอบ 8)
 *
 * 🔴 จุดที่เปลี่ยนข้อมูลจริงของออเดอร์ — ด่านกันพลาดอยู่ที่ฐานข้อมูลทั้งหมด :
 *    • claim_tracking_import_apply : กดสองครั้ง/สองแท็บ = ทำงานครั้งเดียว
 *    • apply_tracking_row          : ทับค่าเดิมได้ แต่ต้องมีร่องรอยเสมอ
 *    • unique (order_id,event)     : หนึ่งออเดอร์แจ้งลูกค้าได้ครั้งเดียวตลอดกาล
 *
 * ⚠️ เส้นนี้ "ไม่ส่งข้อความ" แม้แต่โหมด send — มันแค่เข้าคิวไว้
 *    การส่งจริงอยู่ที่ /notify ซึ่งทยอยส่งตามโควตา
 *    แยกกันโดยตั้งใจ : ลงเลขพัสดุ 300 ใบต้องไม่กลายเป็นยิง 300 ข้อความในคำขอเดียว
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { logActivity } from '@/lib/activity-log';
import { applyImport, getImport, TrackingError } from '@/server/tracking/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  /** none = ลงอย่างเดียว / prepare = ลง + เตรียมแจ้ง / send = ลง + เตรียมแจ้ง แล้วค่อยกดส่ง */
  notify_mode: z.enum(['none', 'prepare', 'send']).default('none'),
  /** ต้องยืนยันเสมอ — กันการยิงเส้นนี้โดยไม่ได้ตั้งใจ */
  confirm: z.literal(true),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id } = await ctx.params;
    const body = schema.parse(await req.json().catch(() => ({})));

    const result = await applyImport(admin, id, { notify_mode: body.notify_mode });

    await logActivity({
      adminId: admin.id,
      action: 'tracking.import_applied',
      targetType: 'tracking_import',
      targetId: id,
      detail: { ...result, notify_mode: body.notify_mode },
    });

    console.log(
      `[tracking] ลงเลขพัสดุ import=${id} ลงแล้ว=${result.applied_count} ` +
        `เหมือนเดิม=${result.noop_count} ข้าม=${result.skipped_count} ` +
        `ล้มเหลว=${result.failed_count} เข้าคิวแจ้ง=${result.queued_count}`,
    );

    return ok({ result, import: await getImport(admin, id) });
  } catch (err) {
    if (err instanceof TrackingError) return fail('cannot_apply', err.message_th, 409);
    return toErrorResponse(err);
  }
}
