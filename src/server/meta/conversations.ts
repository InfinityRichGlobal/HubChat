import 'server-only';
/**
 * อ่านประวัติแชทจาก Meta (รอบ 7)
 * ===========================================================================
 * ⭐ ไฟล์นี้อยู่ในโฟลเดอร์ server/meta/ โดยตั้งใจ
 *    กฎของโปรเจกต์คือ "ทุกเรื่องที่ต้องคุยกับ Meta อยู่ในโฟลเดอร์นี้เท่านั้น"
 *    ชั้น ingest มีหน้าที่ลำดับขั้นตอนกับบันทึกลงฐานข้อมูล ไม่ใช่รู้จัก HTTP
 *    (ทั้ง eslint และชุดทดสอบสถาปัตยกรรมบังคับข้อนี้ — เคยเขียนผิดแล้วมันจับได้)
 *
 * ⚠️ ไฟล์นี้ "อ่านอย่างเดียว" — ไม่ส่งข้อความ ไม่แตะ Policy Engine
 */
import { db } from '@/lib/supabase/admin';
import { metaGet, MetaNotConfiguredError, type MetaPage } from './client';

export class PageNotFoundError extends Error {}

export type MetaParticipant = { id?: string; name?: string; username?: string };

export type MetaConvMessage = {
  id?: string;
  created_time?: string;
  from?: MetaParticipant;
  message?: string;
  attachments?: { data?: Array<Record<string, unknown>> };
};

export type MetaConversationRow = {
  id?: string;
  updated_time?: string;
  unread_count?: number;
  participants?: { data?: MetaParticipant[] };
  messages?: { data?: MetaConvMessage[] };
};

export type ConversationsPage =
  | { ok: true; conversations: MetaConversationRow[]; next_cursor: string | null }
  | { ok: false; error_th: string };

/** ข้อมูลเพจเท่าที่การซิงก์ต้องใช้ — token ไม่หลุดออกจากชั้นนี้ */
export async function loadPageForSync(pageId: string): Promise<MetaPage & { display_name: string | null; page_name: string }> {
  const { data } = await db()
    .from('pages')
    .select('id,platform,page_id,access_token,page_name,display_name')
    .eq('id', pageId)
    .maybeSingle();
  if (!data) throw new PageNotFoundError('ไม่พบเพจนี้');
  return data as unknown as MetaPage & { display_name: string | null; page_name: string };
}

/**
 * ขอแชทหนึ่งหน้าจาก Meta พร้อมข้อความในแต่ละห้อง
 * ขอมาพร้อมกันในคำขอเดียวเพื่อประหยัดจำนวนเรียก (Meta จำกัดต่อชั่วโมง)
 */
export async function fetchConversationsPage(
  page: MetaPage,
  opts: { after?: string | null; conversationsPerPage: number; messagesPerConversation: number },
): Promise<ConversationsPage> {
  const fields =
    `id,updated_time,unread_count,participants,` +
    `messages.limit(${opts.messagesPerConversation})` +
    `{id,created_time,from,message,attachments}`;

  const params: Record<string, string> = {
    fields,
    limit: String(opts.conversationsPerPage),
    // Instagram ต้องระบุ platform ชัดเจน ไม่งั้นจะได้ของ Messenger
    ...(page.platform === 'instagram' ? { platform: 'instagram' } : {}),
    ...(opts.after ? { after: opts.after } : {}),
  };

  const result = await metaGet(page, `${page.page_id}/conversations`, params);

  if (!result.ok) {
    return { ok: false, error_th: explainSyncError(result.error.code, result.error.message_th) };
  }

  const body = result.data as {
    data?: unknown;
    paging?: { cursors?: { after?: string }; next?: string };
  };

  return {
    ok: true,
    conversations: Array.isArray(body.data) ? (body.data as MetaConversationRow[]) : [],
    // มี next เท่านั้นถึงจะยังมีของต่อ — cursors.after มีเสมอแม้หน้าสุดท้าย
    next_cursor: body.paging?.next ? (body.paging.cursors?.after ?? null) : null,
  };
}

/**
 * แปลข้อผิดพลาดของ Meta เป็นคำแนะนำที่ทำตามได้
 * 🔴 บทเรียนจาก D-31 : ข้อความกลาง ๆ ทำให้ไล่ปัญหาต่อไม่ได้เลย
 */
export function explainSyncError(code: number | null, fallback: string): string {
  if (code === 190) {
    return 'token ของเพจหมดอายุหรือถูกเพิกถอน — สร้าง token ใหม่ในหน้าตั้งค่าเพจ';
  }
  if (code === 100 || code === 200 || code === 10) {
    return (
      'token ยังไม่มีสิทธิ์อ่านประวัติแชท — ต้องมีสิทธิ์ pages_messaging ' +
      'และเพจต้องอนุญาตให้แอปเข้าถึงกล่องข้อความ ' +
      'ลองสร้าง token ใหม่โดยติ๊กสิทธิ์ให้ครบ แล้วกดซิงก์อีกครั้ง'
    );
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return 'เรียก Meta ถี่เกินโควตาชั่วโมงนี้ — รอสัก 15-30 นาทีแล้วกดซิงก์ใหม่ (ของที่ดึงมาแล้วไม่หาย)';
  }
  return fallback;
}

export { MetaNotConfiguredError };
