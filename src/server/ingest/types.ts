/**
 * รูปแบบกลางของ "เหตุการณ์" ที่แปลงมาจาก webhook ของ Meta แล้ว
 * ===========================================================================
 * ทำไมต้องมีรูปแบบกลาง :
 *   Messenger กับ Instagram ส่ง JSON หน้าตาคล้ายกันแต่ไม่เหมือนกัน
 *   ถ้าปล่อยให้โค้ดที่บันทึกลงฐานข้อมูลไปแกะ JSON ดิบเอง
 *   วันหนึ่ง Meta เปลี่ยนรูปแบบ เราจะต้องไล่แก้หลายที่และพลาดแน่นอน
 *
 *   จึงแยกเป็นสองชั้นชัดเจน :
 *     ชั้นที่ 1  parse.ts     — แกะ JSON ดิบ → เหตุการณ์กลาง (ฟังก์ชันบริสุทธิ์ ทดสอบง่าย)
 *     ชั้นที่ 2  processor.ts — เอาเหตุการณ์กลางไปบันทึกลงฐานข้อมูล
 *
 * ⚠️ ไฟล์นี้ห้ามมีตรรกะ ห้ามมีการเรียกฐานข้อมูล — เป็นแค่คำนิยามชนิดข้อมูล
 */
import type { Platform, ReferralSource } from '@/types/db';

/** ไฟล์แนบที่มากับข้อความ */
export type IngestAttachment = {
  /** image | video | audio | file | ... ตามที่ Meta บอกมา */
  type: string;
  /**
   * ⚠️ ลิงก์นี้ "หมดอายุ" — Meta ใส่ token ไว้ในลิงก์ด้วยเหตุผลด้านความเป็นส่วนตัว
   *    สเปกหัวข้อ 6.2 บอกว่าต้องรีบดาวน์โหลดเก็บขึ้น R2 ทันที
   *    รอบนี้ยังไม่มี R2 จึงเก็บลิงก์ไว้ก่อน และจดไว้ใน DEFERRED_REVIEW (D-17)
   */
  url?: string;
  /** id ของไฟล์ฝั่ง Meta (มีเฉพาะบางชนิด) */
  meta_attachment_id?: string;
};

/** ที่มาของแชท — สเปกหัวข้อ 1 ข้อ 4 : ต้องรู้ว่ามาจากแอดไหน */
export type IngestReferral = {
  source: ReferralSource | null;
  ad_id: string | null;
  post_id: string | null;
  ref: string | null;
};

export const EMPTY_REFERRAL: IngestReferral = {
  source: null,
  ad_id: null,
  post_id: null,
  ref: null,
};

/** ข้อความที่ลูกค้าทักเข้ามา */
export type InboundMessageEvent = {
  kind: 'inbound_message';
  platform: Platform;
  /** id ของเพจฝั่ง Meta (ไม่ใช่ uuid ในฐานข้อมูลเรา) */
  page_meta_id: string;
  /** id ของลูกค้าฝั่ง Meta */
  psid: string;
  meta_message_id: string;
  text: string | null;
  attachments: IngestAttachment[];
  sent_at: string;
  referral: IngestReferral;
};

/**
 * สำเนาข้อความที่ "เพจ" ส่งออกไป (Meta เรียกว่า echo)
 * รวมถึงข้อความที่แอดมินตอบจาก Business Suite หรือแอป Messenger บนมือถือ
 */
export type EchoMessageEvent = {
  kind: 'echo_message';
  platform: Platform;
  page_meta_id: string;
  /** ปลายทาง = ลูกค้า (echo สลับ sender/recipient กับข้อความขาเข้า) */
  psid: string;
  meta_message_id: string;
  text: string | null;
  attachments: IngestAttachment[];
  sent_at: string;
};

/** เหตุการณ์ที่เรารับรู้แต่ยังไม่ทำอะไรในรอบนี้ (เก็บเหตุผลไว้ดูตอนแก้ปัญหา) */
export type IgnoredEvent = {
  kind: 'ignored';
  reason: string;
  platform: Platform | null;
  page_meta_id: string | null;
};

export type IngestEvent = InboundMessageEvent | EchoMessageEvent | IgnoredEvent;
