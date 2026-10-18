import 'server-only';
/**
 * ฟีดคอมเมนต์ — ชั้นที่คุยกับฐานข้อมูล (รอบ 9 — สเปกหัวข้อ 5.5)
 * ===========================================================================
 * 🔴 กฎเหล็กของทั้งไฟล์ : **ไม่ตอบอัตโนมัติ** (สเปก 5.5)
 *    ทุกการตอบ ทุกการทักส่วนตัว ต้องมีแอดมินกดเองเสมอ
 *    ไฟล์นี้จึงไม่มีฟังก์ชันไหนที่ถูกเรียกจากสายรับข้อมูลอัตโนมัติเลย
 *    (มีแต่ saveIncomingComment ที่ "บันทึก" เฉย ๆ ไม่ตอบอะไร)
 */
import { z } from 'zod';
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

export const COMMENT_SELECTS = {
  comments: 'id,page_id,comment_id,post_id,parent_comment_id,from_name,from_id,from_username,from_pic_url,message,post_permalink,attachment_url,matched_keyword,is_handled,is_hidden,is_liked,is_deleted,is_from_page,replied_public,replied_private,public_reply_text,private_reply_text,conversation_id,last_error_th,commented_at,created_at',
  legacy_comments: 'id,page_id,comment_id,post_id,parent_comment_id,from_name,from_id,message,post_permalink,attachment_url,matched_keyword,is_handled,is_hidden,is_from_page,replied_public,replied_private,public_reply_text,private_reply_text,conversation_id,last_error_th,commented_at,created_at',
  setting: 'value',
} as const;

/* ------------------------------------------------------------------------ */
/* คำกรอง (เก็บใน app_settings)                                               */
/* ------------------------------------------------------------------------ */

export async function getFilterWords(): Promise<string[]> {
  const { data, error } = await db()
    .from('app_settings')
    .select(COMMENT_SELECTS.setting)
    .eq('key', 'comment_filter_words')
    .maybeSingle();

  if (error) throw new CommentError(`อ่านคำกรองไม่สำเร็จ: ${error.message}`);
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
  from_username?: string | null;
  from_pic_url?: string | null;
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

  let res = await db().rpc('ingest_comment', {
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
    p_from_username: input.from_username ?? null,
    p_from_pic_url: input.from_pic_url ?? null,
  });

  // Fallback สำหรับ database ที่ยังไม่ได้รัน migration 20260913_instagram_comments.sql (ยังเป็น 13 params)
  if (res.error && (res.error.message.includes('schema cache') || res.error.message.includes('ingest_comment'))) {
    res = await db().rpc('ingest_comment', {
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
  }

  if (res.error) throw new CommentError(`บันทึกคอมเมนต์ไม่สำเร็จ: ${res.error.message}`);

  const row = (Array.isArray(res.data) ? res.data[0] : res.data) as
    | { comment_row_id: string | null; duplicate: boolean }
    | undefined;

  if (!row?.comment_row_id || typeof row.duplicate !== 'boolean') {
    throw new CommentError('ฐานข้อมูลไม่คืนผลการบันทึกคอมเมนต์ กรุณาตรวจ migration');
  }
  return { id: row.comment_row_id, duplicate: row.duplicate, matched };
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
  from_username: string | null;
  from_pic_url: string | null;
  message: string | null;
  post_permalink: string | null;
  attachment_url: string | null;
  matched_keyword: string | null;
  is_handled: boolean;
  is_hidden: boolean;
  is_liked: boolean;
  is_deleted: boolean;
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

const COLUMNS = COMMENT_SELECTS.comments;

export const commentFiltersSchema = z.object({
  unhandled_only: z.boolean().optional(),
  keyword_only: z.boolean().optional(),
  page_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(30),
  before: z.string().datetime({ offset: true }).nullish(),
  cursor: z.string().max(500).nullish(),
  status: z.enum(['all', 'pending', 'review', 'handled', 'deleted']).default('all'),
  search: z.string().trim().max(200).default(''),
});
export type CommentFilters = z.input<typeof commentFiltersSchema>;
export type CommentFeed = {
  comments: CommentRow[];
  has_more: boolean;
  next_cursor: string | null;
  unhandled_count: number;
  review_count: number;
};
const cursorSchema = z.object({ at: z.string().datetime({ offset: true }).nullable(), id: z.string().uuid() });

async function visiblePageIds(admin: PublicAdmin): Promise<string[]> {
  const { data, error } = await db().from('pages').select('id');
  if (error) throw new CommentError(`อ่านรายชื่อเพจไม่สำเร็จ: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>)
    .map((p) => p.id)
    .filter((id) => canSeePage(admin.role, admin.allowed_page_ids, id));
}

export async function listComments(admin: PublicAdmin, input: CommentFilters = {}): Promise<CommentFeed> {
  const filters = commentFiltersSchema.parse(input);
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (filters.cursor) {
    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.from(filters.cursor, 'base64url').toString()); } catch { decoded = null; }
    cursor = cursorSchema.parse(decoded);
  }
  const pageIds = await visiblePageIds(admin);
  const scoped = filters.page_id ? pageIds.filter((id) => id === filters.page_id) : pageIds;
  if (!scoped.length) return { comments: [], has_more: false, next_cursor: null, unhandled_count: 0, review_count: 0 };

  const queryFor = (columns: string) => {
    let query = db().from('comments').select(columns).in('page_id', scoped).eq('is_from_page', false)
      .order('commented_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false })
      .limit(filters.limit + 1);
    if (filters.status === 'deleted') query = query.eq('is_deleted', true);
    else if (filters.status !== 'all' || filters.unhandled_only) query = query.eq('is_deleted', false);
    if (filters.status === 'pending') query = query.eq('is_handled', false).is('last_error_th', null);
    if (filters.status === 'review') query = query.not('last_error_th', 'is', null);
    if (filters.status === 'handled') query = query.eq('is_handled', true).is('last_error_th', null);
    if (filters.unhandled_only) query = query.eq('is_handled', false);
    if (filters.keyword_only) query = query.not('matched_keyword', 'is', null);
    if (cursor) {
      if (cursor.at === null) query = query.is('commented_at', null).lt('id', cursor.id);
      else query = query.or(`commented_at.lt.${cursor.at},and(commented_at.eq.${cursor.at},id.lt.${cursor.id}),commented_at.is.null`);
    } else if (filters.before) query = query.lt('commented_at', filters.before);
    if (filters.search) {
      // Quote PostgREST values, then escape SQL pattern characters for a literal substring search.
      const literal = filters.search.replace(/[\\%_*]/g, (c) => `\\${c}`);
      const pattern = JSON.stringify(`%${literal}%`);
      query = query.or(['message', 'from_name', 'from_username'].map((col) => `${col}.ilike.${pattern}`).join(','));
    }
    return query.returns<CommentRow[]>();
  };
  // A modern migration is required: do not silently hide schema errors or misreport statuses.
  const pending = db().from('comments').select('id', { count: 'exact', head: true })
    .in('page_id', scoped).eq('is_from_page', false).eq('is_deleted', false).eq('is_handled', false).is('last_error_th', null);
  const review = db().from('comments').select('id', { count: 'exact', head: true })
    .in('page_id', scoped).eq('is_from_page', false).eq('is_deleted', false).not('last_error_th', 'is', null);
  const [result, pendingResult, reviewResult] = await Promise.all([queryFor(COLUMNS), pending, review]);
  if (result.error) throw new CommentError(`อ่านฟีดคอมเมนต์ไม่สำเร็จ: ${result.error.message}`);
  if (pendingResult.error || reviewResult.error) throw new CommentError('นับสถานะคอมเมนต์ไม่สำเร็จ');
  const allRows = result.data ?? [];
  const rows = allRows.slice(0, filters.limit);
  const hasMore = allRows.length > filters.limit;
  const last = rows.at(-1);
  return {
    comments: rows, has_more: hasMore,
    next_cursor: hasMore && last ? Buffer.from(JSON.stringify({ at: last.commented_at, id: last.id })).toString('base64url') : null,
    unhandled_count: pendingResult.count ?? 0, review_count: reviewResult.count ?? 0,
  };
}

export async function getComment(admin: PublicAdmin, id: string): Promise<CommentRow> {
  let { data, error } = await db().from('comments').select(COLUMNS).eq('id', id).maybeSingle<CommentRow>();

  if (error && error.message.includes('from_username')) {
    const fallbackRes = await db().from('comments').select(COMMENT_SELECTS.legacy_comments).eq('id', id)
      .maybeSingle<Omit<CommentRow, 'from_username' | 'from_pic_url' | 'is_liked' | 'is_deleted'>>();
    if (fallbackRes.error) throw new CommentError(`อ่านคอมเมนต์ไม่สำเร็จ: ${fallbackRes.error.message}`);
    if (fallbackRes.data) {
      data = {
        ...fallbackRes.data,
        from_username: null,
        from_pic_url: null,
        is_liked: false,
        is_deleted: false,
      };
      error = null;
    }
  }

  if (error) throw new CommentError(`อ่านคอมเมนต์ไม่สำเร็จ: ${error.message}`);
  if (!data) throw new CommentError('ไม่พบคอมเมนต์นี้');
  const row = data as CommentRow;
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
