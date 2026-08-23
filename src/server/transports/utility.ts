import 'server-only';
/**
 * Transport 3 — UTILITY
 * ===========================================================================
 * ข้อความ "แจ้งข้อมูลล้วน" โดยใช้เทมเพลตที่ได้รับอนุมัติ
 * เช่น แจ้งเลขพัสดุ อัปเดตสถานะออเดอร์ เตือนนัดหมาย
 *
 * ⚠️ ข้อความต้องเป็นการแจ้งข้อมูลล้วน "ห้ามแทรกการขาย" (สเปก 5.8)
 *    แทรกเมื่อไหร่ก็หลุดจากหมวด utility ทันที และกลายเป็นการฝ่าฝืนนโยบาย
 *
 * ⚠️ ระบบนี้ตั้งใจ "ไม่มี" ทางถอยไปใช้ message tag แบบเก่า
 *    (POST_PURCHASE_UPDATE / ACCOUNT_UPDATE / CONFIRMED_EVENT_UPDATE)
 *    เพราะ Meta ทยอยเลิกรองรับแล้ว การเขียนโค้ดพึ่งของที่กำลังจะหายไป
 *    คือการสร้างงานซ่อมให้ตัวเองในอนาคต
 *    ถ้า UTILITY ใช้ไม่ได้ ระบบจะ "บอกตรง ๆ ว่าส่งไม่ได้" ตามกฎเหล็กข้อ 2
 *
 * 🔒 ค่าเริ่มต้นคือปิดและยังไม่ยืนยัน (verified=false)
 *    ต้องอ่านเอกสารของ Meta ให้ชัดว่าใช้ได้จริง + ได้รับ permission แล้ว
 *    จึงจะเปิดใน .env.local ได้
 */
import { policyConfig } from '@/server/policy/config';
import type { Channel, SendContext } from '@/server/policy/types';
import { UTILITY_MESSAGE_TYPES } from '@/server/policy/config';
import type { MetaPage, MetaSendPayload, MetaSendResult } from '@/server/meta/client';
import { baseEnvelope, dispatch } from './base';
import type { BuildResult, TransportAdapter } from './types';

export const utilityAdapter: TransportAdapter = {
  transport: 'UTILITY',
  // ยังไม่ยืนยันว่า Instagram มีช่องทางนี้ จึงไม่ประกาศว่ารองรับ
  channels: ['messenger'],

  enabled(channel: Channel): boolean {
    return policyConfig().channels[channel].UTILITY.enabled;
  },

  isEligible(ctx: SendContext) {
    if (!this.channels.includes(ctx.channel)) {
      return { ok: false as const, reason_th: 'ช่องทางนี้ใช้กับแพลตฟอร์มนี้ไม่ได้' };
    }
    if (!UTILITY_MESSAGE_TYPES.includes(ctx.message_type)) {
      return { ok: false as const, reason_th: 'ช่องทางนี้ใช้ได้เฉพาะข้อความแจ้งข้อมูลเท่านั้น' };
    }
    if (!ctx.content.template_name) {
      return { ok: false as const, reason_th: 'ต้องระบุเทมเพลตที่ได้รับอนุมัติก่อนจึงจะส่งได้' };
    }
    return { ok: true as const };
  },

  build(ctx: SendContext, recipientPsid: string): BuildResult {
    const guard = this.isEligible(ctx);
    if (!guard.ok) return { ok: false, reason_th: guard.reason_th };

    return {
      ok: true,
      payload: {
        ...baseEnvelope(recipientPsid),
        messaging_type: 'UTILITY',
        message: {
          template: {
            name: ctx.content.template_name,
            parameters: ctx.content.template_params ?? {},
          },
        },
      },
    };
  },

  send(page: MetaPage, payload: MetaSendPayload): Promise<MetaSendResult> {
    return dispatch(page, payload);
  },
};
