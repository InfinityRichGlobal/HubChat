/**
 * /api/orders/[id]/slip — อัปโหลดสลิปโอนเงินของออเดอร์ (D-17)
 *
 * 🔴 นี่คือเหตุผลหลักที่ D-17 ต้องทำก่อนใช้งานจริง
 *    สลิปคือหลักฐานการชำระเงิน หายแล้วพิสูจน์อะไรไม่ได้
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { getOrder, updateOrder, OrderAccessError } from '@/server/orders/service';
import { storeUploadedFile } from '@/server/storage/media';
import { StorageNotConfiguredError } from '@/server/storage/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** สลิปเป็นรูปถ่ายหรือ PDF จากแอปธนาคาร */
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id } = await ctx.params;

    // ตรวจสิทธิ์เพจของออเดอร์ก่อนแตะไฟล์
    const order = await getOrder(admin, id);

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('no_file', 'ไม่พบไฟล์ที่แนบมา', 400);
    if (!ALLOWED.includes(file.type)) {
      return fail('bad_type', 'รองรับเฉพาะรูปภาพ (JPG / PNG / WEBP) หรือ PDF', 422);
    }
    if (file.size > MAX_BYTES) {
      return fail('too_large', `ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_BYTES / 1024 / 1024} MB)`, 413);
    }

    const mediaId = await storeUploadedFile(await file.arrayBuffer(), file.type, 'slip', {
      conversation_id: order.conversation_id,
      page_id: order.page_id,
    });

    // ⭐ ผูกสลิปกับออเดอร์ผ่าน update_order เดิม → ได้ประวัติการแก้ไขอัตโนมัติ
    const updated = await updateOrder(admin, id, { slip_media_id: mediaId });

    return ok({ order: updated, media_id: mediaId });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      return fail(
        'storage_not_configured',
        'ยังไม่ได้ตั้งค่าที่เก็บไฟล์ — ทำตามขั้นตอนใน docs/STORAGE.md ก่อน',
        503,
      );
    }
    if (err instanceof OrderAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
