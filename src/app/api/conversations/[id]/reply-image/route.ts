/**
 * /api/conversations/[id]/reply-image — ส่งรูปจากในห้องแชท (รอบ 6)
 *
 * 🔴 เส้นนี้เดินตามสถาปัตยกรรมเดิมเป๊ะ ๆ :
 *    ไม่รับ transport / message tag / psid / provenance จากเบราว์เซอร์
 *    ตัวตนผู้ส่งมาจาก session เท่านั้น (humanAdminReply อ่าน cookie เอง)
 *    การตัดสินว่าส่งได้ไหมเป็นของ Policy Engine เหมือนการส่งข้อความ
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { humanAdminReply, ProvenanceDeniedError } from '@/server/messaging/provenance';
import { sendImage, ImageSendError, MAX_IMAGE_BYTES } from '@/server/messaging/send-image';
import { assertConversationAccess, InboxAccessError } from '@/server/inbox/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;

    // ตรวจสิทธิ์เพจของห้องแชทก่อนแตะไฟล์ — ไม่ให้เสียเวลาอัปโหลดของที่ไม่มีสิทธิ์ส่ง
    await assertConversationAccess(admin, id);

    const form = await req.formData();
    const file = form.get('file');
    const idempotencyKey = String(form.get('idempotency_key') ?? '').trim() || null;

    if (!(file instanceof File)) {
      return fail('no_file', 'ไม่พบไฟล์ที่แนบมา', 400);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return fail('too_large', `ไฟล์ใหญ่เกินไป (สูงสุด ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} MB)`, 413);
    }

    const result = await sendImage({
      conversation_id: id,
      provenance: await humanAdminReply(),
      file: {
        bytes: await file.arrayBuffer(),
        mime: file.type,
        filename: file.name || 'image',
        size: file.size,
      },
      idempotency_key: idempotencyKey,
    });

    // จดผลลงล็อกเซิร์ฟเวอร์เหมือนการส่งข้อความ — เวลามีปัญหาจะไล่ได้จากที่เดียวกัน
    const line =
      `[reply-image] conv=${id} sent=${result.sent} unknown=${result.outcome_unknown} ` +
      `reason=${result.reason_code} transport=${result.decision.transport ?? '-'} ` +
      `fbtrace=${result.fbtrace_id ?? '-'}`;
    if (result.sent) console.log(`${line} ✅`);
    else console.error(`${line} ❌ ${result.reason_th}`);

    return ok({
      sent: result.sent,
      outcome_unknown: result.outcome_unknown,
      reason_th: result.reason_th,
      alternatives_th: result.decision.alternatives_th ?? [],
    });
  } catch (err) {
    if (err instanceof ImageSendError) return fail('image_failed', err.message_th, 422);
    if (err instanceof ProvenanceDeniedError) return fail('forbidden', err.message_th, 403);
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
