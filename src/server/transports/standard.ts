import 'server-only';
/**
 * Transport 1 — STANDARD
 * ===========================================================================
 * ส่งข้อความปกติในกรอบเวลาที่ Meta อนุญาตหลังลูกค้าทักมา
 * ใช้ได้กับข้อความทุกประเภท ไม่มีค่าใช้จ่าย
 *
 * ⚠️ ไฟล์นี้ไม่รู้ว่ากรอบเวลาคือกี่ชั่วโมง และไม่ควรรู้ด้วย
 *    Policy Engine เป็นคนตัดสินมาแล้วว่าอยู่ในกรอบ ถึงจะเรียกมาที่นี่
 */
import { policyConfig } from '@/server/policy/config';
import type { Channel, SendContext } from '@/server/policy/types';
import type { MetaPage, MetaSendPayload, MetaSendResult } from '@/server/meta/client';
import { baseEnvelope, dispatch, requireBody, withReplyTo } from './base';
import type { BuildResult, TransportAdapter } from './types';

export const standardAdapter: TransportAdapter = {
  transport: 'STANDARD',
  channels: ['messenger', 'instagram'],

  enabled(channel: Channel): boolean {
    return policyConfig().channels[channel].STANDARD.enabled;
  },

  isEligible(ctx: SendContext) {
    if (!this.channels.includes(ctx.channel)) {
      return { ok: false as const, reason_th: 'ช่องทางนี้ใช้กับแพลตฟอร์มนี้ไม่ได้' };
    }
    return { ok: true as const };
  },

  build(ctx: SendContext, recipientPsid: string): BuildResult {
    const message = requireBody(ctx);
    if (!message) return { ok: false, reason_th: 'ไม่มีเนื้อหาที่จะส่ง' };

    /**
     * ⭐ ตอบกลับข้อความ — ใส่ให้เฉพาะช่องทางที่ Meta รองรับจริง
     *    ช่องทางที่ไม่รองรับจะได้ payload เดิมไม่มี reply_to
     *    (ระบบยังเก็บความสัมพันธ์ไว้ฝั่งเราเองอยู่ดี)
     */
    const { payload } = withReplyTo(
      {
        ...baseEnvelope(recipientPsid),
        messaging_type: 'RESPONSE',
        message,
      },
      ctx,
    );

    return { ok: true, payload };
  },

  send(page: MetaPage, payload: MetaSendPayload): Promise<MetaSendResult> {
    return dispatch(page, payload);
  },
};
