/**
 * GET /api/policy/preview — ถาม Policy Engine ว่า "ตอนนี้ส่งหาลูกค้ารายนี้ได้ไหม"
 * ===========================================================================
 * เป็นหน้าต่างอ่านอย่างเดียวของ engine ไม่ส่งข้อความออกไปจริง
 * หน้าแชท (รอบถัดไป) จะใช้ตัวนี้โชว์ "สถานะช่องทางส่ง" บนหัวห้อง (สเปก 5.1)
 *
 * ⚠️ ตั้งใจไม่คืนชื่อ transport ให้ฝั่งหน้าเว็บเห็นเป็นตัวเลือก
 *    แอดมินไม่ต้องรู้จัก Meta policy และห้ามเลือก transport เอง (สเปก 6.1)
 *    คืนแค่ "ส่งได้/ไม่ได้ + เหลือเวลาเท่าไหร่ + ค่าใช้จ่ายโดยประมาณ"
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase/admin';
import { requirePermission } from '@/lib/auth/current-admin';
import { canSeePage } from '@/lib/auth/permissions';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { decide, summariseForAdmin } from '@/server/policy/engine';
import { policyConfig } from '@/server/policy/config';
import { transportChannelSupport } from '@/server/transports/registry';
import {
  HUMAN_PROVENANCE_KIND,
  messageTypeForAdminChatReply,
  type Channel,
  type MessageType,
  type SendProvenance,
} from '@/server/policy/types';

/**
 * แหล่งที่มาจำลองสำหรับ "การลองถาม" เท่านั้น
 * ⚠️ ไม่มีตราประทับ จึงส่งข้อความจริงด้วยตัวนี้ไม่ได้ (sendMessage จะปฏิเสธ)
 *    ที่ต้องมีเพราะ engine ต้องรู้บริบทถึงจะตอบได้ว่า "ถ้าแอดมินกดส่งตอนนี้จะส่งได้ไหม"
 *    ตัวจริงที่ใช้ส่งอยู่ที่ @/server/messaging/provenance
 */
function previewProvenance(adminId: string): SendProvenance {
  return { kind: HUMAN_PROVENANCE_KIND, triggered_by: 'admin', human_authored: true, admin_id: adminId };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  conversation_id: z.string().uuid('conversation_id ไม่ถูกต้อง'),
  message_type: z
    .enum(['inquiry_response', 'order_update', 'shipping_update', 'appointment_reminder', 'promotion', 'upsell'])
    .optional(),
});

export async function GET(req: NextRequest) {
  try {
    const admin = await requirePermission('chat.reply');
    const url = new URL(req.url);
    const query = querySchema.parse({
      conversation_id: url.searchParams.get('conversation_id') ?? undefined,
      message_type: url.searchParams.get('message_type') ?? undefined,
    });

    const { data: conversation } = await db()
      .from('conversations')
      .select('id,customer_id,page_id,last_customer_message_at')
      .eq('id', query.conversation_id)
      .maybeSingle();

    if (!conversation) return fail('not_found', 'ไม่พบห้องแชทนี้', 404);

    // สิทธิ์รายเพจ — แอดมินเห็นเฉพาะเพจที่ได้รับมอบหมาย
    if (!canSeePage(admin.role, admin.allowed_page_ids, conversation.page_id as string)) {
      return fail('forbidden', 'คุณไม่มีสิทธิ์เข้าถึงเพจของแชทนี้', 403);
    }

    const [{ data: customer }, { data: page }, { data: observedState }] = await Promise.all([
      db()
        .from('customers')
        .select('id,psid,marketing_eligible,marketing_checked_at,last_customer_message_at')
        .eq('id', conversation.customer_id as string)
        .maybeSingle(),
      db().from('pages').select('id,platform').eq('id', conversation.page_id as string).maybeSingle(),
      db()
        .from('conversation_policy_state')
        .select('window_closed_observed_at')
        .eq('conversation_id', conversation.id as string)
        .maybeSingle(),
    ]);

    if (!customer || !page) return fail('not_found', 'ข้อมูลลูกค้าหรือเพจไม่ครบ', 404);

    const channel: Channel = page.platform === 'instagram' ? 'instagram' : 'messenger';
    const messageType: MessageType = query.message_type ?? messageTypeForAdminChatReply();
    const now = new Date();

    const lastCustomerMessageAt =
      (conversation.last_customer_message_at as string | null) ??
      (customer.last_customer_message_at as string | null);

    const decision = decide(
      {
        customer_id: customer.id as string,
        conversation_id: conversation.id as string,
        page_id: conversation.page_id as string,
        channel,
        message_type: messageType,
        provenance: previewProvenance(admin.id),
        // ใส่ข้อความสมมติสั้น ๆ เพราะ engine ต้องมีเนื้อหาถึงจะตัดสินได้
        // ตัวนี้ไม่ถูกส่งออกไปไหน เป็นการ "ลองถาม" เท่านั้น
        content: { text: '—', template_name: messageType === 'inquiry_response' ? undefined : 'preview' },
      },
      {
        last_customer_message_at: lastCustomerMessageAt ? new Date(lastCustomerMessageAt) : null,
        marketing_eligible: Boolean(customer.marketing_eligible),
        marketing_checked_at: customer.marketing_checked_at
          ? new Date(customer.marketing_checked_at as string)
          : null,
        window_closed_observed_at: observedState?.window_closed_observed_at
          ? new Date(observedState.window_closed_observed_at as string)
          : null,
        now,
      },
      { config: policyConfig(), channelSupport: transportChannelSupport() },
    );

    const summary = summariseForAdmin(decision, now);

    return ok({
      can_send: summary.can_send,
      label_th: summary.label_th,
      // ⭐ ป้ายสั้นสำหรับหัวห้อง + เหตุผลเต็มสำหรับใต้ช่องพิมพ์ (ดู summariseForAdmin)
      badge_th: summary.badge_th,
      detail_th: summary.detail_th,
      hours_left: summary.hours_left,
      estimated_cost: summary.estimated_cost,
      // ถ้าส่งไม่ได้ บอกทางเลือกที่ทำได้จริงและถูกกฎ
      alternatives_th: decision.allowed ? [] : decision.alternatives_th,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
