import 'server-only';
/**
 * Provenance — "ใครสั่งให้ส่งข้อความนี้จริง ๆ"
 * ===========================================================================
 * 🔴 ไฟล์นี้คือเส้นแบ่งความเชื่อใจของทั้งระบบ
 *
 * ปัญหาเดิม :
 *   ก่อนหน้านี้ผู้เรียกส่งค่า `triggered_by: 'admin'` กับ `human_typed: true`
 *   เข้ามาเองได้ แปลว่าโค้ดอัตโนมัติตัวไหนก็ "อ้างว่าเป็นคน" ได้
 *   ซึ่งอันตรายมาก เพราะ HUMAN_AGENT ใช้ได้เฉพาะข้อความที่คนพิมพ์จริง
 *   ถ้าบอทแอบใช้ = ผิดนโยบาย Meta = เสี่ยงโดนระงับแอป
 *
 * วิธีแก้ :
 *   1. สร้าง Provenance ได้จากโรงงานในไฟล์นี้เท่านั้น
 *   2. โรงงานของ "คน" (humanAdminReply) ไปตรวจ session ของแอดมินจริง ๆ
 *      งานอัตโนมัติไม่มี cookie จึงเรียกไม่ผ่านโดยธรรมชาติ
 *   3. ติดตราประทับด้วย Symbol ที่ไม่ export ออกไป
 *      ต่อให้ใครเขียน object หน้าตาเหมือนกันเป๊ะ ก็ไม่มีตรานี้
 *      และ sendMessage จะปฏิเสธตั้งแต่ต้นทาง
 *
 * ⚠️ พูดตามตรง : นี่ไม่ใช่ sandbox ด้านความปลอดภัย
 *    โค้ดในโปรเซสเดียวกันที่ตั้งใจจะโกงย่อมหาทางได้เสมอ
 *    เป้าหมายคือทำให้ "เผลอทำผิดโดยไม่ตั้งใจ" เป็นไปไม่ได้ และให้ CI จับได้
 */
import { requireAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import type { TriggeredBy } from '@/server/policy/types';

/**
 * ตราประทับสองชั้น :
 *
 *   ชั้นที่ 1 — Symbol ที่ไม่ export ออกไป
 *     ทำให้ TypeScript ปฏิเสธ object ที่เขียนขึ้นเองตั้งแต่ตอนคอมไพล์
 *
 *   ชั้นที่ 2 — ทะเบียนของจริง (WeakSet)
 *     ⚠️ ชั้นนี้จำเป็นมาก : ชุดทดสอบพบว่าการก๊อปด้วย `{ ...ของจริง }`
 *        ลอก symbol ติดไปด้วย แปลว่าถ้าเช็คแค่ symbol
 *        โค้ดอัตโนมัติจะเอา provenance ของบอทมาก๊อปแล้วแก้เป็น "คนพิมพ์เอง" ได้
 *        การจำ "ตัวจริง" ไว้ใน WeakSet ปิดช่องนี้ เพราะสำเนาคือคนละ object
 *        (WeakSet ไม่กันหน่วยความจำรั่ว ของที่ไม่มีใครอ้างถึงแล้วถูกเก็บกวาดตามปกติ)
 */
const TRUSTED = Symbol('hubchat.trusted-provenance');
const MINTED = new WeakSet<object>();

/** ประเภทของแหล่งที่มา */
export type ProvenanceKind =
  | 'human_admin_reply'   // แอดมินตัวจริงพิมพ์ตอบในห้องแชท (ผ่านการตรวจ session แล้ว)
  | 'keyword_bot'         // บอทคีย์เวิร์ดตอบอัตโนมัติ
  | 'scheduler'           // งานตามเวลา เช่น follow-up
  | 'bulk_job'            // งานส่งเป็นชุด เช่น แจ้งเลขพัสดุจากไฟล์
  | 'system_automation';  // งานอัตโนมัติอื่น ๆ ของระบบ

export type Provenance = {
  readonly kind: ProvenanceKind;
  readonly triggered_by: TriggeredBy;
  /** เป็นข้อความที่คนพิมพ์เองจริงหรือไม่ — มีแค่ human_admin_reply เท่านั้นที่เป็น true */
  readonly human_authored: boolean;
  readonly admin_id: string | null;
  /** ตราประทับ — สร้างจากนอกไฟล์นี้ไม่ได้ */
  readonly [TRUSTED]: true;
};

function mint(
  kind: ProvenanceKind,
  triggered_by: TriggeredBy,
  human_authored: boolean,
  admin_id: string | null,
): Provenance {
  const value = Object.freeze({
    kind,
    triggered_by,
    human_authored,
    admin_id,
    [TRUSTED]: true as const,
  });
  MINTED.add(value);
  return value;
}

/**
 * ตรวจว่าเป็น Provenance ที่ออกจากไฟล์นี้จริงไหม
 * sendMessage เรียกตัวนี้ก่อนทำอะไรทั้งสิ้น
 */
export function isTrustedProvenance(value: unknown): value is Provenance {
  if (typeof value !== 'object' || value === null) return false;
  // ต้องเป็น "ตัวจริงที่ออกจากโรงงานนี้" เท่านั้น สำเนาไม่นับ
  if (!MINTED.has(value)) return false;
  return (value as Record<symbol, unknown>)[TRUSTED] === true;
}

/* ------------------------------------------------------------------------ */
/* โรงงานฝั่ง "คน" — ต้องมี session ของแอดมินจริงเท่านั้น                        */
/* ------------------------------------------------------------------------ */

export class ProvenanceDeniedError extends Error {
  constructor(public message_th: string) {
    super(message_th);
    this.name = 'ProvenanceDeniedError';
  }
}

/**
 * ใช้ได้เฉพาะตอนแอดมินตัวจริงกดส่งในห้องแชทเท่านั้น
 *
 * ⭐ ตัวนี้ไม่รับพารามิเตอร์ใด ๆ โดยตั้งใจ
 *    ตัวตนของผู้ส่งมาจาก cookie ที่ตรวจกับฐานข้อมูลแล้ว ไม่ได้มาจากคำอ้างของผู้เรียก
 *    งานเบื้องหลัง (scheduler / worker / คิว) ไม่มี cookie จึงเรียกไม่ผ่าน
 */
export async function humanAdminReply(): Promise<Provenance> {
  const admin = await requireAdmin(); // โยน AuthError ถ้าไม่มี session ที่ใช้ได้
  if (!can(admin.role, 'chat.reply')) {
    throw new ProvenanceDeniedError('บัญชีของคุณไม่มีสิทธิ์ตอบแชท');
  }
  return mint('human_admin_reply', 'admin', true, admin.id);
}

/* ------------------------------------------------------------------------ */
/* โรงงานฝั่งอัตโนมัติ — human_authored เป็น false เสมอ ไม่มีทางเลือกอื่น        */
/* ------------------------------------------------------------------------ */

/** บอทคีย์เวิร์ดตอบอัตโนมัติ */
export function keywordBotProvenance(): Provenance {
  return mint('keyword_bot', 'bot', false, null);
}

/** งานตามเวลา เช่น follow-up 3/7/14/30 วัน */
export function schedulerProvenance(): Provenance {
  return mint('scheduler', 'scheduler', false, null);
}

/**
 * งานส่งเป็นชุดที่แอดมินกดยืนยัน เช่น แจ้งเลขพัสดุจากไฟล์ขนส่ง
 * ⚠️ ถึงจะมีแอดมินกดยืนยัน ก็ยัง human_authored = false
 *    เพราะแอดมินไม่ได้พิมพ์ข้อความรายคน — เป็นการอนุมัติงานอัตโนมัติ
 *    จึงใช้ HUMAN_AGENT ไม่ได้ (สเปกหัวข้อ 6.1 กฎเหล็กข้อ 1)
 */
export function bulkJobProvenance(approvedByAdminId: string | null): Provenance {
  return mint('bulk_job', 'admin', false, approvedByAdminId);
}

/** งานอัตโนมัติอื่น ๆ ของระบบ */
export function systemAutomationProvenance(): Provenance {
  return mint('system_automation', 'scheduler', false, null);
}
