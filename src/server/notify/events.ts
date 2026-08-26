/**
 * กฎว่า "เหตุการณ์ไหน ใครควรได้รับแจ้งเตือน" (รอบ 10 — สเปกหัวข้อ 6.7)
 * ===========================================================================
 * ⚠️ ฟังก์ชันบริสุทธิ์ล้วน ๆ ห้ามต่อฐานข้อมูล ห้ามอ่านเวลาปัจจุบัน
 *
 * ⭐ ทำไมต้องแยกออกมา :
 *    แจ้งเตือนมากไป = แอดมินปิดทิ้ง แล้วระบบก็ไร้ประโยชน์
 *    แจ้งเตือนน้อยไป = ลูกค้ารอ
 *    กฎตรงนี้จึงต้องอ่านง่าย แก้ง่าย และทดสอบได้ทุกเคส
 *
 * 🔴 กุญแจกันซ้ำ (dedupe key) สำคัญที่สุด
 *    เหตุการณ์เดียว + คนเดียว + ช่องทางเดียว = แจ้งได้ครั้งเดียวตลอดกาล
 *    ฐานข้อมูลเป็นคนบังคับด้วย unique index
 */

export type NotifyEvent =
  | 'new_chat'        // ลูกค้าทักใหม่ ยังไม่มีคนรับ
  | 'reply'           // ลูกค้าตอบในแชทที่ฉันรับไว้
  | 'idle_15min'      // แชทเงียบเกิน 15 นาที ไม่มีคนตอบ
  | 'window_closing'  // ใกล้หมดกรอบ 24 ชม.
  | 'new_comment';    // คอมเมนต์ที่เข้าคำกรอง

export const ALL_EVENTS: NotifyEvent[] = [
  'new_chat', 'reply', 'idle_15min', 'window_closing', 'new_comment',
];

export const EVENT_LABEL_TH: Record<NotifyEvent, string> = {
  new_chat: 'ลูกค้าทักใหม่',
  reply: 'ลูกค้าตอบในแชทที่ฉันรับไว้',
  idle_15min: 'แชทเงียบเกิน 15 นาที',
  window_closing: 'ใกล้หมดกรอบ 24 ชั่วโมง',
  new_comment: 'คอมเมนต์ที่เข้าคำกรอง',
};

/** แอดมินหนึ่งคนเท่าที่กฎการแจ้งเตือนต้องรู้ */
export type NotifyAdmin = {
  id: string;
  role: 'owner' | 'admin' | 'viewer';
  allowed_page_ids: string[];
  is_active: boolean;
  enabled_events: string[];
  /** ว่าง = ทุกเพจที่มีสิทธิ์ */
  page_ids: string[];
};

export type NotifyContext = {
  event: NotifyEvent;
  page_id: string;
  /** แอดมินที่ "รับแชทนี้ไว้" — ใช้กับเหตุการณ์ที่ส่งเฉพาะคนที่รับ */
  assigned_admin_id?: string | null;
};

/**
 * เหตุการณ์ไหนส่งให้ใคร (ตามตารางในสเปก 6.7)
 *
 * | เหตุการณ์          | ใครได้รับ                    |
 * | new_chat          | ทุกคนที่ดูเพจนั้น              |
 * | reply             | เฉพาะคนที่รับแชท               |
 * | idle_15min        | ทุกคน                        |
 * | window_closing    | คนที่รับแชท                   |
 * | new_comment       | ทุกคน                        |
 */
export function shouldNotify(admin: NotifyAdmin, ctx: NotifyContext): boolean {
  // บัญชีที่ปิดใช้งานแล้ว ไม่ต้องแจ้งอะไรทั้งสิ้น
  if (!admin.is_active) return false;

  /**
   * 🔴 ผู้ดู (viewer) ตอบแชทไม่ได้ จึงไม่ควรได้แจ้งเตือนเรื่องแชท
   *    ถ้าแจ้งไป เขาจะกดเข้ามาแล้วทำอะไรไม่ได้ ซึ่งน่ารำคาญเปล่า ๆ
   */
  if (admin.role === 'viewer') return false;

  // ปิดเหตุการณ์นี้ไว้เอง
  if (!admin.enabled_events.includes(ctx.event)) return false;

  // ⭐ สิทธิ์รายเพจ — เจ้าของเห็นทุกเพจ คนอื่นเห็นเฉพาะที่ได้รับสิทธิ์
  if (admin.role !== 'owner' && !admin.allowed_page_ids.includes(ctx.page_id)) return false;

  // เลือกรับเฉพาะบางเพจเอง (ว่าง = ทุกเพจที่มีสิทธิ์)
  if (admin.page_ids.length > 0 && !admin.page_ids.includes(ctx.page_id)) return false;

  /**
   * เหตุการณ์ที่ส่งเฉพาะ "คนที่รับแชทไว้"
   * ⚠️ ถ้ายังไม่มีใครรับ ก็ไม่ต้องส่งให้ใคร — เดี๋ยว idle_15min จะเป็นคนเตือนเอง
   */
  if (ctx.event === 'reply' || ctx.event === 'window_closing') {
    return Boolean(ctx.assigned_admin_id) && ctx.assigned_admin_id === admin.id;
  }

  return true;
}

/**
 * ⭐ กุญแจกันซ้ำ
 *
 * 🔴 บทเรียนที่เกือบพลาด :
 *    ตาราง conversations มี unique index บน customer_id
 *    = ลูกค้าหนึ่งคนมี "ห้องแชทเดียวตลอดชีวิต" ไม่ได้เปิดห้องใหม่ทุกครั้งที่ทัก
 *
 *    ถ้ากุญแจกันซ้ำผูกกับ "ห้องแชท" เฉย ๆ ลูกค้าเก่าที่กลับมาทักอีกในอีก 3 เดือน
 *    จะไม่มีใครได้รับแจ้งเตือนเลยตลอดกาล เพราะเคยแจ้งไปแล้วครั้งหนึ่งเมื่อ 3 เดือนก่อน
 *    นี่คือความผิดพลาดที่ "เงียบ" ที่สุด — ไม่มี error ไม่มี log มีแต่ลูกค้าที่ไม่มีใครตอบ
 *
 *    subject_id จึงต้องมีของที่ "เปลี่ยนทุกครั้งที่เหตุการณ์เกิดใหม่" อยู่ด้วยเสมอ :
 *
 *    | เหตุการณ์        | subject_id ที่ถูกต้อง                  | เกิดใหม่ได้เมื่อ            |
 *    | new_chat        | <conversation_id>:<message_id>       | ลูกค้าส่งข้อความใหม่         |
 *    | reply           | <conversation_id>:<message_id>       | ลูกค้าส่งข้อความใหม่         |
 *    | idle_15min      | <conversation_id>:<เวลาข้อความล่าสุด>  | ลูกค้าทักเพิ่มแล้วเงียบอีก    |
 *    | window_closing  | <conversation_id>:<เวลาเริ่มกรอบ>      | กรอบ 24 ชม. รอบใหม่        |
 *    | new_comment     | <comment_id>                         | คอมเมนต์ใหม่ (ไม่ซ้ำอยู่แล้ว) |
 *
 * ⚠️ อย่ากลัวว่าจะแจ้งถี่เกิน — ฝั่งเครื่องมีตัวกันอยู่แล้ว :
 *    push ใช้ tag = ห้องแชท (อันใหม่ทับอันเก่า ไม่กองเป็นสิบ)
 *    Telegram รวบทุกงานในรอบเดียวเป็นข้อความเดียว
 */
export function dedupeKey(
  event: NotifyEvent,
  subjectId: string,
  adminId: string,
  channel: 'push' | 'telegram',
): string {
  return `${event}:${subjectId}:${adminId}:${channel}`;
}

/* ------------------------------------------------------------------------ */
/* ช่วงเวลาห้ามรบกวน                                                          */
/* ------------------------------------------------------------------------ */

/**
 * ตอนนี้อยู่ในช่วงห้ามรบกวนของแอดมินคนนี้ไหม
 *
 * @param nowHHMM เวลาปัจจุบันรูปแบบ "HH:MM" ตามเวลาไทย (ฉีดเข้ามาเพื่อทดสอบ)
 *
 * ⚠️ รองรับช่วงที่ข้ามเที่ยงคืน เช่น 22:00-08:00 ซึ่งเป็นค่าเริ่มต้น
 *    ถ้าเขียนแบบ start <= now && now <= end ตรง ๆ ช่วงข้ามคืนจะไม่เคยเป็นจริงเลย
 */
export function inQuietHours(
  nowHHMM: string,
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  if (!start || !end) return false;
  const now = toMinutes(nowHHMM);
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (now < 0 || s < 0 || e < 0) return false;
  if (s === e) return false;
  return s < e ? now >= s && now < e : now >= s || now < e;
}

function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return -1;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return -1;
  return h * 60 + min;
}

/**
 * ทำความสะอาดรายการเหตุการณ์ที่มาจากหน้าตั้งค่า
 * ⚠️ รับเฉพาะชื่อที่ระบบรู้จัก — ค่าแปลกปลอมต้องไม่หลุดลงฐานข้อมูล
 */
export function cleanEvents(input: unknown): NotifyEvent[] {
  if (!Array.isArray(input)) return [...ALL_EVENTS];
  const out = input.filter((v): v is NotifyEvent =>
    typeof v === 'string' && (ALL_EVENTS as string[]).includes(v),
  );
  return [...new Set(out)];
}
