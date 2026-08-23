import 'server-only';
/**
 * Transport 2 — HUMAN_AGENT
 * ===========================================================================
 * 🔴 ช่องทางที่อันตรายที่สุดในระบบ ใช้ผิด = เพจ/แอปโดนระงับ
 *
 * ใช้ได้เฉพาะ : ข้อความที่ "คนพิมพ์จริง" เพื่อตอบคำถามของลูกค้า
 * ห้ามใช้กับ  : บอทคีย์เวิร์ด, follow-up อัตโนมัติ, ข้อความขายทุกชนิด
 *
 * ในไฟล์นี้มีด่านตรวจซ้ำอีกชั้น ทั้งที่ Policy Engine ตรวจไปแล้ว
 * เพราะถ้าวันหนึ่งมีใครเผลอเรียก adapter ตรง ๆ โดยไม่ผ่าน engine
 * ตาข่ายชั้นนี้จะกันไว้ให้ ดีกว่าปล่อยผ่านแล้วโดนระงับ
 */
import { policyConfig } from '@/server/policy/config';
import type { Channel, SendContext } from '@/server/policy/types';
import type { MetaPage, MetaSendPayload, MetaSendResult } from '@/server/meta/client';
import { baseEnvelope, dispatch, requireBody } from './base';
import type { BuildResult, TransportAdapter } from './types';

export const humanAgentAdapter: TransportAdapter = {
  transport: 'HUMAN_AGENT',
  channels: ['messenger', 'instagram'],

  enabled(channel: Channel): boolean {
    return policyConfig().channels[channel].HUMAN_AGENT.enabled;
  },

  isEligible(ctx: SendContext) {
    if (!this.channels.includes(ctx.channel)) {
      return { ok: false as const, reason_th: 'ช่องทางนี้ใช้กับแพลตฟอร์มนี้ไม่ได้' };
    }
    // ⭐ ด่านกันบอทและ scheduler แอบใช้ทางลัด
    if (ctx.triggered_by !== 'admin' || !ctx.human_typed) {
      return {
        ok: false as const,
        reason_th: 'ช่องทางนี้ใช้ได้เฉพาะข้อความที่แอดมินพิมพ์เองเท่านั้น ระบบอัตโนมัติใช้ไม่ได้',
      };
    }
    // ⭐ ด่านกันเอาไปใช้ส่งข้อความขาย
    if (ctx.message_type !== 'inquiry_response') {
      return {
        ok: false as const,
        reason_th: 'ช่องทางนี้ใช้ได้เฉพาะการตอบคำถามลูกค้าเท่านั้น',
      };
    }
    return { ok: true as const };
  },

  build(ctx: SendContext, recipientPsid: string): BuildResult {
    const guard = this.isEligible(ctx);
    if (!guard.ok) return { ok: false, reason_th: guard.reason_th };

    const message = requireBody(ctx);
    if (!message) return { ok: false, reason_th: 'ไม่มีเนื้อหาที่จะส่ง' };

    return {
      ok: true,
      payload: {
        ...baseEnvelope(recipientPsid),
        messaging_type: 'MESSAGE_TAG',
        tag: 'HUMAN_AGENT',
        message,
      },
    };
  },

  send(page: MetaPage, payload: MetaSendPayload): Promise<MetaSendResult> {
    return dispatch(page, payload);
  },
};
