import 'server-only';
/**
 * ดึงแชทเก่าจาก Meta เข้าระบบ (รอบ 7)
 * ===========================================================================
 * 🔴 ปัญหาที่แก้ — เรื่องที่เจ้าของร้านสงสัยและถูกต้องแล้วที่สงสัย :
 *
 *    webhook ส่งให้เราเฉพาะข้อความที่เกิด "หลังจาก" กด Subscribe เท่านั้น
 *    แชทที่มีอยู่ก่อนหน้านั้นไม่มีทางไหลเข้ามาเอง ต่อให้รอเป็นเดือน
 *    → เปิดระบบมาแล้วเห็นแต่แชททดสอบ ทั้งที่เพจมีลูกค้าเป็นร้อย
 *
 *    ทางแก้เดียวคือ "ไปดึงย้อนหลัง" ด้วย Conversations API ซึ่งคือไฟล์นี้
 *
 * ⭐ ทำไมต้องเก็บลงฐานข้อมูลเรา ไม่ใช่ดึงมาแสดงสด ๆ ทุกครั้ง :
 *    • Policy Engine ต้องรู้ว่าลูกค้าทักล่าสุดเมื่อไหร่ (กรอบ 24 ชม.)
 *      ถ้าต้องถาม Meta ก่อนส่งทุกครั้ง จะช้าและชนเพดานโควตา
 *    • ล็อกกันแอดมินตอบชนกัน / แท็ก / ค้นหา / ผูกออเดอร์ — Meta ไม่มีที่ให้เก็บ
 *    • ถ้าวันหนึ่งเพจโดนระงับหรือ Meta ปิด API เรายังมีข้อมูลลูกค้าครบ
 *
 * ⚠️ ใช้ฟังก์ชันบันทึกตัวเดียวกับ webhook (ingest_inbound_message / echo)
 *    จึงกันซ้ำได้ฟรีด้วย meta_message_id และไม่มีเส้นทางบันทึกที่สอง
 *
 * ⚠️ ไฟล์นี้ไม่รู้จัก HTTP เลย — เรื่องคุยกับ Meta อยู่ที่ server/meta/conversations.ts
 *    (ทั้ง eslint และชุดทดสอบสถาปัตยกรรมบังคับข้อนี้)
 */
import { db } from '@/lib/supabase/admin';
import {
  fetchConversationsPage,
  loadPageForSync,
  MetaNotConfiguredError,
  PageNotFoundError,
  type MetaConvMessage,
  type MetaParticipant,
} from '@/server/meta/conversations';
import type { MetaPage } from '@/server/meta/client';
import type { Platform } from '@/types/db';

export type BackfillSummary = {
  conversations_seen: number;
  messages_saved: number;
  duplicates: number;
  skipped: number;
  /** ดึงมากี่หน้า — ใช้ดูว่าชนเพดานหรือยัง */
  pages_fetched: number;
  /** true = ยังมีของเก่ากว่านี้อีก กดซ้ำเพื่อดึงต่อได้ */
  has_more: boolean;
  /** ส่งกลับให้หน้าเว็บถือไว้ แล้วส่งคืนมาตอนกด "ดึงต่อ" */
  next_cursor: string | null;
  error_th: string | null;
};

const EMPTY: BackfillSummary = {
  conversations_seen: 0,
  messages_saved: 0,
  duplicates: 0,
  skipped: 0,
  pages_fetched: 0,
  has_more: false,
  next_cursor: null,
  error_th: null,
};

/**
 * เพดานต่อการกดหนึ่งครั้ง
 *
 * ⚠️ ตั้งเพดานไว้โดยตั้งใจ ไม่ดึงรวดเดียวจนหมด :
 *    • Meta จำกัดจำนวนเรียกต่อชั่วโมง ถ้ายิงรัวจะโดนตัดทั้งเพจ
 *      ซึ่งแปลว่าข้อความ "ขาเข้าจริง" จะเข้าไม่ได้ด้วย — เสียหายกว่าได้
 *    • งานนี้รันในคำขอเดียว ถ้ายาวเกินจะ timeout กลางทาง
 *    กดซ้ำได้เรื่อย ๆ และกันซ้ำอยู่แล้ว จึงปลอดภัยกว่าดึงทีเดียวจบ
 */
const MAX_PAGES_PER_RUN = 10;
const CONVERSATIONS_PER_PAGE = 25;
const MESSAGES_PER_CONVERSATION = 50;

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * แปลงไฟล์แนบจากรูปแบบของ Conversations API
 * ⚠️ รูปแบบไม่เหมือน webhook — ตรงนี้คือที่ที่มักพลาด
 *    webhook ให้ payload.url ส่วน API นี้ให้ image_data.url หรือ file_url
 */
export function parseAttachments(
  raw: MetaConvMessage['attachments'],
): Array<{ type: string; url?: string }> {
  return asArray<Record<string, unknown>>(raw?.data)
    .map((a) => {
      const mime = typeof a.mime_type === 'string' ? a.mime_type : '';
      const imageData = a.image_data as { url?: string } | undefined;
      const videoData = a.video_data as { url?: string } | undefined;
      const url =
        (typeof imageData?.url === 'string' ? imageData.url : undefined) ??
        (typeof videoData?.url === 'string' ? videoData.url : undefined) ??
        (typeof a.file_url === 'string' ? a.file_url : undefined);
      const type = mime.startsWith('image/')
        ? 'image'
        : mime.startsWith('video/')
          ? 'video'
          : imageData
            ? 'image'
            : 'file';
      return { type, url };
    })
    .filter((a) => a.url !== undefined);
}

/* ------------------------------------------------------------------------ */
/* บันทึกข้อความหนึ่งข้อความ                                                    */
/* ------------------------------------------------------------------------ */

type SaveResult = 'saved' | 'duplicate' | 'skipped';

async function saveMessage(
  page: MetaPage,
  psid: string,
  platform: Platform,
  msg: MetaConvMessage,
  outgoing: boolean,
): Promise<SaveResult> {
  // ไม่มี id = กันซ้ำไม่ได้ → ข้ามทิ้งดีกว่าเสี่ยงบันทึกซ้ำทุกครั้งที่ซิงก์
  if (!msg.id) return 'skipped';

  const text = typeof msg.message === 'string' && msg.message.length > 0 ? msg.message : null;
  const attachments = parseAttachments(msg.attachments);
  if (text === null && attachments.length === 0) return 'skipped';

  const sentAt = msg.created_time ?? new Date().toISOString();

  // ⭐ ใช้ฟังก์ชันเดียวกับ webhook — กันซ้ำด้วย meta_message_id ได้ฟรี
  //    และไม่เกิด "เส้นทางบันทึกข้อความเส้นที่สอง" ที่ต้องดูแลแยก
  const { data, error } = outgoing
    ? await db().rpc('ingest_echo_message', {
        p_page_id: page.id,
        p_psid: psid,
        p_platform: platform,
        p_meta_message_id: msg.id,
        p_text: text,
        p_attachments: attachments,
        p_sent_at: sentAt,
      })
    : await db().rpc('ingest_inbound_message', {
        p_page_id: page.id,
        p_psid: psid,
        p_platform: platform,
        p_meta_message_id: msg.id,
        p_text: text,
        p_attachments: attachments,
        p_sent_at: sentAt,
        // ⚠️ ที่มาของแชท (มาจากแอดไหน) ไม่มีใน Conversations API
        //    ส่ง null ทุกช่อง — ฟังก์ชันใช้ coalesce จึงไม่ไปลบของเดิมที่ webhook เคยบันทึกไว้
        p_referral_source: null,
        p_referral_ad_id: null,
        p_referral_post_id: null,
        p_referral_ref: null,
      });

  if (error) throw new Error(`บันทึกข้อความจากการซิงก์ไม่สำเร็จ: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as { duplicate?: boolean } | undefined;
  return row?.duplicate ? 'duplicate' : 'saved';
}

/* ------------------------------------------------------------------------ */
/* ตัวหลัก                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * ดึงแชทเก่าของเพจหนึ่งเข้าระบบ
 *
 * @param after cursor จากการกดครั้งก่อน — ส่งมาเพื่อดึงต่อจากที่ค้างไว้
 */
export async function backfillPageConversations(
  page: MetaPage,
  after?: string | null,
): Promise<BackfillSummary> {
  const summary: BackfillSummary = { ...EMPTY };
  const platform: Platform = page.platform;

  let cursor = after ?? null;

  for (let i = 0; i < MAX_PAGES_PER_RUN; i += 1) {
    const result = await fetchConversationsPage(page, {
      after: cursor,
      conversationsPerPage: CONVERSATIONS_PER_PAGE,
      messagesPerConversation: MESSAGES_PER_CONVERSATION,
    });
    summary.pages_fetched += 1;

    if (!result.ok) {
      // 🔴 แปลให้อ่านรู้เรื่องแล้วตั้งแต่ชั้น meta — เรื่องสิทธิ์เป็นสาเหตุที่พบบ่อยสุด
      summary.error_th = result.error_th;
      // ⚠️ คืน cursor เดิมกลับไปด้วย จะได้กดต่อจากจุดที่ค้าง ไม่ต้องเริ่มใหม่
      summary.next_cursor = cursor;
      summary.has_more = cursor !== null;
      return summary;
    }

    for (const conv of result.conversations) {
      summary.conversations_seen += 1;

      // หา psid ของลูกค้า = คนที่ไม่ใช่เพจ
      const participants = asArray<MetaParticipant>(conv.participants?.data);
      const customer = participants.find((p) => p.id && p.id !== page.page_id);
      if (!customer?.id) {
        summary.skipped += 1;
        continue;
      }

      // ⚠️ เรียงจากเก่าไปใหม่ก่อนบันทึกเสมอ
      //    Meta คืนมาใหม่ก่อน ถ้าบันทึกตามนั้น ตัวอย่างข้อความล่าสุดจะเพี้ยน
      const messages = asArray<MetaConvMessage>(conv.messages?.data)
        .slice()
        .sort((a, b) => String(a.created_time ?? '').localeCompare(String(b.created_time ?? '')));

      for (const msg of messages) {
        const outgoing = msg.from?.id === page.page_id;
        try {
          const saved = await saveMessage(page, customer.id, platform, msg, outgoing);
          if (saved === 'saved') summary.messages_saved += 1;
          else if (saved === 'duplicate') summary.duplicates += 1;
          else summary.skipped += 1;
        } catch (err) {
          // ข้อความหนึ่งพัง ต้องไม่ทำให้ทั้งการซิงก์ล้ม
          summary.skipped += 1;
          console.warn(`[backfill] ข้ามข้อความ ${msg.id}:`, err);
        }
      }

      /**
       * ⭐ ใช้ตัวนับ "ยังไม่อ่าน" ของ Meta เป็นความจริง
       *    ไม่งั้นการดึงย้อนหลังจะทำให้แชทเก่าทั้งหมดเด้งเป็นยังไม่อ่าน
       *    ทั้งที่แอดมินตอบไปแล้วใน Business Suite — อินบ็อกซ์จะอ่านไม่ออกทันที
       *
       * 🔴 แต่ต้องกันกรณีนี้ด้วย : unread_count เป็นภาพ ณ วินาทีที่ Meta ตอบกลับมา
       *    การซิงก์หนึ่งครั้งกินเวลาเป็นนาที ระหว่างนั้นลูกค้าอาจทักเข้ามาใหม่
       *    ถ้าเผลอไปทับเป็น "อ่านแล้ว" ข้อความใหม่จะหายจากตัวกรอง "ยังไม่ตอบ"
       *    และไม่มีใครรู้ว่ามีคนทักมา — เสียลูกค้าจริง ๆ
       *    จึงทับได้เฉพาะห้องที่ยังไม่มีอะไรใหม่กว่าที่เราเพิ่งดึงมา
       */
      const newestInBatch = messages.length > 0
        ? messages[messages.length - 1].created_time ?? null
        : null;

      if (typeof conv.unread_count === 'number' && conv.unread_count === 0 && newestInBatch) {
        await markConversationReadByPsid(page.id, customer.id, newestInBatch);
      }
    }

    cursor = result.next_cursor;
    if (!cursor) break;
  }

  summary.next_cursor = cursor;
  summary.has_more = cursor !== null;
  return summary;
}

/**
 * ทำเครื่องหมายอ่านแล้วตามที่ Meta บอก (ไม่แตะ last_customer_message_at)
 *
 * @param notNewerThan ทับได้เฉพาะห้องที่ข้อความล่าสุด "ไม่ใหม่กว่า" เวลานี้
 *        กันไม่ให้ข้อความที่เพิ่งเข้ามาระหว่างซิงก์ถูกกลบเป็นอ่านแล้ว
 */
async function markConversationReadByPsid(
  pageId: string,
  psid: string,
  notNewerThan: string,
): Promise<void> {
  const { data: customer } = await db()
    .from('customers')
    .select('id')
    .eq('page_id', pageId)
    .eq('psid', psid)
    .maybeSingle();
  if (!customer) return;

  await db()
    .from('conversations')
    .update({ is_read: true })
    .eq('customer_id', (customer as { id: string }).id)
    .lte('last_message_at', notNewerThan);
}

/* ------------------------------------------------------------------------ */
/* ทางเข้าสำหรับ API route                                                     */
/* ------------------------------------------------------------------------ */

export type SyncOutcome =
  | { kind: 'ok'; summary: BackfillSummary; page_label: string }
  | { kind: 'not_found' }
  | { kind: 'not_configured'; message_th: string };

/**
 * ⭐ route เรียกตัวนี้ตัวเดียว
 *    เหตุผล : route ห้าม query ตาราง pages เอง (เสี่ยง token หลุดออกหน้าเว็บ)
 *    และห้าม import อะไรจาก @/server/meta โดยตรง — ชุดทดสอบสถาปัตยกรรมคุมไว้
 */
export async function syncPageConversations(
  pageId: string,
  after?: string | null,
): Promise<SyncOutcome> {
  try {
    const page = await loadPageForSync(pageId);
    const summary = await backfillPageConversations(page, after);
    return {
      kind: 'ok',
      summary,
      page_label: page.display_name ?? page.page_name,
    };
  } catch (err) {
    if (err instanceof PageNotFoundError) return { kind: 'not_found' };
    if (err instanceof MetaNotConfiguredError) {
      return { kind: 'not_configured', message_th: err.message };
    }
    throw err;
  }
}
