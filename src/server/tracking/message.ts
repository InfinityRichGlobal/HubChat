/**
 * ข้อความแจ้งเลขพัสดุ (รอบ 8 — สเปกหัวข้อ 5.8)
 * ===========================================================================
 * ⚠️ ฟังก์ชันบริสุทธิ์ล้วน ๆ และ "อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น"
 *
 * 🔴 เบราว์เซอร์ห้ามเป็นคนกำหนดเนื้อข้อความในงานเป็นชุด
 *    ถ้าให้หน้าเว็บส่งข้อความมาเอง จะมีวันที่มีคนแทรกคำขายเข้าไป
 *    แล้วข้อความหลุดจากหมวด utility ทันที ซึ่งผิดนโยบาย Meta
 *
 * 🔴 ห้ามแทรกการขายเด็ดขาด — เป็นการแจ้งข้อมูลล้วน ๆ
 *    ไม่มีคำว่า "โปรโมชัน" "ลดราคา" "สั่งเพิ่ม" ในเทมเพลตนี้ และห้ามเพิ่มด้วย
 *    (มีชุดทดสอบไล่ตรวจคำต้องห้ามอยู่)
 */

export type TrackingMessageInput = {
  order_no: string;
  recipient?: string | null;
  tracking_no: string;
  carrier?: string | null;
  /** ลิงก์ตรวจสถานะของขนส่งเจ้านั้น */
  track_url?: string | null;
};

/** ชื่อขนส่งที่เอาไว้แสดงให้ลูกค้าอ่าน */
const CARRIER_LABEL: Record<string, string> = {
  flash: 'Flash Express',
  kerry: 'Kerry Express',
  jt: 'J&T Express',
  thailand_post: 'ไปรษณีย์ไทย',
};

/** ลิงก์ตรวจสถานะมาตรฐานของแต่ละเจ้า */
const TRACK_URL: Record<string, (no: string) => string> = {
  flash: (no) => `https://www.flashexpress.co.th/tracking/?se=${encodeURIComponent(no)}`,
  kerry: (no) => `https://th.kerryexpress.com/th/track/?track=${encodeURIComponent(no)}`,
  jt: (no) => `https://www.jtexpress.co.th/index/query/gzquery.html?bills=${encodeURIComponent(no)}`,
  thailand_post: (no) => `https://track.thailandpost.co.th/?trackNumber=${encodeURIComponent(no)}`,
};

export function carrierLabel(carrier: string | null | undefined): string | null {
  if (!carrier) return null;
  const key = carrier.trim().toLowerCase();
  return CARRIER_LABEL[key] ?? carrier.trim();
}

export function trackUrl(carrier: string | null | undefined, trackingNo: string): string | null {
  if (!carrier) return null;
  const build = TRACK_URL[carrier.trim().toLowerCase()];
  return build ? build(trackingNo) : null;
}

/**
 * ประกอบข้อความแจ้งจัดส่ง
 * รูปแบบตามสเปก 5.8 — สั้น ตรงประเด็น ไม่มีการขาย
 */
export function buildTrackingMessage(input: TrackingMessageInput): string {
  const name = (input.recipient ?? '').trim();
  const lines: string[] = [];

  lines.push(
    name
      ? `คุณ${name} ออเดอร์ ${input.order_no} จัดส่งแล้วค่ะ`
      : `ออเดอร์ ${input.order_no} จัดส่งแล้วค่ะ`,
  );

  const label = carrierLabel(input.carrier);
  if (label) lines.push(`ขนส่ง: ${label}`);

  lines.push(`เลขพัสดุ: ${input.tracking_no}`);

  const url = input.track_url ?? trackUrl(input.carrier, input.tracking_no);
  if (url) lines.push(`ตรวจสอบสถานะ: ${url}`);

  return lines.join('\n');
}

/**
 * คำที่ทำให้ข้อความหลุดจากหมวด "แจ้งข้อมูล"
 * ⚠️ ใช้เป็นตาข่ายกันคนแก้เทมเพลตในอนาคตเท่านั้น
 *    ไม่ใช่ตัวเดาว่าข้อความไหนเป็นการขาย (message_type มาจากบริบทเสมอ)
 */
export const SALES_WORDS_TH = ['โปรโมชัน', 'โปรโมชั่น', 'ลดราคา', 'ส่วนลด', 'สั่งเพิ่ม', 'ซื้อเลย', 'สนใจ'];

export function looksLikeSales(text: string): boolean {
  const lower = text.toLowerCase();
  return SALES_WORDS_TH.some((w) => lower.includes(w.toLowerCase()));
}
