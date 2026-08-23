/**
 * กฎของ Meta — อยู่ที่ไฟล์นี้ "ที่เดียว" ในทั้งระบบ
 * ===========================================================================
 * ⚠️ ถ้าเจอตัวเลขเวลาหรือเงื่อนไขของ Meta อยู่ในไฟล์อื่น = ผิด ให้ย้ายมาที่นี่
 *
 * ทำไมต้องรวมไว้ที่เดียว :
 *   Meta เปลี่ยนกฎบ่อยมาก ถ้ากระจายอยู่ในหน้าแชท/ในบอท/ใน scheduler
 *   พอกฎเปลี่ยนทีต้องไล่แก้ทั้งระบบ และมักลืมบางจุดจนส่งผิดนโยบาย
 *   รวมไว้ที่นี่ = เปลี่ยนกฎทีเดียว มีผลทุกจุดที่ส่งข้อความ
 *
 * ⚠️ Messenger กับ Instagram "ไม่เหมือนกัน"
 *   ห้ามสมมติว่าอะไรที่ทำได้บน Messenger จะทำได้บน Instagram ด้วย
 *   ตารางด้านล่างจึงแยกกันคนละชุดโดยตั้งใจ
 *
 * ค่าเริ่มต้นทั้งหมดตั้งใจตั้งไว้แบบ "ปิดก่อน" (default deny)
 *   ช่องทางไหนยังไม่ได้ยืนยันกับเอกสาร Meta และยังไม่ได้รับอนุมัติจริง
 *   จะเปิดใช้ไม่ได้ ต้องไปเปิดใน .env.local เองหลังตรวจสอบแล้วเท่านั้น
 */
import type { Channel, MessageType, Transport } from './types';

export type TransportCapability = {
  /** เปิดใช้ช่องทางนี้ไหม — เปิด/ปิดได้จาก env โดยไม่ต้องแก้โค้ด */
  enabled: boolean;

  /**
   * ยืนยันกับเอกสารของ Meta แล้วหรือยัง + ได้รับอนุมัติ permission แล้วหรือยัง
   * ถ้ายัง engine จะไม่เลือกช่องทางนี้ ถึงจะ enabled ก็ตาม
   * (ตัวกันพลาดชั้นสอง — เปิดผิดแล้วเพจโดนระงับ แก้ไม่ทัน)
   */
  verified: boolean;

  /**
   * กรอบเวลานับจาก "ข้อความล่าสุดที่ลูกค้าส่งมา"
   * null = ช่องทางนี้ไม่ผูกกับกรอบเวลา
   */
  window_hours: number | null;

  /** ข้อความประเภทไหนบ้างที่ส่งผ่านช่องทางนี้ได้ */
  allowed_message_types: MessageType[];

  /** ต้องเป็นข้อความที่คนพิมพ์เองเท่านั้นไหม (กันบอทแอบใช้) */
  requires_human_typed: boolean;

  /** ต้องใช้เทมเพลตที่ได้รับอนุมัติไหม */
  requires_template: boolean;

  /** ต้องเช็ค eligibility รายบุคคลก่อนส่งไหม */
  requires_marketing_eligibility: boolean;

  /** ค่าใช้จ่ายโดยประมาณต่อข้อความ (บาท) — null = ฟรี */
  estimated_cost: number | null;
};

export type ChannelPolicy = Record<Transport, TransportCapability>;
export type PolicyConfig = {
  channels: Record<Channel, ChannelPolicy>;
  /** ผลตรวจ eligibility เก่าเกินกี่ชั่วโมงถือว่าใช้ไม่ได้ ต้องตรวจใหม่ */
  marketing_eligibility_max_age_hours: number;
  /**
   * ยอมให้ใช้ช่องทางที่ยังไม่ยืนยันไหม
   * ตั้ง true ได้เฉพาะตอนทดสอบในเครื่องเท่านั้น ห้ามตั้งบนเครื่องจริง
   */
  allow_unverified: boolean;
};

/* ------------------------------------------------------------------------ */
/* ตัวช่วยอ่านค่าจาก env                                                       */
/* ------------------------------------------------------------------------ */

type EnvBag = Record<string, string | undefined>;

function bool(env: EnvBag, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const s = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  throw new Error(`ค่า ${key} ต้องเป็น true หรือ false เท่านั้น (ได้รับ: "${raw}")`);
}

function num(env: EnvBag, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`ค่า ${key} ต้องเป็นตัวเลขไม่ติดลบ (ได้รับ: "${raw}")`);
  }
  return n;
}

/* ------------------------------------------------------------------------ */
/* ตารางกฎ                                                                    */
/* ------------------------------------------------------------------------ */

/** ประเภทข้อความที่ถือว่าเป็น "การขาย" — ห้ามเนียนส่งผ่านช่องทางอื่นเด็ดขาด */
export const MARKETING_MESSAGE_TYPES: MessageType[] = ['promotion', 'upsell'];

/** ประเภทข้อความที่เป็นการแจ้งข้อมูลล้วน */
export const UTILITY_MESSAGE_TYPES: MessageType[] = [
  'order_update',
  'shipping_update',
  'appointment_reminder',
];

const ALL_MESSAGE_TYPES: MessageType[] = [
  'inquiry_response',
  'order_update',
  'shipping_update',
  'appointment_reminder',
  'promotion',
  'upsell',
];

function messengerPolicy(env: EnvBag): ChannelPolicy {
  return {
    /**
     * 1. STANDARD — อยู่ในกรอบเวลาปกติหลังลูกค้าทักมา ส่งอะไรก็ได้
     *    ค่าเริ่มต้น 24 ชั่วโมง ปรับได้จาก env ถ้า Meta เปลี่ยนกฎ
     */
    STANDARD: {
      enabled: bool(env, 'POLICY_MESSENGER_STANDARD_ENABLED', true),
      verified: bool(env, 'POLICY_MESSENGER_STANDARD_VERIFIED', true),
      window_hours: num(env, 'POLICY_MESSENGER_STANDARD_WINDOW_HOURS', 24),
      allowed_message_types: ALL_MESSAGE_TYPES,
      requires_human_typed: false,
      requires_template: false,
      requires_marketing_eligibility: false,
      estimated_cost: null,
    },

    /**
     * 2. HUMAN_AGENT — พ้นกรอบปกติแล้ว แต่ยังตอบคำถามลูกค้าได้
     *    ⚠️ ใช้ได้เฉพาะข้อความที่ "คนพิมพ์จริง" เพื่อตอบคำถามลูกค้าเท่านั้น
     *       ห้ามใช้กับบอทคีย์เวิร์ด follow-up อัตโนมัติ หรือข้อความขาย
     *       ผิดนโยบาย = เสี่ยงโดนระงับแอป
     *    ต้องผ่าน App Review ก่อน จึงตั้ง verified=false ไว้เป็นค่าเริ่มต้น
     */
    HUMAN_AGENT: {
      enabled: bool(env, 'POLICY_MESSENGER_HUMAN_AGENT_ENABLED', false),
      verified: bool(env, 'POLICY_MESSENGER_HUMAN_AGENT_VERIFIED', false),
      window_hours: num(env, 'POLICY_MESSENGER_HUMAN_AGENT_WINDOW_HOURS', 168), // 7 วัน
      allowed_message_types: ['inquiry_response'], // ← เท่านั้น ห้ามเพิ่ม
      requires_human_typed: true,
      requires_template: false,
      requires_marketing_eligibility: false,
      estimated_cost: null,
    },

    /**
     * 3. UTILITY — ข้อความแจ้งข้อมูลล้วนโดยใช้เทมเพลตที่ได้รับอนุมัติ
     *    ⚠️ ต้องยืนยันกับเอกสาร Meta ก่อนว่าใช้ได้จริงและได้รับ permission แล้ว
     *    ⚠️ ห้ามแทรกการขายในข้อความประเภทนี้เด็ดขาด
     *    หมายเหตุ : ระบบนี้ "ไม่มี" ทางถอยไปใช้ message tag แบบเก่า
     *              (POST_PURCHASE_UPDATE / ACCOUNT_UPDATE / CONFIRMED_EVENT_UPDATE)
     *              เพราะ Meta ทยอยเลิกรองรับแล้ว การพึ่งของที่กำลังจะหายไปคือหนี้
     */
    UTILITY: {
      enabled: bool(env, 'POLICY_MESSENGER_UTILITY_ENABLED', false),
      verified: bool(env, 'POLICY_MESSENGER_UTILITY_VERIFIED', false),
      window_hours: null, // ไม่ผูกกับกรอบเวลา แต่ผูกกับเทมเพลตที่อนุมัติแล้ว
      allowed_message_types: UTILITY_MESSAGE_TYPES,
      requires_human_typed: false,
      requires_template: true,
      requires_marketing_eligibility: false,
      estimated_cost: num(env, 'POLICY_MESSENGER_UTILITY_COST', 0) || null,
    },

    /**
     * 4. MARKETING — ข้อความขาย เสียเงินรายข้อความ
     *    ต้องเช็ค eligibility รายบุคคลก่อนทุกครั้ง และแสดงค่าใช้จ่ายให้แอดมินเห็นก่อนส่ง
     */
    MARKETING: {
      enabled: bool(env, 'POLICY_MESSENGER_MARKETING_ENABLED', false),
      verified: bool(env, 'POLICY_MESSENGER_MARKETING_VERIFIED', false),
      window_hours: null,
      allowed_message_types: MARKETING_MESSAGE_TYPES,
      requires_human_typed: false,
      requires_template: true,
      requires_marketing_eligibility: true,
      estimated_cost: num(env, 'POLICY_MESSENGER_MARKETING_COST', 0) || null,
    },
  };
}

function instagramPolicy(env: EnvBag): ChannelPolicy {
  return {
    STANDARD: {
      enabled: bool(env, 'POLICY_INSTAGRAM_STANDARD_ENABLED', true),
      verified: bool(env, 'POLICY_INSTAGRAM_STANDARD_VERIFIED', true),
      window_hours: num(env, 'POLICY_INSTAGRAM_STANDARD_WINDOW_HOURS', 24),
      allowed_message_types: ALL_MESSAGE_TYPES,
      requires_human_typed: false,
      requires_template: false,
      requires_marketing_eligibility: false,
      estimated_cost: null,
    },

    HUMAN_AGENT: {
      enabled: bool(env, 'POLICY_INSTAGRAM_HUMAN_AGENT_ENABLED', false),
      verified: bool(env, 'POLICY_INSTAGRAM_HUMAN_AGENT_VERIFIED', false),
      window_hours: num(env, 'POLICY_INSTAGRAM_HUMAN_AGENT_WINDOW_HOURS', 168),
      allowed_message_types: ['inquiry_response'],
      requires_human_typed: true,
      requires_template: false,
      requires_marketing_eligibility: false,
      estimated_cost: null,
    },

    /**
     * ⚠️ Instagram ปิดตายไว้ทั้งสองตัว
     *    ยังไม่ได้ยืนยันว่า Instagram มีช่องทาง Utility / Marketing แบบเดียวกับ
     *    Messenger จริงหรือไม่ — และ "การสมมติว่าเหมือนกัน" คือความผิดพลาด
     *    ที่ทำให้ส่งผิดนโยบายได้ง่ายที่สุด
     *    จะเปิดใช้ได้ต้องตั้ง env เองหลังอ่านเอกสารของ Meta แล้วเท่านั้น
     */
    UTILITY: {
      enabled: bool(env, 'POLICY_INSTAGRAM_UTILITY_ENABLED', false),
      verified: bool(env, 'POLICY_INSTAGRAM_UTILITY_VERIFIED', false),
      window_hours: null,
      allowed_message_types: UTILITY_MESSAGE_TYPES,
      requires_human_typed: false,
      requires_template: true,
      requires_marketing_eligibility: false,
      estimated_cost: num(env, 'POLICY_INSTAGRAM_UTILITY_COST', 0) || null,
    },

    MARKETING: {
      enabled: bool(env, 'POLICY_INSTAGRAM_MARKETING_ENABLED', false),
      verified: bool(env, 'POLICY_INSTAGRAM_MARKETING_VERIFIED', false),
      window_hours: null,
      allowed_message_types: MARKETING_MESSAGE_TYPES,
      requires_human_typed: false,
      requires_template: true,
      requires_marketing_eligibility: true,
      estimated_cost: num(env, 'POLICY_INSTAGRAM_MARKETING_COST', 0) || null,
    },
  };
}

/**
 * อ่านกฎทั้งหมดจาก env — ส่ง env จำลองเข้ามาได้ตอนทดสอบ
 *
 * 🔴 ตัวกันพลาดสำคัญ : บนเครื่องจริง (production) ห้ามเปิด allow_unverified เด็ดขาด
 *    เพราะสวิตช์นี้ข้ามด่าน "ยืนยันกับเอกสาร Meta แล้วหรือยัง" ทั้งหมด
 *    ถ้าเผลอตั้งไว้บนเครื่องจริง ระบบจะไม่ยอมสตาร์ต ดีกว่าปล่อยให้ส่งผิดนโยบายเงียบ ๆ
 */
export function loadPolicyConfig(env: EnvBag = process.env): PolicyConfig {
  const allowUnverified = bool(env, 'POLICY_ALLOW_UNVERIFIED_TRANSPORTS', false);
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase();

  if (allowUnverified && nodeEnv === 'production') {
    throw new Error(
      '\n[ตั้งค่าผิดพลาดร้ายแรง] POLICY_ALLOW_UNVERIFIED_TRANSPORTS=true บนเครื่องจริง\n' +
        '  สวิตช์นี้ข้ามด่านตรวจว่าได้รับอนุมัติจาก Meta แล้วหรือยัง ใช้ได้เฉพาะตอนทดสอบในเครื่อง\n' +
        '  ให้ลบบรรทัดนี้ออกจาก environment ของเครื่องจริง แล้วสตาร์ตใหม่\n',
    );
  }

  return {
    channels: {
      messenger: messengerPolicy(env),
      instagram: instagramPolicy(env),
    },
    marketing_eligibility_max_age_hours: num(env, 'POLICY_MARKETING_ELIGIBILITY_MAX_AGE_HOURS', 24),
    allow_unverified: allowUnverified,
  };
}

/** อ่านครั้งเดียวแล้วจำไว้ (ค่าไม่เปลี่ยนระหว่างรัน) */
let _cached: PolicyConfig | null = null;
export function policyConfig(): PolicyConfig {
  if (!_cached) _cached = loadPolicyConfig();
  return _cached;
}

/** ใช้ในชุดทดสอบเท่านั้น — ล้างค่าที่จำไว้ */
export function resetPolicyConfigCache(): void {
  _cached = null;
}
