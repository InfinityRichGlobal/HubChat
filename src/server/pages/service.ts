import 'server-only';
/**
 * จัดการเพจที่เชื่อมไว้
 * ===========================================================================
 * ⭐ กฎเหล็กของไฟล์นี้ (เช็คลิสต์ความปลอดภัยข้อ 1 และข้อ 7) :
 *
 *   1. access token ต้องถูกเข้ารหัสก่อนเก็บลงฐานข้อมูล "เสมอ"
 *   2. ห้ามส่ง access token กลับออกไปทาง API "ไม่ว่ากรณีใด"
 *      แม้แต่เจ้าของร้านก็ไม่ต้องเห็น — เห็นแล้วไม่ได้ช่วยอะไร
 *      มีแต่จะเสี่ยงหลุดจากประวัติเบราว์เซอร์ / ภาพหน้าจอ / log
 *      เราบอกแค่ "มี token แล้วหรือยัง" และ "ทดสอบแล้วผ่านไหม" ก็พอ
 */
import { db } from '@/lib/supabase/admin';
import { encryptSecret } from '@/lib/crypto';
import { verifyPageConnection } from '@/server/meta/page-check';
import type { Platform, PublicAdmin } from '@/types/db';

/** ข้อมูลเพจที่ปลอดภัยพอจะส่งออก API — ไม่มี token เด็ดขาด */
export type SafePage = {
  id: string;
  platform: Platform;
  page_id: string;
  page_name: string;
  display_name: string | null;
  tag_color: string;
  is_active: boolean;
  /** มี token เก็บไว้แล้วหรือยัง (ไม่บอกว่า token คืออะไร) */
  has_token: boolean;
  created_at: string;
};

type PageRow = SafePage & { access_token: string | null };

const SAFE_COLUMNS = 'id,platform,page_id,page_name,display_name,tag_color,is_active,created_at,access_token';

function toSafe(row: PageRow): SafePage {
  const { access_token, ...rest } = row;
  return { ...rest, has_token: Boolean(access_token) };
}

/* ------------------------------------------------------------------------ */
/* อ่าน                                                                       */
/* ------------------------------------------------------------------------ */

/**
 * ลิสต์เพจที่แอดมินคนนี้มีสิทธิ์เห็น
 * เจ้าของเห็นทุกเพจ / คนอื่นเห็นเฉพาะที่อยู่ใน allowed_page_ids (สเปกหัวข้อ 6.6)
 */
export async function listPagesFor(admin: PublicAdmin): Promise<SafePage[]> {
  const { data, error } = await db().from('pages').select(SAFE_COLUMNS).order('created_at');
  if (error) throw new Error(`อ่านรายชื่อเพจไม่สำเร็จ: ${error.message}`);

  const rows = (data ?? []) as PageRow[];
  const visible =
    admin.role === 'owner' ? rows : rows.filter((r) => admin.allowed_page_ids.includes(r.id));

  return visible.map(toSafe);
}

async function getRow(id: string): Promise<PageRow | null> {
  const { data, error } = await db().from('pages').select(SAFE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`อ่านข้อมูลเพจไม่สำเร็จ: ${error.message}`);
  return (data as PageRow | null) ?? null;
}

/* ------------------------------------------------------------------------ */
/* เขียน                                                                      */
/* ------------------------------------------------------------------------ */

export type CreatePageInput = {
  platform: Platform;
  page_id: string;
  page_name: string;
  display_name?: string | null;
  tag_color?: string;
  access_token?: string | null;
};

export class PageConflictError extends Error {}

export async function createPage(input: CreatePageInput): Promise<SafePage> {
  const { data, error } = await db()
    .from('pages')
    .insert({
      platform: input.platform,
      page_id: input.page_id.trim(),
      page_name: input.page_name.trim(),
      display_name: input.display_name?.trim() || null,
      tag_color: input.tag_color || '#3b82f6',
      // ⭐ เข้ารหัสตรงนี้ที่เดียว — ไม่มีเส้นทางอื่นที่เขียน token ลงตารางนี้
      access_token: input.access_token ? encryptSecret(input.access_token.trim()) : null,
    })
    .select(SAFE_COLUMNS)
    .single();

  if (error) {
    // 23505 = ชนกับ unique index (platform, page_id)
    if (error.code === '23505') {
      throw new PageConflictError('เพจนี้ถูกเชื่อมไว้แล้ว — แก้ไขของเดิมแทนการเพิ่มใหม่');
    }
    throw new Error(`บันทึกเพจไม่สำเร็จ: ${error.message}`);
  }

  return toSafe(data as PageRow);
}

export type UpdatePageInput = {
  page_name?: string;
  display_name?: string | null;
  tag_color?: string;
  is_active?: boolean;
  /** ใส่ค่าใหม่เพื่อเปลี่ยน token / เว้นไว้ = ไม่แตะของเดิม */
  access_token?: string;
};

export async function updatePage(id: string, input: UpdatePageInput): Promise<SafePage | null> {
  const patch: Record<string, unknown> = {};
  if (input.page_name !== undefined) patch.page_name = input.page_name.trim();
  if (input.display_name !== undefined) patch.display_name = input.display_name?.trim() || null;
  if (input.tag_color !== undefined) patch.tag_color = input.tag_color;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (input.access_token !== undefined && input.access_token.trim().length > 0) {
    patch.access_token = encryptSecret(input.access_token.trim());
  }

  if (Object.keys(patch).length === 0) return getRow(id).then((r) => (r ? toSafe(r) : null));

  const { data, error } = await db().from('pages').update(patch).eq('id', id).select(SAFE_COLUMNS).maybeSingle();
  if (error) throw new Error(`แก้ไขเพจไม่สำเร็จ: ${error.message}`);
  return data ? toSafe(data as PageRow) : null;
}

/* ------------------------------------------------------------------------ */
/* ทดสอบการเชื่อมต่อ                                                           */
/* ------------------------------------------------------------------------ */

export type PageTestResult =
  | { ok: true; page_name: string; message_th: string }
  | { ok: false; message_th: string };

/**
 * ยิงถาม Meta ว่า token ของเพจนี้ใช้ได้จริงไหม
 * ถ้าผ่าน จะอัปเดตชื่อเพจให้ตรงกับที่ Meta บอกด้วย (กันพิมพ์ชื่อผิดเอง)
 */
export async function testPageConnection(id: string): Promise<PageTestResult> {
  const row = await getRow(id);
  if (!row) return { ok: false, message_th: 'ไม่พบเพจนี้' };
  if (!row.access_token) {
    return { ok: false, message_th: 'เพจนี้ยังไม่มี access token — ใส่ token ก่อนแล้วค่อยทดสอบ' };
  }

  const result = await verifyPageConnection({
    id: row.id,
    platform: row.platform,
    page_id: row.page_id,
    access_token: row.access_token,
  });

  if (!result.ok) return result;

  if (result.page_name !== row.page_name) {
    await db().from('pages').update({ page_name: result.page_name }).eq('id', id);
  }

  return {
    ok: true,
    page_name: result.page_name,
    message_th: `เชื่อมต่อสำเร็จ — Meta ยืนยันว่านี่คือเพจ "${result.page_name}"`,
  };
}
