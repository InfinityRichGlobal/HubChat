/**
 * /api/tracking/imports — อัปโหลดไฟล์ขนส่ง + ดูรายการรอบนำเข้า (รอบ 8)
 *
 * 🔴 เบราว์เซอร์ส่งมาได้แค่ "ไฟล์" กับ "การจับคู่คอลัมน์" เท่านั้น
 *    การตรวจ / จับคู่ออเดอร์ / ตัดสินว่าลงได้ไหม เป็นของฝั่งเซิร์ฟเวอร์ทั้งหมด
 *    (ตรวจซ้ำเสมอ ไม่เชื่อผลที่หน้าเว็บคำนวณไว้)
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { logActivity } from '@/lib/activity-log';
import {
  createImport, listImports, DuplicateFileError, TrackingError,
} from '@/server/tracking/service';
import { MAX_CSV_BYTES } from '@/server/tracking/csv';
import type { ColumnMapping, Courier } from '@/server/tracking/columns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const COURIERS: Courier[] = ['flash', 'kerry', 'jt', 'thailand_post', 'custom'];

export async function GET() {
  try {
    const admin = await requirePermission('order.create');
    return ok({ imports: await listImports(admin) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requirePermission('order.create');

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('no_file', 'ไม่พบไฟล์ที่แนบมา', 400);
    if (file.size > MAX_CSV_BYTES) {
      return fail('too_large', `ไฟล์ใหญ่เกิน ${Math.floor(MAX_CSV_BYTES / 1024 / 1024)} MB`, 413);
    }

    // ⚠️ อ่านเป็นข้อความ UTF-8 — ไฟล์ที่บันทึกเป็น TIS-620 จะอ่านภาษาไทยเพี้ยน
    //    ตัวแกะจะมองเห็นเป็นหัวคอลัมน์ที่จับคู่ไม่ได้ แล้วรายงานให้แอดมินแก้เอง
    const content = new TextDecoder('utf-8').decode(await file.arrayBuffer());

    let mapping: ColumnMapping | undefined;
    const rawMapping = form.get('mapping');
    if (typeof rawMapping === 'string' && rawMapping.trim() !== '') {
      try {
        const parsed = JSON.parse(rawMapping) as Record<string, unknown>;
        mapping = {};
        for (const key of ['tracking_no', 'order_ref', 'phone', 'postcode', 'recipient_name', 'carrier'] as const) {
          const v = parsed[key];
          if (typeof v === 'string' && v.trim() !== '') mapping[key] = v;
        }
      } catch {
        return fail('invalid_mapping', 'ข้อมูลการจับคู่คอลัมน์ไม่ถูกต้อง', 422);
      }
    }

    const rawCourier = String(form.get('courier') ?? '');
    const courier = COURIERS.includes(rawCourier as Courier) ? (rawCourier as Courier) : undefined;

    const result = await createImport(admin, {
      filename: file.name || 'tracking.csv',
      content,
      mapping,
      courier,
    });

    await logActivity({
      adminId: admin.id,
      action: 'tracking.import_uploaded',
      targetType: 'tracking_import',
      targetId: result.import_id,
      detail: {
        filename: file.name,
        total: result.summary.total,
        auto: result.summary.auto,
        ambiguous: result.summary.ambiguous,
        unmatched: result.summary.unmatched,
        errors: result.summary.errors,
      },
    });

    console.log(
      `[tracking] อัปโหลด import=${result.import_id} แถว=${result.summary.total} ` +
        `จับคู่ได้=${result.summary.auto} ต้องเลือก=${result.summary.ambiguous} ` +
        `ไม่เจอ=${result.summary.unmatched} ผิด=${result.summary.errors}`,
    );

    return ok(result);
  } catch (err) {
    // ⭐ ไฟล์ซ้ำไม่ใช่ความผิดพลาด — ชี้ไปที่รอบเดิมให้เลย
    if (err instanceof DuplicateFileError) {
      return fail('duplicate_file', err.message_th, 409, { import_id: err.import_id });
    }
    if (err instanceof TrackingError) return fail('invalid_file', err.message_th, 422);
    return toErrorResponse(err);
  }
}
