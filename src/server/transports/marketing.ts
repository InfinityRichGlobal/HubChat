import 'server-only';
/**
 * Transport 4 — MARKETING
 * ===========================================================================
 * ข้อความขาย เป็นบริการ "เสียเงินรายข้อความ"
 *
 * กฎที่ต้องรักษา :
 *   • ต้องเช็ค eligibility รายบุคคลก่อนทุกครั้ง (Policy Engine ทำให้แล้ว)
 *   • ต้องแสดงค่าใช้จ่ายโดยประมาณให้แอดมินเห็นก่อนกดส่งเสมอ
 *   • ห้ามแปลงข้อความขายไปส่งทางช่องอื่นให้เนียน — ถ้าส่งไม่ได้ให้บอกตรง ๆ
 *
 * 🔒 ค่าเริ่มต้นคือปิดและยังไม่ยืนยัน
 */
import { policyConfig, MARKETING_MESSAGE_TYPES } from '@/server/policy/config';
import type { Channel, SendContext } from '@/server/policy/types';
import type { MetaPage, MetaSendPayload, MetaSendResult } from '@/server/meta/client';
import { baseEnvelope, dispatch } from './base';
import type { BuildResult, TransportAdapter } from './types';

export const marketingAdapter: TransportAdapter = {
  transport: 'MARKETING',
  channels: ['messenger'],

  enabled(channel: Channel): boolean {
    return policyConfig().channels[channel].MARKETING.enabled;
  },

  isEligible(ctx: SendContext) {
    if (!this.channels.includes(ctx.channel)) {
      return { ok: false as const, reason_th: 'ช่องทางนี้ใช้กับแพลตฟอร์มนี้ไม่ได้' };
    }
    if (!MARKETING_MESSAGE_TYPES.includes(ctx.message_type)) {
      return { ok: false as const, reason_th: 'ช่องทางนี้ใช้ได้เฉพาะข้อความการตลาดเท่านั้น' };
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
        messaging_type: 'MARKETING',
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
