/**
 * Message Policy Engine — ชนิดข้อมูลกลาง (สเปกหัวข้อ 6.1)
 * ===========================================================================
 * ไฟล์นี้คือ "สัญญา" ของการส่งข้อความทั้งระบบ
 *
 * กฎเหล็กที่ไฟล์อื่นต้องเคารพ :
 *   1. ทุกการส่งข้อความต้องผ่าน engine นี้เท่านั้น ไม่มีข้อยกเว้น
 *      (แอดมินกดส่งเอง / บอทคีย์เวิร์ดตอบ / scheduler ส่ง follow-up)
 *   2. ห้ามเขียน `if (อายุ > 24 ชม.) ...` ไว้ที่อื่นเด็ดขาด
 *      ตัวเลขและเงื่อนไขทั้งหมดอยู่ใน src/server/policy/config.ts ที่เดียว
 *   3. `message_type` ต้องมาจาก "บริบท" เท่านั้น ห้ามเดาจากเนื้อข้อความ
 *      (ไม่มี regex เดาว่าเป็นข้อความขายหรือไม่ที่ไหนในระบบ)
 *   4. แอดมินไม่เลือก transport เอง — backend เลือกให้ทั้งหมด
 */

export type Channel = 'messenger' | 'instagram';

export type Transport = 'STANDARD' | 'HUMAN_AGENT' | 'UTILITY' | 'MARKETING';

export type MessageType =
  | 'inquiry_response'      // แอดมินตอบคำถามลูกค้าด้วยตัวเอง
  | 'order_update'          // อัปเดตสถานะออเดอร์
  | 'shipping_update'       // แจ้งเลขพัสดุ
  | 'appointment_reminder'  // เตือนนัดหมาย
  | 'promotion'             // ข้อความขาย
  | 'upsell';               // เสนอสินค้าเพิ่ม

export type TriggeredBy = 'admin' | 'bot' | 'scheduler';

/** ลำดับการลอง transport — เลขน้อยลองก่อน (ตามตารางในสเปก 6.1) */
export const TRANSPORT_PRIORITY: Transport[] = ['STANDARD', 'HUMAN_AGENT', 'UTILITY', 'MARKETING'];

/* ------------------------------------------------------------------------ */
/* สิ่งที่ผู้เรียกส่งเข้ามา                                                    */
/* ------------------------------------------------------------------------ */

export type SendContent = {
  text?: string;
  /** รูปที่แนบ — ใช้ attachment_id ที่อัปโหลดไว้แล้วเป็นหลัก (สเปก 6.2) */
  images?: Array<{ meta_attachment_id?: string; url?: string }>;
  /** ใช้กับ transport ที่ต้องใช้เทมเพลตที่ได้รับอนุมัติ */
  template_name?: string;
  template_params?: Record<string, string>;

  /**
   * ⭐ mid ของข้อความที่กำลังตอบกลับ (สำหรับ reply_to.mid ของ Meta)
   *
   * 🔴 ค่านี้ต้องถูก "แปลงมาจาก id ข้อความในระบบเรา" ที่ฝั่งเซิร์ฟเวอร์เท่านั้น
   *    ห้ามรับมาจากหน้าเว็บโดยตรงเด็ดขาด ไม่งั้นจะยัด mid ของห้องอื่นมาได้
   *    (ดู resolve_reply_target ใน migration 0015)
   *
   * ⚠️ ใส่มาไม่ได้แปลว่าจะถูกส่ง — adapter จะใส่ลง payload
   *    ก็ต่อเมื่อช่องทางนั้นรองรับจริงตาม policy config
   */
  reply_to_meta_mid?: string | null;
};

/**
 * ที่มาของคำสั่งส่ง — มุมมองเชิงโครงสร้างที่ engine ใช้ตัดสิน
 * ⚠️ ตัวจริงที่มีตราประทับอยู่ที่ src/server/messaging/provenance.ts
 *    ที่แยกไว้เพราะ engine ต้องเป็นฟังก์ชันบริสุทธิ์ ทดสอบได้โดยไม่ต้องมี session
 *    การตรวจว่า "ของจริงหรือของปลอม" เกิดที่ประตูทางเข้า (sendMessage) ก่อนถึง engine
 */
export type SendProvenance = {
  readonly kind: string;
  readonly triggered_by: TriggeredBy;
  /** true ได้เฉพาะข้อความที่แอดมินตัวจริงพิมพ์เองผ่าน session ที่ตรวจแล้ว */
  readonly human_authored: boolean;
  readonly admin_id: string | null;
};

/** ชื่อ kind ที่ถือว่าเป็น "คนพิมพ์เอง" — มีตัวเดียวโดยตั้งใจ */
export const HUMAN_PROVENANCE_KIND = 'human_admin_reply';

/**
 * บริบทที่ engine ใช้ตัดสิน
 * ⚠️ ทุกฟิลด์ในนี้ต้องถูก "ดึงมาจากฐานข้อมูล" โดย sendMessage
 *    ไม่ใช่รับมาจากผู้เรียกตรง ๆ (กันการส่งข้ามลูกค้า/ข้ามเพจ)
 */
export type SendContext = {
  customer_id: string;
  conversation_id: string;
  page_id: string;
  channel: Channel;

  /** มาจากบริบทเท่านั้น ห้ามเดาจากเนื้อข้อความ */
  message_type: MessageType;

  /** ที่มาที่เชื่อถือได้ — ผู้เรียกทั่วไปสร้างเองไม่ได้ */
  provenance: SendProvenance;

  content: SendContent;

  /** กันส่งซ้ำ — ฐานข้อมูลเป็นคนบังคับ ไม่ใช่โค้ด */
  idempotency_key?: string | null;
};

/* ------------------------------------------------------------------------ */
/* ข้อเท็จจริงที่ engine ใช้ตัดสิน                                            */
/* ------------------------------------------------------------------------ */

/**
 * สถานะของลูกค้า ณ เวลาที่จะส่ง
 * แยกออกมาเป็นพารามิเตอร์ตั้งใจ เพื่อให้ decide() เป็นฟังก์ชันบริสุทธิ์
 * ทดสอบได้ 100% โดยไม่ต้องต่อฐานข้อมูลและไม่ต้องรอเวลาจริง
 */
export type PolicyState = {
  /** ลูกค้าทักมาครั้งล่าสุดเมื่อไหร่ — null = ยังไม่เคยทักเลย */
  last_customer_message_at: Date | null;
  /** ผลการเช็ค eligibility ของ Marketing Messages รายบุคคล */
  marketing_eligible: boolean;
  marketing_checked_at: Date | null;
  /**
   * ครั้งล่าสุดที่ "Meta บอกเรา" ว่าส่งไม่ได้แล้ว
   * ⚠️ นี่คือสิ่งที่เราสังเกตเห็น ไม่ใช่ประวัติข้อความจริง — เก็บคนละตาราง
   *    ถ้าลูกค้าทักกลับมาหลังเวลานี้ ถือว่าข้อสังเกตเก่าใช้ไม่ได้แล้ว
   */
  window_closed_observed_at: Date | null;
  /** เวลาปัจจุบัน — ฉีดเข้ามาเพื่อให้ทดสอบเวลาผ่านไปได้ */
  now: Date;
};

/* ------------------------------------------------------------------------ */
/* ผลการตัดสิน                                                               */
/* ------------------------------------------------------------------------ */

/** บันทึกว่าแต่ละ transport ผ่าน/ไม่ผ่านเพราะอะไร — เก็บลง send_attempts ไว้ตรวจย้อนหลัง */
export type EvaluationStep = {
  transport: Transport;
  eligible: boolean;
  reason_code: ReasonCode;
};

export type PolicyDecision = {
  allowed: boolean;
  transport: Transport | null;
  reason_code: ReasonCode;
  /** ข้อความที่แอดมินอ่านแล้วรู้เรื่องและรู้ว่าต้องทำอะไรต่อ */
  reason_th: string;
  /** ช่องทางนี้ใช้ได้ถึงเมื่อไหร่ (ISO string) — null = ไม่ผูกกับเวลา */
  expires_at: string | null;
  /** ค่าใช้จ่ายโดยประมาณ (บาท) — null = ฟรี */
  estimated_cost: number | null;
  /** ทางเลือกที่แอดมินพอทำได้ ถ้าส่งไม่ได้ */
  alternatives_th: string[];
  evaluated: EvaluationStep[];
};

/* ------------------------------------------------------------------------ */
/* รหัสเหตุผล + คำอธิบายภาษาไทย                                              */
/* ------------------------------------------------------------------------ */

export const REASON = {
  // ผ่าน
  OK_STANDARD_WINDOW: 'OK_STANDARD_WINDOW',
  OK_HUMAN_AGENT_WINDOW: 'OK_HUMAN_AGENT_WINDOW',
  OK_UTILITY_TEMPLATE: 'OK_UTILITY_TEMPLATE',
  OK_MARKETING_ELIGIBLE: 'OK_MARKETING_ELIGIBLE',

  // ไม่ผ่าน
  NO_TRANSPORT_AVAILABLE: 'NO_TRANSPORT_AVAILABLE',
  TRANSPORT_DISABLED: 'TRANSPORT_DISABLED',
  TRANSPORT_UNVERIFIED: 'TRANSPORT_UNVERIFIED',
  CHANNEL_NOT_SUPPORTED: 'CHANNEL_NOT_SUPPORTED',
  OUTSIDE_WINDOW: 'OUTSIDE_WINDOW',
  NO_CUSTOMER_MESSAGE_YET: 'NO_CUSTOMER_MESSAGE_YET',
  MESSAGE_TYPE_NOT_ALLOWED: 'MESSAGE_TYPE_NOT_ALLOWED',
  REQUIRES_HUMAN_TYPED: 'REQUIRES_HUMAN_TYPED',
  MARKETING_NOT_ELIGIBLE: 'MARKETING_NOT_ELIGIBLE',
  MARKETING_ELIGIBILITY_STALE: 'MARKETING_ELIGIBILITY_STALE',
  TEMPLATE_REQUIRED: 'TEMPLATE_REQUIRED',
  EMPTY_CONTENT: 'EMPTY_CONTENT',
  WINDOW_CLOSED_BY_META: 'WINDOW_CLOSED_BY_META',
  UNTRUSTED_PROVENANCE: 'UNTRUSTED_PROVENANCE',
  CONTEXT_MISMATCH: 'CONTEXT_MISMATCH',

  // ผลลัพธ์ตอนส่งจริง (ไม่ได้มาจาก decide แต่ใช้ code เดียวกันใน send_attempts)
  SENT_OK: 'SENT_OK',
  META_TRANSIENT_ERROR: 'META_TRANSIENT_ERROR',
  META_POLICY_ERROR: 'META_POLICY_ERROR',
  META_UNKNOWN_ERROR: 'META_UNKNOWN_ERROR',
  ADAPTER_NOT_CONFIGURED: 'ADAPTER_NOT_CONFIGURED',
  CONTEXT_NOT_FOUND: 'CONTEXT_NOT_FOUND',
  DUPLICATE_SKIPPED: 'DUPLICATE_SKIPPED',
  META_OUTCOME_UNKNOWN: 'META_OUTCOME_UNKNOWN',
  SEND_IN_PROGRESS: 'SEND_IN_PROGRESS',
} as const;

export type ReasonCode = (typeof REASON)[keyof typeof REASON];

export const REASON_TH: Record<ReasonCode, string> = {
  OK_STANDARD_WINDOW: 'ส่งได้ตามปกติ',
  OK_HUMAN_AGENT_WINDOW: 'ส่งได้ในฐานะเจ้าหน้าที่ตอบคำถามลูกค้า',
  OK_UTILITY_TEMPLATE: 'ส่งได้ในรูปแบบข้อความแจ้งข้อมูล',
  OK_MARKETING_ELIGIBLE: 'ส่งได้ในรูปแบบข้อความการตลาด (มีค่าใช้จ่าย)',

  NO_TRANSPORT_AVAILABLE: 'ตอนนี้ยังส่งข้อความหาลูกค้ารายนี้ไม่ได้ตามกฎของ Meta',
  TRANSPORT_DISABLED: 'ช่องทางนี้ถูกปิดไว้ในการตั้งค่าระบบ',
  TRANSPORT_UNVERIFIED: 'ช่องทางนี้ยังไม่ได้ยืนยันกับเอกสารของ Meta และยังไม่ได้รับอนุมัติ',
  CHANNEL_NOT_SUPPORTED: 'ช่องทางนี้ใช้กับแพลตฟอร์มนี้ไม่ได้',
  OUTSIDE_WINDOW: 'เลยกรอบเวลาที่ Meta อนุญาตให้ส่งแล้ว',
  NO_CUSTOMER_MESSAGE_YET: 'ลูกค้ายังไม่เคยทักเข้ามา จึงยังส่งหาก่อนไม่ได้',
  MESSAGE_TYPE_NOT_ALLOWED: 'ข้อความประเภทนี้ส่งผ่านช่องทางนี้ไม่ได้',
  REQUIRES_HUMAN_TYPED: 'ช่องทางนี้ใช้ได้เฉพาะข้อความที่แอดมินพิมพ์เอง ระบบอัตโนมัติใช้ไม่ได้',
  MARKETING_NOT_ELIGIBLE: 'ลูกค้ารายนี้ไม่เข้าเกณฑ์รับข้อความการตลาด',
  MARKETING_ELIGIBILITY_STALE: 'ผลการตรวจสิทธิ์รับข้อความการตลาดเก่าเกินไป ต้องตรวจใหม่ก่อนส่ง',
  TEMPLATE_REQUIRED: 'ช่องทางนี้ต้องใช้เทมเพลตที่ได้รับอนุมัติ',
  EMPTY_CONTENT: 'ไม่มีเนื้อหาที่จะส่ง',
  WINDOW_CLOSED_BY_META: 'Meta เคยแจ้งว่าส่งหาลูกค้ารายนี้ไม่ได้แล้ว ต้องรอให้ลูกค้าทักกลับมาก่อน',
  UNTRUSTED_PROVENANCE: 'คำสั่งส่งนี้ไม่ผ่านการยืนยันแหล่งที่มา จึงถูกปฏิเสธ',
  CONTEXT_MISMATCH: 'ข้อมูลลูกค้า ห้องแชท และเพจไม่สัมพันธ์กัน จึงไม่ส่งเพื่อความปลอดภัย',

  SENT_OK: 'ส่งสำเร็จ',
  META_TRANSIENT_ERROR: 'ระบบของ Meta ขัดข้องชั่วคราว ระบบจะลองใหม่ให้อัตโนมัติ',
  META_POLICY_ERROR: 'Meta ปฏิเสธการส่งด้วยเหตุผลด้านนโยบาย — จะไม่ลองส่งซ้ำ',
  META_UNKNOWN_ERROR: 'ส่งไม่สำเร็จด้วยสาเหตุที่ยังไม่รู้จัก',
  ADAPTER_NOT_CONFIGURED: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อกับ Meta',
  CONTEXT_NOT_FOUND: 'ข้อมูลตั้งต้นไม่ครบ จึงยังส่งไม่ได้',
  DUPLICATE_SKIPPED: 'ข้อความนี้เคยส่งไปแล้ว ระบบข้ามให้เพื่อไม่ให้ลูกค้าได้รับซ้ำ',
  META_OUTCOME_UNKNOWN: 'ส่งออกไปแล้วแต่ไม่ได้รับคำตอบจาก Meta จึงไม่ทราบว่าถึงลูกค้าหรือไม่ — ระบบจะไม่ส่งซ้ำอัตโนมัติ กรุณาตรวจสอบในแชทก่อนส่งใหม่',
  SEND_IN_PROGRESS: 'ข้อความนี้กำลังถูกส่งอยู่โดยคำขออื่น ระบบจึงไม่ส่งซ้ำ',
};

/**
 * ป้ายที่โชว์ใต้ข้อความในห้องแชท (สเปก 6.1 หัวข้อ "UI ฝั่งแอดมิน")
 * แอดมินไม่ต้องรู้จัก Meta policy — เห็นแค่ป้ายสั้น ๆ ว่าส่งด้วยช่องทางไหน
 */
export const TRANSPORT_BADGE_TH: Record<Transport, string> = {
  STANDARD: 'ส่งปกติ',
  HUMAN_AGENT: 'Human Agent',
  UTILITY: 'Utility',
  MARKETING: 'Marketing',
};

export const BLOCKED_BADGE_TH = 'ส่งไม่ได้ตาม Meta';

/**
 * ตัวช่วยกำหนด message_type จากบริบท — ห้ามเดาจากเนื้อข้อความ
 * แอดมินพิมพ์ตอบในห้องแชท = inquiry_response เสมอ (สเปก 6.1 กฎเหล็กข้อ 4)
 */
export function messageTypeForAdminChatReply(): MessageType {
  return 'inquiry_response';
}
