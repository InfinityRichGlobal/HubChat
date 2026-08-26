import 'server-only';
/**
 * ชุดคำตอบ + แท็ก — ชั้นข้อมูล (สเปกหัวข้อ 5.1 / 5.6)
 * ===========================================================================
 * ⚠️ ไฟล์นี้ไม่มีการส่งข้อความออกไปหาลูกค้าเลยแม้แต่ที่เดียว
 *    ชุดคำตอบคือ "ข้อความสำเร็จรูปที่เอาไปวางในช่องพิมพ์"
 *    แอดมินยังต้องกดส่งเองเสมอ ซึ่งจะวิ่งผ่าน sendMessage() ตามปกติ
 *
 *    (การตอบอัตโนมัติจริง ๆ เป็นงานของรอบถัดไป และตั้งใจแยกออกมา
 *     เพราะนั่นคือครั้งแรกที่ระบบส่งข้อความเองโดยไม่มีคนกด)
 */
import { db } from '@/lib/supabase/admin';
import type { ImageRef } from '@/types/db';

/* ------------------------------------------------------------------------ */
/* ชุดคำตอบ                                                                   */
/* ------------------------------------------------------------------------ */

export type CannedResponse = {
  id: string;
  category: string | null;
  title: string;
  shortcut: string | null;
  text: string | null;
  images: ImageRef[];
  use_count: number;
  sort_order: number;
};

const CANNED_COLUMNS = 'id,category,title,shortcut,text,images,use_count,sort_order';

export class ContentConflictError extends Error {}

/**
 * ลิสต์ชุดคำตอบ เรียงตาม "ใช้บ่อย" ก่อน แล้วค่อยตามลำดับที่ตั้งไว้
 * เพราะอันที่ใช้ประจำควรลอยขึ้นมาให้กดเร็วที่สุด
 */
export async function listCanned(search?: string): Promise<CannedResponse[]> {
  let query = db()
    .from('canned_responses')
    .select(CANNED_COLUMNS)
    .order('use_count', { ascending: false })
    .limit(200);

  const term = search?.trim();
  if (term) {
    // ค้นจากทั้งชื่อ ตัวย่อ และเนื้อข้อความ — แอดมินจำได้ไม่เหมือนกัน
    query = query.or(`title.ilike.%${term}%,shortcut.ilike.%${term}%,text.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`อ่านชุดคำตอบไม่สำเร็จ: ${error.message}`);
  return (data ?? []) as CannedResponse[];
}

export type CannedInput = {
  title: string;
  shortcut?: string | null;
  category?: string | null;
  text?: string | null;
  images?: ImageRef[];
  sort_order?: number;
};

export async function createCanned(input: CannedInput): Promise<CannedResponse> {
  const { data, error } = await db()
    .from('canned_responses')
    .insert({
      title: input.title.trim(),
      shortcut: input.shortcut?.trim() || null,
      category: input.category?.trim() || null,
      text: input.text ?? null,
      images: input.images ?? [],
      sort_order: input.sort_order ?? 0,
    })
    .select(CANNED_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') throw new ContentConflictError('ตัวย่อนี้ถูกใช้ไปแล้ว เลือกคำอื่น');
    throw new Error(`บันทึกชุดคำตอบไม่สำเร็จ: ${error.message}`);
  }
  return data as CannedResponse;
}

export async function updateCanned(id: string, input: Partial<CannedInput>): Promise<CannedResponse | null> {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.shortcut !== undefined) patch.shortcut = input.shortcut?.trim() || null;
  if (input.category !== undefined) patch.category = input.category?.trim() || null;
  if (input.text !== undefined) patch.text = input.text;
  if (input.images !== undefined) patch.images = input.images;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (Object.keys(patch).length === 0) return null;

  const { data, error } = await db()
    .from('canned_responses')
    .update(patch)
    .eq('id', id)
    .select(CANNED_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '23505') throw new ContentConflictError('ตัวย่อนี้ถูกใช้ไปแล้ว เลือกคำอื่น');
    throw new Error(`แก้ไขชุดคำตอบไม่สำเร็จ: ${error.message}`);
  }
  return (data as CannedResponse) ?? null;
}

export async function deleteCanned(id: string): Promise<void> {
  const { error } = await db().from('canned_responses').delete().eq('id', id);
  if (error) throw new Error(`ลบชุดคำตอบไม่สำเร็จ: ${error.message}`);
}

/**
 * นับว่าถูกหยิบไปใช้อีกครั้ง
 * ⚠️ ล้มเหลวได้โดยไม่กระทบอะไร — ตัวเลขนี้มีไว้จัดลำดับเฉย ๆ
 */
export async function bumpCannedUse(id: string): Promise<void> {
  try {
    const { error } = await db().rpc('bump_canned_use', { p_id: id });
    if (error) console.error('[content] นับการใช้ชุดคำตอบไม่สำเร็จ:', error.message);
  } catch (e) {
    console.error('[content] นับการใช้ชุดคำตอบไม่สำเร็จ:', e);
  }
}

/* ------------------------------------------------------------------------ */
/* แท็ก                                                                       */
/* ------------------------------------------------------------------------ */

export type Tag = {
  id: string;
  name: string;
  color: string;
  is_auto: boolean;
  sort_order: number;
};

const TAG_COLUMNS = 'id,name,color,is_auto,sort_order';

export async function listTags(): Promise<Tag[]> {
  const { data, error } = await db()
    .from('tags')
    .select(TAG_COLUMNS)
    .order('sort_order', { ascending: true })
    .limit(200);
  if (error) throw new Error(`อ่านรายชื่อแท็กไม่สำเร็จ: ${error.message}`);
  return (data ?? []) as Tag[];
}

export async function createTag(input: { name: string; color?: string; sort_order?: number }): Promise<Tag> {
  const { data, error } = await db()
    .from('tags')
    .insert({
      name: input.name.trim(),
      color: input.color || '#64748b',
      // แท็กที่แอดมินสร้างเอง = ไม่ใช่แท็กอัตโนมัติ
      is_auto: false,
      sort_order: input.sort_order ?? 0,
    })
    .select(TAG_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') throw new ContentConflictError('มีแท็กชื่อนี้อยู่แล้ว');
    throw new Error(`สร้างแท็กไม่สำเร็จ: ${error.message}`);
  }
  return data as Tag;
}

export async function updateTag(
  id: string,
  input: { name?: string; color?: string; sort_order?: number },
): Promise<Tag | null> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.color !== undefined) patch.color = input.color;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (Object.keys(patch).length === 0) return null;

  const { data, error } = await db().from('tags').update(patch).eq('id', id).select(TAG_COLUMNS).maybeSingle();
  if (error) {
    if (error.code === '23505') throw new ContentConflictError('มีแท็กชื่อนี้อยู่แล้ว');
    throw new Error(`แก้ไขแท็กไม่สำเร็จ: ${error.message}`);
  }
  return (data as Tag) ?? null;
}

export async function deleteTag(id: string): Promise<void> {
  // conversation_tags มี on delete cascade อยู่แล้ว — แท็กที่ติดห้องแชทจะหลุดตามไปเอง
  const { error } = await db().from('tags').delete().eq('id', id);
  if (error) throw new Error(`ลบแท็กไม่สำเร็จ: ${error.message}`);
}

/* ------------------------------------------------------------------------ */
/* แท็กของห้องแชท                                                              */
/* ------------------------------------------------------------------------ */

/** แท็กที่ติดอยู่กับห้องแชทหลาย ๆ ห้อง — ใช้ตอนวาดลิสต์แชท */
export async function tagsForConversations(conversationIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (conversationIds.length === 0) return map;

  const { data, error } = await db()
    .from('conversation_tags')
    .select('conversation_id,tag_id')
    .in('conversation_id', conversationIds);
  if (error) throw new Error(`อ่านแท็กของห้องแชทไม่สำเร็จ: ${error.message}`);

  for (const row of (data ?? []) as Array<{ conversation_id: string; tag_id: string }>) {
    const list = map.get(row.conversation_id) ?? [];
    list.push(row.tag_id);
    map.set(row.conversation_id, list);
  }
  return map;
}

/** ห้องแชทที่ติดแท็กเหล่านี้ (ใช้เป็นตัวกรองในลิสต์แชท) */
export async function conversationIdsWithTags(tagIds: string[]): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const { data, error } = await db()
    .from('conversation_tags')
    .select('conversation_id')
    .in('tag_id', tagIds)
    .limit(2000);
  if (error) throw new Error(`กรองตามแท็กไม่สำเร็จ: ${error.message}`);
  return [...new Set(((data ?? []) as Array<{ conversation_id: string }>).map((r) => r.conversation_id))];
}

export async function setConversationTag(params: {
  conversation_id: string;
  tag_id: string;
  admin_id: string;
  attached: boolean;
}): Promise<void> {
  const { error } = await db().rpc('set_conversation_tag', {
    p_conversation_id: params.conversation_id,
    p_tag_id: params.tag_id,
    p_admin_id: params.admin_id,
    p_attached: params.attached,
  });
  if (error) throw new Error(`ใส่/ถอดแท็กไม่สำเร็จ: ${error.message}`);
}
