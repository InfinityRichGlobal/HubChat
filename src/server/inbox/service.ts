import 'server-only';
/**
 * ชั้นข้อมูลของหน้าอินบ็อกซ์
 * ===========================================================================
 * หลักการของไฟล์นี้ :
 *
 *   1. ⭐ สิทธิ์รายเพจต้องถูกบังคับที่นี่ ไม่ใช่ที่หน้าเว็บ
 *      แอดมินที่ไม่มีสิทธิ์เห็นเพจไหน ต้องไม่ได้ข้อมูลของเพจนั้นกลับไปเลย
 *      แม้แต่ชื่อลูกค้า (สเปกหัวข้อ 6.6)
 *
 *   2. ⭐ ห้ามส่ง access token ของเพจออกไปพร้อมข้อมูลแชท
 *      จึงเลือกคอลัมน์ทีละชื่อเสมอ ไม่ใช้ select('*')
 *
 *   3. การล็อกกันแอดมินชนให้ฐานข้อมูลตัดสิน (สเปกหัวข้อ 5.1)
 *      สองคนกดเข้าห้องเดียวกันพร้อมกันได้จริง โค้ด JavaScript ตัดสินไม่ได้
 */
import { db } from '@/lib/supabase/admin';
import { canSeePage } from '@/lib/auth/permissions';
import type { Platform, PublicAdmin, ReferralSource } from '@/types/db';

/** ปลดล็อกอัตโนมัติเมื่อไม่มีความเคลื่อนไหวเกินเวลานี้ (สเปก 5.1 : 3 นาที) */
export const LOCK_STALE_SECONDS = 180;

/* ------------------------------------------------------------------------ */
/* ชนิดข้อมูลที่ส่งออกไปฝั่งหน้าเว็บ                                            */
/* ------------------------------------------------------------------------ */

export type InboxPage = {
  id: string;
  platform: Platform;
  name: string;
  tag_color: string;
};

export type ConversationRow = {
  id: string;
  customer_id: string;
  page: InboxPage;
  customer_name: string | null;
  profile_pic_url: string | null;
  psid: string;
  phone: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_customer_message_at: string | null;
  is_read: boolean;
  referral_source: ReferralSource | null;
  referral_ad_id: string | null;
  referral_ref: string | null;
  /** ชื่อแอดมินที่กำลังเปิดห้องนี้อยู่ (null = ว่าง) */
  locked_by_name: string | null;
  locked_by_admin_id: string | null;
};

export type MessageRow = {
  id: string;
  direction: 'in' | 'out';
  sender_type: 'customer' | 'admin' | 'bot';
  admin_id: string | null;
  admin_name: string | null;
  text: string | null;
  attachments: Array<{ type: string; url?: string }>;
  sent_with_human_agent_tag: boolean;
  created_at: string;
};

export type ListFilters = {
  page_ids?: string[];
  search?: string;
  unread_only?: boolean;
  limit?: number;
};

export class InboxAccessError extends Error {}

/* ------------------------------------------------------------------------ */
/* ตัวช่วย                                                                    */
/* ------------------------------------------------------------------------ */

type PageMap = Map<string, InboxPage>;

/** เพจที่แอดมินคนนี้มีสิทธิ์เห็น — ด่านความปลอดภัยหลักของไฟล์นี้ */
async function visiblePages(admin: PublicAdmin): Promise<PageMap> {
  const { data, error } = await db()
    .from('pages')
    .select('id,platform,page_name,display_name,tag_color')
    .order('created_at');
  if (error) throw new Error(`อ่านรายชื่อเพจไม่สำเร็จ: ${error.message}`);

  const map: PageMap = new Map();
  for (const row of (data ?? []) as Array<{
    id: string;
    platform: Platform;
    page_name: string;
    display_name: string | null;
    tag_color: string;
  }>) {
    if (!canSeePage(admin.role, admin.allowed_page_ids, row.id)) continue;
    map.set(row.id, {
      id: row.id,
      platform: row.platform,
      name: row.display_name || row.page_name,
      tag_color: row.tag_color,
    });
  }
  return map;
}

/** ชื่อแอดมินไว้โชว์ว่า "ใครเปิดห้องนี้อยู่" / "ใครเป็นคนตอบ" */
async function adminNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const { data } = await db().from('admins').select('id,name').in('id', unique);
  return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((a) => [a.id, a.name]));
}

/* ------------------------------------------------------------------------ */
/* 1) ลิสต์แชท                                                                */
/* ------------------------------------------------------------------------ */

export async function listConversations(
  admin: PublicAdmin,
  filters: ListFilters = {},
): Promise<{ conversations: ConversationRow[]; pages: InboxPage[] }> {
  const pages = await visiblePages(admin);
  if (pages.size === 0) return { conversations: [], pages: [] };

  // ตัวกรองเพจจากหน้าเว็บ ต้องตัดเพจที่ไม่มีสิทธิ์ทิ้งเสมอ
  const requested = filters.page_ids?.filter((id) => pages.has(id));
  const pageIds = requested && requested.length > 0 ? requested : [...pages.keys()];

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const search = filters.search?.trim();

  /* --- ถ้ามีคำค้น ให้หาจากฝั่งลูกค้าก่อน แล้วค่อยกรองห้องแชท --------------
     รอบนี้ค้นได้จาก "ชื่อ" กับ "เบอร์" — เลขออเดอร์/เลขพัสดุยังไม่มีตาราง
     ที่มีข้อมูลจริง (มาในรอบ 5) จึงยังไม่รวมไว้ */
  let customerIdFilter: string[] | null = null;
  if (search) {
    const { data } = await db()
      .from('customers')
      .select('id')
      .in('page_id', pageIds)
      .or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
      .limit(500);
    customerIdFilter = ((data ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (customerIdFilter.length === 0) return { conversations: [], pages: [...pages.values()] };
  }

  let query = db()
    .from('conversations')
    .select(
      'id,customer_id,page_id,last_message_at,last_message_preview,last_customer_message_at,' +
        'is_read,locked_by_admin_id,locked_at,referral_source,referral_ad_id,referral_ref',
    )
    .in('page_id', pageIds)
    .order('last_message_at', { ascending: false })
    .limit(limit);

  if (filters.unread_only) query = query.eq('is_read', false);
  if (customerIdFilter) query = query.in('customer_id', customerIdFilter);

  const { data: convRows, error } = await query;
  if (error) throw new Error(`อ่านลิสต์แชทไม่สำเร็จ: ${error.message}`);

  const rows = (convRows ?? []) as unknown as Array<{
    id: string;
    customer_id: string;
    page_id: string;
    last_message_at: string;
    last_message_preview: string | null;
    last_customer_message_at: string | null;
    is_read: boolean;
    locked_by_admin_id: string | null;
    locked_at: string | null;
    referral_source: ReferralSource | null;
    referral_ad_id: string | null;
    referral_ref: string | null;
  }>;

  if (rows.length === 0) return { conversations: [], pages: [...pages.values()] };

  const [customers, names] = await Promise.all([
    db()
      .from('customers')
      .select('id,name,profile_pic_url,psid,phone')
      .in('id', [...new Set(rows.map((r) => r.customer_id))]),
    adminNames(rows.map((r) => r.locked_by_admin_id).filter((v): v is string => Boolean(v))),
  ]);

  const customerMap = new Map(
    ((customers.data ?? []) as Array<{
      id: string;
      name: string | null;
      profile_pic_url: string | null;
      psid: string;
      phone: string | null;
    }>).map((c) => [c.id, c]),
  );

  const staleBefore = Date.now() - LOCK_STALE_SECONDS * 1000;

  const conversations: ConversationRow[] = rows.flatMap((r) => {
    const page = pages.get(r.page_id);
    const customer = customerMap.get(r.customer_id);
    // เพจที่ไม่มีสิทธิ์เห็น หรือข้อมูลลูกค้าหาย → ตัดออก ไม่เดา
    if (!page || !customer) return [];

    // ล็อกที่เงียบเกินเวลาแล้ว ให้ถือว่าว่าง (ไม่ต้องรอให้ใครมาปลด)
    const lockAlive =
      r.locked_by_admin_id !== null && r.locked_at !== null && new Date(r.locked_at).getTime() > staleBefore;

    return [
      {
        id: r.id,
        customer_id: r.customer_id,
        page,
        customer_name: customer.name,
        profile_pic_url: customer.profile_pic_url,
        psid: customer.psid,
        phone: customer.phone,
        last_message_at: r.last_message_at,
        last_message_preview: r.last_message_preview,
        last_customer_message_at: r.last_customer_message_at,
        is_read: r.is_read,
        referral_source: r.referral_source,
        referral_ad_id: r.referral_ad_id,
        referral_ref: r.referral_ref,
        locked_by_admin_id: lockAlive ? r.locked_by_admin_id : null,
        locked_by_name: lockAlive ? (names.get(r.locked_by_admin_id!) ?? 'แอดมินคนอื่น') : null,
      },
    ];
  });

  return { conversations, pages: [...pages.values()] };
}

/* ------------------------------------------------------------------------ */
/* 2) ข้อความในห้องแชท                                                        */
/* ------------------------------------------------------------------------ */

/** ตรวจสิทธิ์เข้าถึงห้องแชท — ทุกฟังก์ชันด้านล่างต้องผ่านตัวนี้ก่อนเสมอ */
async function requireConversationAccess(
  admin: PublicAdmin,
  conversationId: string,
): Promise<{ id: string; customer_id: string; page_id: string }> {
  const { data } = await db()
    .from('conversations')
    .select('id,customer_id,page_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (!data) throw new InboxAccessError('ไม่พบห้องแชทนี้');
  const row = data as { id: string; customer_id: string; page_id: string };
  if (!canSeePage(admin.role, admin.allowed_page_ids, row.page_id)) {
    throw new InboxAccessError('คุณไม่มีสิทธิ์เข้าถึงเพจของแชทนี้');
  }
  return row;
}

export async function listMessages(
  admin: PublicAdmin,
  conversationId: string,
  limit = 100,
): Promise<MessageRow[]> {
  await requireConversationAccess(admin, conversationId);

  const { data, error } = await db()
    .from('messages')
    .select('id,direction,sender_type,admin_id,text,attachments,sent_with_human_agent_tag,created_at,is_deleted')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 300));

  if (error) throw new Error(`อ่านข้อความไม่สำเร็จ: ${error.message}`);

  const rows = ((data ?? []) as Array<MessageRow & { is_deleted: boolean }>).filter((m) => !m.is_deleted);
  const names = await adminNames(rows.map((m) => m.admin_id).filter((v): v is string => Boolean(v)));

  // ดึงมาจากใหม่ไปเก่าเพื่อให้ได้ "ล่าสุด N ข้อความ" แล้วค่อยกลับลำดับให้อ่านตามเวลา
  return rows
    .map((m) => ({
      id: m.id,
      direction: m.direction,
      sender_type: m.sender_type,
      admin_id: m.admin_id,
      admin_name: m.admin_id ? (names.get(m.admin_id) ?? null) : null,
      text: m.text,
      attachments: Array.isArray(m.attachments) ? m.attachments : [],
      sent_with_human_agent_tag: m.sent_with_human_agent_tag,
      created_at: m.created_at,
    }))
    .reverse();
}

/* ------------------------------------------------------------------------ */
/* 3) อ่านแล้ว + ล็อกกันแอดมินชน                                               */
/* ------------------------------------------------------------------------ */

export async function markRead(admin: PublicAdmin, conversationId: string): Promise<void> {
  await requireConversationAccess(admin, conversationId);
  const { error } = await db().rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
    p_admin_id: admin.id,
  });
  if (error) throw new Error(`ทำเครื่องหมายอ่านแล้วไม่สำเร็จ: ${error.message}`);
}

export type LockResult = {
  won: boolean;
  locked_by_admin_id: string | null;
  locked_by_name: string | null;
  locked_at: string | null;
};

/**
 * ขอถือห้องแชทนี้ไว้
 * เรียกซ้ำได้เรื่อย ๆ ระหว่างที่แอดมินยังเปิดหน้าอยู่ (ต่ออายุล็อก)
 */
export async function acquireLock(admin: PublicAdmin, conversationId: string): Promise<LockResult> {
  await requireConversationAccess(admin, conversationId);

  const { data, error } = await db().rpc('acquire_conversation_lock', {
    p_conversation_id: conversationId,
    p_admin_id: admin.id,
    p_stale_seconds: LOCK_STALE_SECONDS,
  });
  if (error) throw new Error(`ขอล็อกห้องแชทไม่สำเร็จ: ${error.message}`);

  const rows = (Array.isArray(data) ? data : [data]) as Array<{
    won: boolean;
    locked_by_admin_id: string | null;
    locked_at: string | null;
  }>;
  const row = rows[0];
  if (!row) throw new Error('ฐานข้อมูลไม่ได้ตอบผลการขอล็อกกลับมา');

  const names = row.locked_by_admin_id ? await adminNames([row.locked_by_admin_id]) : new Map();

  return {
    won: row.won,
    locked_by_admin_id: row.locked_by_admin_id,
    locked_by_name: row.locked_by_admin_id
      ? (names.get(row.locked_by_admin_id) ?? 'แอดมินคนอื่น')
      : null,
    locked_at: row.locked_at,
  };
}

export async function releaseLock(admin: PublicAdmin, conversationId: string): Promise<void> {
  await requireConversationAccess(admin, conversationId);
  const { error } = await db().rpc('release_conversation_lock', {
    p_conversation_id: conversationId,
    p_admin_id: admin.id,
  });
  if (error) console.error('[inbox] ปล่อยล็อกไม่สำเร็จ:', error.message);
}
