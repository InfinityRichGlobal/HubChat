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

export type FetchedComment = {
  id: string;
  post_id: string;
  message: string;
  from_id: string | null;
  from_name: string | null;
  from_username?: string | null;
  created_time: string;
  permalink_url?: string;
  parent_id?: string | null;
};

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
 *
 * 🔴 ปรับปรุงรอบ 10 — error code 100/200/10 มีหลายสาเหตุ
 *    ต้องดู rawMessage ประกอบเพื่อให้คำแนะนำที่ถูกต้อง
 *    ไม่ใช่บอก "ตรวจสิทธิ์" ทุกกรณี (ทั้งที่ token มีสิทธิ์ครบแล้ว)
 */
export function explainCommentError(
  code: number | null,
  fallback: string,
  platform: 'facebook' | 'instagram' = 'facebook',
  rawMessage?: string,
): string {
  const isIg = platform === 'instagram';
  const name = isIg ? 'Instagram' : 'Facebook';
  const raw = (rawMessage ?? '').toLowerCase();

  if (code === 190) {
    return `token ของเพจ ${name} หมดอายุหรือถูกเพิกถอน — สร้าง token ใหม่ในหน้าตั้งค่าเพจ`;
  }
  if (code === 10903 || code === 10900) {
    return 'ตอบส่วนตัวไม่ได้แล้ว — คอมเมนต์นี้อาจเคยถูกตอบส่วนตัวไปแล้ว หรือเกินกรอบเวลา 7 วันที่ Meta กำหนด';
  }

  // Code 100 มีหลายสาเหตุ — ต้องดู raw message ประกอบ
  if (code === 100) {
    if (/does not exist|nonexist|cannot find|invalid.*id|object/i.test(raw)) {
      return `คอมเมนต์นี้อาจถูกลบไปแล้วหรือ ID ไม่ถูกต้องบน ${name}`;
    }
    if (/permission|scope/i.test(raw)) {
      return isIg
        ? 'Token ไม่มีสิทธิ์จัดการคอมเมนต์บน Instagram — ตรวจสิทธิ์ instagram_manage_comments แล้วสร้าง token ใหม่'
        : 'Token ไม่มีสิทธิ์จัดการคอมเมนต์บน Facebook — ตรวจสิทธิ์ pages_manage_engagement แล้วสร้าง token ใหม่';
    }
    // fallback สำหรับ code 100 ที่ไม่เข้าเงื่อนไขข้างบน
    return `${name} ไม่สามารถดำเนินการได้ — คอมเมนต์อาจถูกลบไปแล้ว หรือ ID ไม่ถูกต้อง (${raw.slice(0, 80) || fallback})`;
  }

  // Code 200 = ไม่มีสิทธิ์ทำ action นี้
  if (code === 200) {
    if (/own|page/i.test(raw)) {
      return 'ไม่สามารถทำรายการนี้ได้ — อาจเป็นเพราะคอมเมนต์นี้เป็นของเพจเราเอง';
    }
    return isIg
      ? 'ไม่มีสิทธิ์จัดการคอมเมนต์นี้บน Instagram — ตรวจสิทธิ์ instagram_manage_comments และ instagram_manage_engagement แล้วสร้าง token ใหม่'
      : 'ไม่มีสิทธิ์จัดการคอมเมนต์นี้บน Facebook — ตรวจสิทธิ์ pages_manage_engagement และ pages_read_engagement แล้วสร้าง token ใหม่';
  }

  // Code 10 = permission ไม่ครบ
  if (code === 10) {
    return isIg
      ? 'Token ไม่มีสิทธิ์ที่จำเป็น — ตรวจสิทธิ์ instagram_manage_comments และ instagram_manage_engagement'
      : 'Token ไม่มีสิทธิ์ที่จำเป็น — ตรวจสิทธิ์ pages_manage_engagement และ pages_read_engagement';
  }

  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return `เรียก ${name} ถี่เกินโควตาชั่วโมงนี้ — รอสัก 15-30 นาทีแล้วลองใหม่`;
  }
  if (code === 803 || code === 2500) {
    return `คอมเมนต์นี้ถูกลบจาก ${name} แล้ว`;
  }
  return fallback;
}
