/**
 * POST /api/conversations/[id]/reply — แอดมินกดส่งข้อความในห้องแชท
 * ===========================================================================
 * 🔴 นี่คือจุดที่ "ปุ่มส่งปุ่มเดียว" ของหน้าแชทวิ่งมาลง (สเปกหัวข้อ 5.1 + 6.1)
 *
 * สิ่งที่ route นี้ตั้งใจ "ไม่" รับจากหน้าเว็บ :
 *   ✗ transport / message tag        — Policy Engine เลือกเอง แอดมินห้ามเลือก
 *   ✗ ลูกค้าคนไหน / เพจไหน / psid    — sendMessage() อ่านจากฐานข้อมูลเอง
 *   ✗ คำอ้างว่า "เป็นคนพิมพ์เอง"      — พิสูจน์จาก session ผ่าน humanAdminReply()
 *
 * รับมาแค่ "ห้องไหน" กับ "ข้อความว่าอะไร" เท่านั้น
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { InboxAccessError, markRead } from '@/server/inbox/service';
import { sendMessage } from '@/server/messaging/send-message';
import { humanAdminReply, ProvenanceDeniedError } from '@/server/messaging/provenance';
import { messageTypeForAdminChatReply } from '@/server/policy/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  text: z.string().trim().min(1, 'พิมพ์ข้อความก่อนกดส่ง').max(2000, 'ข้อความยาวเกินไป'),
  /**
   * กุญแจกันส่งซ้ำ — หน้าเว็บสร้างให้ตอนพิมพ์เสร็จ
   * ถ้าเน็ตกระตุกแล้วกดส่งซ้ำด้วยกุญแจเดิม ลูกค้าจะไม่ได้ข้อความสองรอบ
   */
  idempotency_key: z.string().trim().min(8).max(120).optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = bodySchema.parse(await req.json());

    // ตรวจสิทธิ์เข้าถึงเพจของห้องนี้ก่อน (โยน InboxAccessError ถ้าไม่ผ่าน)
    // ทำผ่าน markRead เพราะเรากำลังจะตอบอยู่แล้ว = อ่านแล้วแน่นอน
    await markRead(admin, id);

    // ⭐ ตราประทับ "คนพิมพ์เอง" ออกจากโรงงานที่นี่ที่เดียว
    //    ฟังก์ชันนี้ไม่รับพารามิเตอร์ใด ๆ โดยตั้งใจ — มันไปอ่าน session เอง
    const provenance = await humanAdminReply();

    const result = await sendMessage({
      conversation_id: id,
      message_type: messageTypeForAdminChatReply(),
      provenance,
      content: { text: body.text },
      idempotency_key: body.idempotency_key,
    });

    return ok({
      sent: result.sent,
      outcome_unknown: result.outcome_unknown,
      reason_th: result.reason_th,
      badge_th: result.badge_th,
      alternatives_th: result.decision.alternatives_th,
    });
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    if (err instanceof ProvenanceDeniedError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
