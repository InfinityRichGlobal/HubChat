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

  /**
   * ⭐ ตอบกลับข้อความไหน — **id ของข้อความในระบบเรา** เท่านั้น
   *
   * 🔴 สังเกตว่ารับเป็น uuid ของเรา ไม่ใช่ mid ของ Meta
   *    ถ้ารับ mid ตรง ๆ หน้าเว็บจะยัด mid ของห้องอื่นหรือเพจอื่นมาแปะได้
   *    sendMessage() จะแปลงเป็น mid ให้เอง พร้อมตรวจว่าอยู่ห้องเดียวกันจริง
   *    (กฎเดียวกับ transport / tag / psid ที่หน้าเว็บกำหนดเองไม่ได้)
   */
  reply_to_message_id: z.string().uuid('ข้อความที่จะตอบกลับไม่ถูกต้อง').nullish(),
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
      reply_to_message_id: body.reply_to_message_id ?? null,
    });

    // ⭐ จดผลลงล็อกของเซิร์ฟเวอร์ด้วย
    //    เดิมเหตุผลที่ส่งไม่ออกอยู่แค่ใน toast บนหน้าจอ ซึ่งต้องทันเห็นเท่านั้น
    //    เวลาไล่ปัญหาเราต้องเห็นย้อนหลังได้จากเทอร์มินัล
    //    ⚠️ จดเฉพาะ "ผลลัพธ์" ห้ามจดเนื้อข้อความของลูกค้าลงล็อกเด็ดขาด
    const line =
      `[reply] conv=${id} sent=${result.sent} unknown=${result.outcome_unknown} ` +
      `reason=${result.reason_code} attempts=${result.attempts} ` +
      `transport=${result.decision.transport ?? '-'} fbtrace=${result.fbtrace_id ?? '-'}`;
    if (result.sent) {
      console.log(`${line} ✅`);
    } else {
      console.error(`${line} ❌ ${result.reason_th}`);
      if (result.decision.alternatives_th.length > 0) {
        console.error(`[reply] ทางเลือกที่ทำได้: ${result.decision.alternatives_th.join(' · ')}`);
      }
    }

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
