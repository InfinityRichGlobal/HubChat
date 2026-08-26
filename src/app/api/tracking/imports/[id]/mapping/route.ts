/**
 * /api/tracking/imports/[id]/mapping — แก้ว่าคอลัมน์ไหนคืออะไร แล้วแกะไฟล์ใหม่ (รอบ 8)
 *
 * 🔴 ทำไมต้องมีเส้นนี้ :
 *    ระบบเดาคอลัมน์ให้ ซึ่งเดาผิดได้ (ไฟล์บางเจ้ามีทั้ง "เบอร์ผู้ส่ง" และ "เบอร์ผู้รับ")
 *    ถ้าแก้ไม่ได้ เจ้าของร้านจะติดตาย เพราะลายนิ้วมือไฟล์กันการอัปโหลดซ้ำไว้
 *
 * ⚠️ เบราว์เซอร์บอกได้แค่ "ชื่อคอลัมน์" เท่านั้น
 *    เซิร์ฟเวอร์เป็นคนแกะไฟล์ ตรวจ และจับคู่ใหม่ทั้งหมดเองเสมอ
 *    และรับเฉพาะชื่อคอลัมน์ที่มีอยู่จริงในไฟล์
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { logActivity } from '@/lib/activity-log';
import { remapImport, TrackingError } from '@/server/tracking/service';
import type { ColumnMapping } from '@/server/tracking/columns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const column = z.string().trim().max(200).optional();

const schema = z.object({
  tracking_no: column,
  order_ref: column,
  phone: column,
  postcode: column,
  recipient_name: column,
  carrier: column,
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id } = await ctx.params;
    const body = schema.parse(await req.json());

    const mapping: ColumnMapping = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'string' && v !== '') mapping[k as keyof ColumnMapping] = v;
    }

    const result = await remapImport(admin, id, mapping);

    await logActivity({
      adminId: admin.id,
      action: 'tracking.import_remapped',
      targetType: 'tracking_import',
      targetId: id,
      detail: { mapping, ...result.summary },
    });

    return ok(result);
  } catch (err) {
    if (err instanceof TrackingError) return fail('cannot_remap', err.message_th, 409);
    return toErrorResponse(err);
  }
}
