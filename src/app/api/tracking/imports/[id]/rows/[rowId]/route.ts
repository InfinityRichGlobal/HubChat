/**
 * /api/tracking/imports/[id]/rows/[rowId] — แอดมินแก้การจับคู่เอง (รอบ 8)
 *
 * ⚠️ รับได้แค่ "เลือกออเดอร์ไหน / ข้าม / ล้างค่า" เท่านั้น
 *    เลขพัสดุกับผลการตรวจแก้จากเบราว์เซอร์ไม่ได้ — มาจากไฟล์ที่เซิร์ฟเวอร์แกะเองเสมอ
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { resolveRow, TrackingError } from '@/server/tracking/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; rowId: string }> };

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('choose'), order_id: z.string().uuid() }),
  z.object({ action: z.literal('skip') }),
  z.object({ action: z.literal('reset') }),
]);

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id, rowId } = await ctx.params;
    const body = schema.parse(await req.json());

    const row = await resolveRow(admin, id, rowId, body);
    return ok({ row });
  } catch (err) {
    if (err instanceof TrackingError) return fail('cannot_resolve', err.message_th, 409);
    return toErrorResponse(err);
  }
}
