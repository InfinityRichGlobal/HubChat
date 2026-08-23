/**
 * Transport Adapter — หน้าตาที่ทุกตัวต้องเหมือนกัน (สเปกหัวข้อ 6.1)
 * ===========================================================================
 * `{ enabled, isEligible(ctx), send(ctx) }`
 *
 * เหตุผลที่ต้องแยกไฟล์ละตัวและเปิด-ปิดจาก config ได้ :
 *   permission บางตัวของ Meta อาจยังไม่ได้รับอนุมัติ หรืออาจถูกยกเลิกภายหลัง
 *   ถ้าเขียนรวมกันเป็นก้อนเดียว เวลาต้องสลับจะกระทบทั้งระบบ
 *   แยกไว้ตั้งแต่แรก = ปิดตัวหนึ่ง เปิดอีกตัว โดยไม่แตะโค้ดส่วนอื่นเลย
 *
 * หน้าที่ของ adapter :
 *   "แปลงคำสั่งส่ง ให้เป็น payload ที่ Meta เข้าใจ" เท่านั้น
 *   ห้ามตัดสินใจเองว่าส่งได้หรือไม่ได้ — นั่นเป็นหน้าที่ของ Policy Engine
 */
import type { Channel, SendContext, Transport } from '@/server/policy/types';
import type { MetaPage, MetaSendPayload, MetaSendResult } from '@/server/meta/client';

export type BuildResult =
  | { ok: true; payload: MetaSendPayload }
  | { ok: false; reason_th: string };

export type TransportAdapter = {
  transport: Transport;

  /** แพลตฟอร์มที่ adapter ตัวนี้รองรับจริง — ต้องตรงกับ DEFAULT_CHANNEL_SUPPORT */
  channels: Channel[];

  /** เปิดใช้อยู่ไหม (อ่านจาก config ตอนเรียก ไม่ cache) */
  enabled(channel: Channel): boolean;

  /**
   * ตรวจซ้ำอีกชั้นก่อนส่งจริง
   * ปกติ Policy Engine ตรวจให้หมดแล้ว แต่ตัวนี้เป็นตาข่ายชั้นสุดท้าย
   * กันกรณีมีใครเรียก adapter ตรง ๆ โดยไม่ผ่าน engine
   */
  isEligible(ctx: SendContext): { ok: true } | { ok: false; reason_th: string };

  /** ประกอบ payload ตามรูปแบบของช่องทางนั้น */
  build(ctx: SendContext, recipientPsid: string): BuildResult;

  /** ยิงออกไปจริง — ทุกตัวเรียกผ่าน client กลางตัวเดียวกัน */
  send(page: MetaPage, payload: MetaSendPayload): Promise<MetaSendResult>;
};
