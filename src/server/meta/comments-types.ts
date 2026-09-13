import 'server-only';
/**
 * ชนิดข้อมูลและการแปล Error สำหรับ Comment Adapters
 */

export type CommentActionResult =
  | { ok: true; id: string | null }
  | { ok: false; error_th: string; outcome_unknown: boolean };

export type WebhookSubscribeResult =
  | { ok: true; subscribed_fields: string[] }
  | { ok: false; error_th: string };

export type CommentPlatformCapabilities = {
  like: boolean;
  unlike: boolean;
  publicReply: boolean;
  privateReply: boolean;
  hide: boolean;
  delete: boolean;
};

/**
 * เมทริกซ์ความสามารถของระบบคอมเมนต์แยกตาม Platform
 */
export const COMMENT_CAPABILITIES: Record<'facebook' | 'instagram' | 'line', CommentPlatformCapabilities> = {
  facebook: {
    like: true,
    unlike: false,
    publicReply: true,
    privateReply: true,
    hide: true,
    delete: true,
  },
  instagram: {
    like: true,
    unlike: true,
    publicReply: true,
    privateReply: true,
    hide: true,
    delete: true,
  },
  line: {
    like: false,
    unlike: false,
    publicReply: false,
    privateReply: false,
    hide: false,
    delete: false,
  },
};

/**
 * แปลข้อผิดพลาดของ Meta เป็นคำแนะนำที่ทำตามได้ (รองรับทั้ง FB และ IG)
 */
export function explainCommentError(
  code: number | null,
  fallback: string,
  platform: 'facebook' | 'instagram' = 'facebook',
): string {
  const isIg = platform === 'instagram';
  const name = isIg ? 'Instagram' : 'Facebook';

  if (code === 190) {
    return `token ของเพจ ${name} หมดอายุหรือถูกเพิกถอน — สร้าง token ใหม่ในหน้าตั้งค่าเพจ`;
  }
  if (code === 10903 || code === 10900) {
    return 'ตอบส่วนตัวไม่ได้แล้ว — คอมเมนต์นี้อาจเคยถูกตอบส่วนตัวไปแล้ว หรือเกินกรอบเวลา 7 วันที่ Meta กำหนด';
  }
  if (code === 100 || code === 200 || code === 10) {
    return isIg
      ? 'Token ไม่มีสิทธิ์จัดการคอมเมนต์บน Instagram — ตรวจสิทธิ์ instagram_manage_comments และ instagram_manage_engagement แล้วสร้าง token ใหม่'
      : 'Token ไม่มีสิทธิ์จัดการคอมเมนต์บน Facebook — ตรวจสิทธิ์ pages_manage_engagement และ pages_read_engagement แล้วสร้าง token ใหม่';
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return `เรียก ${name} ถี่เกินโควตาชั่วโมงนี้ — รอสัก 15-30 นาทีแล้วลองใหม่`;
  }
  if (code === 803 || code === 2500) {
    return `คอมเมนต์นี้ถูกลบจาก ${name} แล้ว`;
  }
  return fallback;
}
