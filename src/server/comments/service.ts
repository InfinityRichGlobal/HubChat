import 'server-only';
/**
 * ฟีดคอมเมนต์ — ชั้นที่คุยกับฐานข้อมูล (รอบ 9 — สเปกหัวข้อ 5.5)
 * ===========================================================================
 * 🔴 กฎเหล็กของทั้งไฟล์ : **ไม่ตอบอัตโนมัติ** (สเปก 5.5)
 *    ทุกการตอบ ทุกการทักส่วนตัว ต้องมีแอดมินกดเองเสมอ
 *    ไฟล์นี้จึงไม่มีฟังก์ชันไหนที่ถูกเรียกจากสายรับข้อมูลอัตโนมัติเลย
 *    (มีแต่ saveIncomingComment ที่ "บันทึก" เฉย ๆ ไม่ตอบอะไร)
 */
import { db } from '@/lib/supabase/admin';
import { canSeePage } from '@/lib/auth/permissions';
import type { PublicAdmin } from '@/types/db';
import { cleanFilterWords, matchFilterWord, DEFAULT_FILTER_WORDS } from './filter';

export class CommentError extends Error {
  constructor(public message_th: string) {
    super(message_th);
    this.name = 'CommentError';
  }
}

/* ------------------------------------------------------------------------ */
/* คำกรอง (เก็บใน app_settings)                                               */
/* ------------------------------------------------------------------------ */

export async function getFilterWords(): Promise<string[]> {
  const { data } = await db()
    .from('app_settings')
    .select('value')
    .eq('key', 'comment_filter_words')
    .maybeSingle();

  const raw = (data as { value: unknown } | null)?.value;
  const words = cleanFilterWords(raw);
  return words.length > 0 ? words : [...DEFAULT_FILTER_WORDS];
}

export async function saveFilterWords(admin: PublicAdmin, words: unknown): Promise<string[]> {
  const clean = cleanFilterWords(words);
  const { error } = await db()
    .from('app_settings')
    .upsert(
      { key: 'comment_filter_words', value: clean, updated_by: admin.id, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
  if (error) throw new CommentError(`บันทึกคำกรองไม่สำเร็จ: ${error.message}`);
  return clean;
}

/* ------------------------------------------------------------------------ */
/* บันทึกคอมเมนต์ที่เข้ามา (เรียกจากสายรับข้อมูล)                                 */
/* ------------------------------------------------------------------------ */

export type SaveCommentInput = {
  page_id: string;
  comment_id: string;
  post_id: string | null;
  parent_comment_id: string | null;
  from_id: string | null;
  from_name: string | null;
  message: string | null;
  permalink: string | null;
  attachment_url: string | null;
  is_from_page: boolean;
  commented_at: string;
  raw: Record<string, unknown>;
};

/**
 * บันทึกคอมเมนต์ — กันซ้ำที่ฐานข้อมูล
 * ⚠️ ห้ามตอบอะไรจากที่นี่เด็ดขาด แค่บันทึกและติดป้ายคำกรอง
 */
export async function saveIncomingComment(
  input: SaveCommentInput,
  filterWords: string[],
): Promise<{ id: string | null; duplicate: boolean; matched: string | null }> {
  const matched = input.is_from_page ? null : matchFilterWord(input.message, filterWords);

  const { data, error } = await db().rpc('ingest_comment', {
    p_page_id: input.page_id,
    p_comment_id: input.comment_id,
    p_post_id: input.post_id,
    p_parent_id: input.parent_comment_id,
    p_from_id: input.from_id,
    p_from_name: input.from_name,
    p_message: input.message,
    p_permalink: input.permalink,
    p_attachment_url: input.attachment_url,
    p_matched_keyword: matched,
    p_is_from_page: input.is_from_page,
    p_commented_at: input.commented_at,
    p_raw: input.raw,
  });

  if (error) throw new CommentError(`บันทึกคอมเมนต์ไม่สำเร็จ: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { comment_row_id: string | null; duplicate: boolean }
    | undefined;

  return { id: row?.comment_row_id ?? null, duplicate: Boolean(row?.duplicate), matched };
}

/* ------------------------------------------------------------------------ */
/* อ่านฟีด                                                                    */
/* ------------------------------------------------------------------------ */

export type CommentRow = {
  id: string;
  page_id: string;
  comment_id: string;
  post_id: string | null;
  parent_comment_id: string | null;
  from_name: string | null;
  from_id: string | null;
  message: string | null;
  post_permalink: string | null;
  attachment_url: string | null;
  matched_keyword: string | null;
  is_handled: boolean;
  is_hidden: boolean;
  is_from_page: boolean;
  replied_public: boolean;
  replied_private: boolean;
  public_reply_text: string | null;
  private_reply_text: string | null;
  conversation_id: string | null;
  last_error_th: string | null;
  commented_at: string | null;
  created_at: string;
};

const COLUMNS =
  'id,page_id,comment_id,post_id,parent_comment_id,from_name,from_id,message,post_permalink,' +
  'attachment_url,matched_keyword,is_handled,is_hidden,is_from_page,replied_public,replied_private,' +
  'public_reply_text,private_reply_text,conversation_id,last_error_th,commented_at,created_at';

export type CommentFilters = {
  /** เฉพาะที่ยังไม่จัดการ */
  unhandled_only?: boolean;
  /** เฉพาะที่เข้าคำกรอง */
  keyword_only?: boolean;
  page_id?: string;
  limit?: number;
  /** cursor — เวลาของคอมเมนต์ที่เก่าที่สุดที่หน้าเว็บถืออยู่ */
  before?: string | null;
};

async function visiblePageIds(admin: PublicAdmin): Promise<string[]> {
  const { data } = await db().from('pages').select('id');
  return ((data ?? []) as Array<{ id: string }>)
    .map((p) => p.id)
    .filter((id) => canSeePage(admin.role, admin.allowed_page_ids, id));
}

export async function listComments(
  admin: PublicAdmin,
  filters: CommentFilters = {},
): Promise<{ comments: CommentRow[]; has_more: boolean; unhandled_count: number }> {
  const pageIds = await visiblePageIds(admin);
  if (pageIds.length === 0) return { comments: [], has_more: false, unhandled_count: 0 };

  const scoped =
    filters.page_id && pageIds.includes(filters.page_id) ? [filters.page_id] : pageIds;

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

  let query = db()
    .from('comments')
    .select(COLUMNS)
    .in('page_id', scoped)
    // คอมเมนต์ของเพจเราเองไม่ต้องอยู่ในฟีดให้รก
    .eq('is_from_page', false)
    .order('commented_at', { ascending: false })
    // ⭐ ตัวตัดสินตอนเวลาเท่ากัน — คอมเมนต์รัว ๆ มีเวลาซ้ำกันได้ (บทเรียน D-61)
    .order('id', { ascending: false })
    .limit(limit);

  if (filters.unhandled_only) query = query.eq('is_handled', false);
  if (filters.keyword_only) query = query.not('matched_keyword', 'is', null);
  // ⭐ ใช้ lte ไม่ใช่ lt — เวลาซ้ำกันได้ หน้าเว็บกรองตัวซ้ำที่ขอบทิ้งเอง
  if (filters.before) query = query.lte('commented_at', filters.before);

  const { data, error } = await query;
  if (error) throw new CommentError(`อ่านฟีดคอมเมนต์ไม่สำเร็จ: ${error.message}`);

  const rows = (data ?? []) as unknown as CommentRow[];

  const { count } = await db()
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .in('page_id', scoped)
    .eq('is_from_page', false)
    .eq('is_handled', false);

  return { comments: rows, has_more: rows.length === limit, unhandled_count: count ?? 0 };
}

export async function getComment(admin: PublicAdmin, id: string): Promise<CommentRow> {
  const { data } = await db().from('comments').select(COLUMNS).eq('id', id).maybeSingle();
  if (!data) throw new CommentError('ไม่พบคอมเมนต์นี้');
  const row = data as unknown as CommentRow;
  if (!canSeePage(admin.role, admin.allowed_page_ids, row.page_id)) {
    throw new CommentError('คุณไม่มีสิทธิ์เข้าถึงเพจของคอมเมนต์นี้');
  }
  return row;
}

/** ทำเครื่องหมายว่าจัดการแล้ว / ยังไม่จัดการ */
export async function setHandled(
  admin: PublicAdmin,
  id: string,
  handled: boolean,
): Promise<CommentRow> {
  await getComment(admin, id); // ตรวจสิทธิ์
  const { error } = await db()
    .from('comments')
    .update({
      is_handled: handled,
      handled_by: handled ? admin.id : null,
      handled_at: handled ? new Date().toISOString() : null,
    })
    .eq('id', id);
  if (error) throw new CommentError(`บันทึกสถานะไม่สำเร็จ: ${error.message}`);
  return getComment(admin, id);
}
