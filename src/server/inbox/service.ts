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
import { conversationIdsWithTags, tagsForConversations } from '@/server/content/service';
import type { Platform, PublicAdmin, ReferralSource } from '@/types/db';

/** ปลดล็อกอัตโนมัติเมื่อไม่มีความเคลื่อนไหวเกินเวลานี้ (สเปก 5.1 : 3 นาที) */
export const LOCK_STALE_SECONDS = 180;

export const INBOX_SELECTS = {
  pages: 'id,platform,page_name,display_name,tag_color',
  conversations: 'id,customer_id,page_id,last_message_at,last_message_preview,last_customer_message_at,is_read,assigned_admin_id,locked_by_admin_id,locked_at,referral_source,referral_ad_id,referral_ref,inbox_status,is_important,meta_spam_synced_at,has_ai_reply,has_ai_handoff',
  customers: 'id,name,username,profile_pic_url,psid,phone,profile_error_th',
  messages: 'id,direction,sender_type,admin_id,text,attachments,sent_with_human_agent_tag,created_at,reply_to_message_id,reply_native',
} as const;

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
  username: string | null;
  profile_pic_url: string | null;
  /** ยังไม่มีชื่อเพราะอะไร — null = ไม่มีปัญหา (D-33) */
  profile_error_th: string | null;
  psid: string;
  phone: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_customer_message_at: string | null;
  is_read: boolean;
  inbox_status: 'active' | 'done' | 'spam';
  is_important: boolean;
  /** สแปมถูกส่งไป Meta สำเร็จเมื่อใด — null = เป็นเพียงสถานะใน HubChat */
  meta_spam_synced_at: string | null;
  assigned_admin_id: string | null;
  assigned_admin_name: string | null;
  has_ai_reply: boolean;
  has_ai_handoff: boolean;
  referral_source: ReferralSource | null;
  referral_ad_id: string | null;
  referral_ref: string | null;
  /** ชื่อแอดมินที่กำลังเปิดห้องนี้อยู่ (null = ว่าง) */
  locked_by_name: string | null;
  locked_by_admin_id: string | null;
  /** แท็กที่ติดอยู่กับห้องนี้ (เก็บเป็น id ให้หน้าเว็บไปจับคู่กับสีเอง) */
  tag_ids: string[];
  /** จำนวนออเดอร์ทั้งหมดของลูกค้ารายนี้ (รวมร่าง/ยกเลิก เพื่อใช้ระบุตัวตนและค้นประวัติ) */
  order_count: number;
};

export type InboxGroup =
  | 'all'
  | 'facebook'
  | 'instagram'
  | 'ai_handoff'
  | 'ai_reply'
  | 'important'
  | 'unread'
  | 'follow_up'
  | 'done'
  | 'spam'
  | 'assigned';

export type MessageRow = {
  id: string;
  direction: 'in' | 'out';
  sender_type: 'customer' | 'admin' | 'bot';
  admin_id: string | null;
  admin_name: string | null;
  text: string | null;
  /**
   * ไฟล์แนบ
   * ⭐ media_id = สำเนาที่เราเก็บไว้เอง (D-17) — ใช้ตัวนี้ก่อนเสมอ
   *    url = ลิงก์ชั่วคราวของ Meta ซึ่งหมดอายุ ใช้เป็นทางสำรองเท่านั้น
   */
  attachments: Array<{ type: string; url?: string; media_id?: string }>;
  sent_with_human_agent_tag: boolean;
  created_at: string;

  /** ตอบกลับข้อความไหน (id ในระบบเรา) */
  reply_to_message_id?: string | null;
  /**
   * ⭐ ส่ง reply_to ไปกับ payload ของ Meta จริงไหม
   *    false = เราเก็บความสัมพันธ์ไว้เองเท่านั้น ลูกค้าไม่เห็นเส้นโยงในแอป Meta
   *    หน้าเว็บต้องไม่บอกว่า "ตอบกลับแล้ว" แบบเดียวกันทั้งสองกรณี
   */
  reply_native?: boolean;
  /** ตัวอย่างข้อความต้นทาง — เอาไว้แสดงในฟองข้อความโดยไม่ต้องยิงถามซ้ำ */
  reply_preview?: { text: string | null; from_customer: boolean } | null;
};

export type ListFilters = {
  page_ids?: string[];
  search?: string;
  group?: InboxGroup;
  /** รองรับผู้เรียกเดิมระหว่างเปลี่ยนมาใช้ group */
  unread_only?: boolean;
  /** รองรับผู้เรียกเดิมระหว่างเปลี่ยนมาใช้ group */
  follow_up_only?: boolean;
  /** กรองเฉพาะห้องที่ติดแท็กใดแท็กหนึ่งในรายการนี้ */
  tag_ids?: string[];
  limit?: number;
  /**
   * ขอห้องที่เก่ากว่าเวลานี้ (ค่าของ last_message_at จากห้องสุดท้ายที่หน้าเว็บถืออยู่)
   * ⭐ ใช้ lte ไม่ใช่ lt เพราะการดึงแชทเก่าเข้ามาทำให้หลายห้องมีเวลาเท่ากันเป๊ะได้
   *    หน้าเว็บกรองตัวซ้ำที่ขอบทิ้งด้วย id เอง
   */
  before?: string | null;
  /** ขอเฉพาะห้องที่มีข้อความใหม่ตั้งแต่เวลานี้ ใช้ polling ไม่ให้โหลดรายการเดิมทั้งก้อน */
  since?: string | null;
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
    .select(INBOX_SELECTS.pages)
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

  const { data, error } = await db().from('admins').select('id,name').in('id', unique);
  if (error) throw new Error(`อ่านชื่อแอดมินไม่สำเร็จ: ${error.message}`);
  return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((a) => [a.id, a.name]));
}

/**
 * ลูกค้าที่มีออเดอร์ในเพจที่แอดมินมองเห็น
 *
 * อ่านเป็นหน้า ๆ เพราะ Data API อาจจำกัดจำนวนแถวต่อคำขอ ถ้าดึงครั้งเดียวแล้ว
 * ถูกตัดที่ 1,000 แถว ห้องเก่าจะหายจากกลุ่มติดตามผลโดยไม่มีคำเตือน
 */
async function customerIdsWithOrders(pageIds: string[]): Promise<string[]> {
  const ids = new Set<string>();
  const pageSize = 1_000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db()
      .from('orders')
      .select('customer_id')
      .in('page_id', pageIds)
      .not('customer_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`อ่านกลุ่มติดตามผลไม่สำเร็จ: ${error.message}`);

    const rows = (data ?? []) as Array<{ customer_id: string | null }>;
    for (const row of rows) if (row.customer_id) ids.add(row.customer_id);
    if (rows.length < pageSize) break;
  }

  return [...ids];
}

/* ------------------------------------------------------------------------ */
/* 1) ลิสต์แชท                                                                */
/* ------------------------------------------------------------------------ */

export async function listConversations(
  admin: PublicAdmin,
  filters: ListFilters = {},
): Promise<{ conversations: ConversationRow[]; pages: InboxPage[]; has_more: boolean; truncated: boolean }> {
  const pages = await visiblePages(admin);
  if (pages.size === 0) return { conversations: [], pages: [], has_more: false, truncated: false };

  // ตัวกรองเพจจากหน้าเว็บ ต้องตัดเพจที่ไม่มีสิทธิ์ทิ้งเสมอ
  const requested = filters.page_ids?.filter((id) => pages.has(id));
  let pageIds = requested && requested.length > 0 ? requested : [...pages.keys()];
  const group = filters.group ?? (filters.follow_up_only ? 'follow_up' : filters.unread_only ? 'unread' : 'all');
  if (group === 'facebook' || group === 'instagram') {
    pageIds = pageIds.filter((id) => pages.get(id)?.platform === group);
    if (pageIds.length === 0) return { conversations: [], pages: [...pages.values()], has_more: false, truncated: false };
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const search = filters.search?.trim();

  /* ค้นสี่ช่องแยก query เพื่อไม่ประกอบ PostgREST filter จากข้อความผู้ใช้ */
  let customerIdFilter: string[] | null = null;
  if (search) {
    const pattern = `%${search.replace(/[%,_()]/g, '')}%`;
    const [byName, byUsername, byPhone, byOrder, byTracking] = await Promise.all([
      db().from('customers').select('id').in('page_id', pageIds).ilike('name', pattern).limit(500),
      db().from('customers').select('id').in('page_id', pageIds).ilike('username', pattern).limit(500),
      db().from('customers').select('id').in('page_id', pageIds).ilike('phone', pattern).limit(500),
      db().from('orders').select('customer_id').in('page_id', pageIds).ilike('order_no', pattern).limit(500),
      db().from('orders').select('customer_id').in('page_id', pageIds).ilike('tracking_no', pattern).limit(500),
    ]);
    for (const result of [byName, byUsername, byPhone, byOrder, byTracking]) {
      if (result.error) throw new Error(`ค้นหาอินบ็อกซ์ไม่สำเร็จ: ${result.error.message}`);
    }
    customerIdFilter = [...new Set([
      ...((byName.data ?? []) as Array<{ id: string }>).map((row) => row.id),
      ...((byUsername.data ?? []) as Array<{ id: string }>).map((row) => row.id),
      ...((byPhone.data ?? []) as Array<{ id: string }>).map((row) => row.id),
      ...((byOrder.data ?? []) as Array<{ customer_id: string | null }>).flatMap((row) => row.customer_id ? [row.customer_id] : []),
      ...((byTracking.data ?? []) as Array<{ customer_id: string | null }>).flatMap((row) => row.customer_id ? [row.customer_id] : []),
    ])];
    if (customerIdFilter.length === 0) {
      return { conversations: [], pages: [...pages.values()], has_more: false, truncated: false };
    }
  }

  /* กลุ่มติดตามผลซิงก์จากออเดอร์โดยตรง ไม่สร้างแท็กเงาที่อาจหลุดกันภายหลัง */
  if (group === 'follow_up') {
    const followUpCustomerIds = await customerIdsWithOrders(pageIds);
    if (followUpCustomerIds.length === 0) {
      return { conversations: [], pages: [...pages.values()], has_more: false, truncated: false };
    }
    const followUpSet = new Set(followUpCustomerIds);
    customerIdFilter = customerIdFilter
      ? customerIdFilter.filter((id) => followUpSet.has(id))
      : followUpCustomerIds;
    if (customerIdFilter.length === 0) {
      return { conversations: [], pages: [...pages.values()], has_more: false, truncated: false };
    }
  }

  /* --- ตัวกรองแท็ก : หาว่าห้องไหนติดแท็กที่เลือกไว้บ้าง --- */
  let conversationIdFilter: string[] | null = null;
  if (filters.tag_ids && filters.tag_ids.length > 0) {
    conversationIdFilter = await conversationIdsWithTags(filters.tag_ids);
    if (conversationIdFilter.length === 0) {
      return { conversations: [], pages: [...pages.values()], has_more: false, truncated: false };
    }
  }

  let query = db()
    .from('conversations')
    .select(INBOX_SELECTS.conversations)
    .in('page_id', pageIds)
    .order('last_message_at', { ascending: Boolean(filters.since) })
    // ⭐ ตัวตัดสินตอนเวลาเท่ากัน — ดูเหตุผลเดียวกับใน listMessages
    .order('id', { ascending: Boolean(filters.since) })
    .limit(limit + 1);

  if (group === 'done' || group === 'spam') query = query.eq('inbox_status', group);
  else query = query.eq('inbox_status', 'active');
  if (group === 'unread') query = query.eq('is_read', false);
  if (group === 'important') query = query.eq('is_important', true);
  if (group === 'assigned') query = query.not('assigned_admin_id', 'is', null);
  if (group === 'ai_reply') query = query.eq('has_ai_reply', true);
  if (group === 'ai_handoff') query = query.eq('has_ai_handoff', true);
  if (customerIdFilter) query = query.in('customer_id', customerIdFilter);
  if (conversationIdFilter) query = query.in('id', conversationIdFilter);
  if (filters.before) query = query.lte('last_message_at', filters.before);
  if (filters.since) query = query.gte('last_message_at', filters.since);

  const { data: convRows, error } = await query;
  if (error) throw new Error(`อ่านลิสต์แชทไม่สำเร็จ: ${error.message}`);

  const allRows = (convRows ?? []) as Array<{
    id: string;
    customer_id: string;
    page_id: string;
    last_message_at: string;
    last_message_preview: string | null;
    last_customer_message_at: string | null;
    is_read: boolean;
    inbox_status: 'active' | 'done' | 'spam';
    is_important: boolean;
    meta_spam_synced_at: string | null;
    assigned_admin_id: string | null;
    has_ai_reply: boolean;
    has_ai_handoff: boolean;
    locked_by_admin_id: string | null;
    locked_at: string | null;
    referral_source: ReferralSource | null;
    referral_ad_id: string | null;
    referral_ref: string | null;
  }>;

  const truncated = Boolean(filters.since) && allRows.length > limit;
  const hasMore = !filters.since && allRows.length > limit;
  const rows = allRows.slice(0, limit);

  if (rows.length === 0) return { conversations: [], pages: [...pages.values()], has_more: false, truncated: false };

  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  const [customers, names, tagMap, orders] = await Promise.all([
    db()
      .from('customers')
      /**
       * ⭐ profile_error_th มาด้วย เพื่อให้หน้าแชทบอกได้ว่า
       *    "ทำไมยังไม่มีชื่อ" แทนที่จะปล่อยให้แอดมินเดา (D-33)
       * ⚠️ ข้อความนี้ถูกรับประกันแล้วว่าไม่มี token ปน (ดู explainProfileError)
       */
      .select(INBOX_SELECTS.customers)
      .in('id', customerIds),
    adminNames(rows.flatMap((r) => [r.locked_by_admin_id, r.assigned_admin_id]).filter((v): v is string => Boolean(v))),
    tagsForConversations(rows.map((r) => r.id)),
    db().from('orders').select('customer_id').in('customer_id', customerIds),
  ]);

  const customerMap = new Map(
    ((customers.data ?? []) as Array<{
      id: string;
      name: string | null;
      username: string | null;
      profile_pic_url: string | null;
      psid: string;
      profile_error_th: string | null;
      phone: string | null;
    }>).map((c) => [c.id, c]),
  );
  if (customers.error) throw new Error(`อ่านข้อมูลลูกค้าไม่สำเร็จ: ${customers.error.message}`);
  if (orders.error) throw new Error(`อ่านจำนวนออเดอร์ไม่สำเร็จ: ${orders.error.message}`);
  const orderCounts = new Map<string, number>();
  for (const order of (orders.data ?? []) as Array<{ customer_id: string | null }>) {
    if (!order.customer_id) continue;
    orderCounts.set(order.customer_id, (orderCounts.get(order.customer_id) ?? 0) + 1);
  }

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
        username: customer.username,
        profile_pic_url: customer.profile_pic_url,
        profile_error_th: customer.profile_error_th,
        psid: customer.psid,
        phone: customer.phone,
        last_message_at: r.last_message_at,
        last_message_preview: r.last_message_preview,
        last_customer_message_at: r.last_customer_message_at,
        is_read: r.is_read,
        inbox_status: r.inbox_status,
        is_important: r.is_important,
        meta_spam_synced_at: r.meta_spam_synced_at,
        assigned_admin_id: r.assigned_admin_id,
        assigned_admin_name: r.assigned_admin_id ? (names.get(r.assigned_admin_id) ?? 'แอดมิน') : null,
        has_ai_reply: r.has_ai_reply,
        has_ai_handoff: r.has_ai_handoff,
        referral_source: r.referral_source,
        referral_ad_id: r.referral_ad_id,
        referral_ref: r.referral_ref,
        locked_by_admin_id: lockAlive ? r.locked_by_admin_id : null,
        locked_by_name: lockAlive ? (names.get(r.locked_by_admin_id!) ?? 'แอดมินคนอื่น') : null,
        tag_ids: tagMap.get(r.id) ?? [],
        order_count: orderCounts.get(r.customer_id) ?? 0,
      },
    ];
  });

  return { conversations, pages: [...pages.values()], has_more: hasMore, truncated };
}

/* ------------------------------------------------------------------------ */
/* 2) ข้อความในห้องแชท                                                        */
/* ------------------------------------------------------------------------ */

/**
 * ตรวจสิทธิ์เข้าถึงห้องแชท — ทุกฟังก์ชันด้านล่างต้องผ่านตัวนี้ก่อนเสมอ
 *
 * ⭐ ส่งออกไปให้โมดูลอื่นใช้ด้วย (เช่น customers/workspace)
 *    เพื่อให้มีด่านสิทธิ์ **ชุดเดียว** ในระบบ
 *    ด่านที่มีสองชุดคือด่านที่จะไม่ตรงกันในวันที่มีคนแก้ชุดเดียว
 */
export async function requireConversationAccess(
  admin: PublicAdmin,
  conversationId: string,
): Promise<{ id: string; customer_id: string; page_id: string }> {
  const { data, error } = await db()
    .from('conversations')
    .select('id,customer_id,page_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (error) throw new Error(`ตรวจสิทธิ์ห้องแชทไม่สำเร็จ: ${error.message}`);
  if (!data) throw new InboxAccessError('ไม่พบห้องแชทนี้');
  const row = data as { id: string; customer_id: string; page_id: string };
  if (!canSeePage(admin.role, admin.allowed_page_ids, row.page_id)) {
    throw new InboxAccessError('คุณไม่มีสิทธิ์เข้าถึงเพจของแชทนี้');
  }
  return row;
}

export type MessagePage = {
  messages: MessageRow[];
  /** true = ยังมีข้อความเก่ากว่านี้อีก — หน้าเว็บเอาไว้ตัดสินใจโชว์ปุ่ม "ดูข้อความเก่ากว่านี้" */
  has_more: boolean;
  /** true = มีข้อความใหม่มากกว่าที่คืนในรอบนี้ ผู้เรียกต้องดึงต่อ ห้ามทำเป็นว่าครบ */
  truncated: boolean;
};

/**
 * อ่านข้อความในห้องแชท (ล่าสุดก่อน แล้วกลับลำดับให้อ่านตามเวลา)
 *
 * @param before ส่งเวลาของข้อความที่เก่าที่สุดที่หน้าเว็บถืออยู่ เพื่อขอของเก่ากว่านั้น
 *
 * ⭐ ใช้ lte ไม่ใช่ lt โดยตั้งใจ :
 *    ข้อความที่ดึงย้อนหลังมาจาก Meta หลายข้อความมีเวลาเท่ากันเป๊ะได้
 *    ถ้าใช้ lt ข้อความที่เวลาตรงกับขอบพอดีจะหายไปเงียบ ๆ ทั้งกลุ่ม
 *    ผลข้างเคียงคือจะได้ของซ้ำมาหนึ่งชุดที่ขอบ — หน้าเว็บกรองด้วย id ทิ้งเอง
 */
export async function listMessages(
  admin: PublicAdmin,
  conversationId: string,
  limit = 100,
  before?: string | null,
  after?: string | null,
): Promise<MessagePage> {
  await requireConversationAccess(admin, conversationId);

  const capped = Math.min(Math.max(limit, 1), 300);

  let query = db()
    .from('messages')
    .select(INBOX_SELECTS.messages)
    .eq('conversation_id', conversationId)
    // ⭐ กรองข้อความที่ถูกลบ "ในฐานข้อมูล" ไม่ใช่กรองทีหลังใน JavaScript
    //    เคยกรองทีหลังแล้วเจอปัญหา : ถ้ามีข้อความถูกลบติดกันเกินขนาดชุดหนึ่งชุด
    //    ชุดที่ได้จะว่างเปล่า หน้าเว็บก็จะเข้าใจว่า "หมดแล้ว" แล้วอ่านของเก่ากว่านั้นไม่ได้อีกเลย
    .eq('is_deleted', false);

  if (before) query = query.lte('created_at', before);
  if (after) query = query.gte('created_at', after);

  const { data, error } = await query
    .order('created_at', { ascending: Boolean(after) })
    // ⭐ ตัวตัดสินตอนเวลาเท่ากันเป๊ะ — จำเป็นมากกับแชทที่ดึงย้อนหลังมาจาก Meta
    //    เพราะ created_time ของ Meta ละเอียดแค่ระดับวินาที ข้อความรัว ๆ จะเวลาซ้ำกัน
    //    ถ้าไม่มีตัวนี้ ลำดับจะไม่คงที่ แล้วการไล่ย้อนหลังจะข้ามข้อความหายไปเงียบ ๆ
    .order('id', { ascending: Boolean(after) })
    .limit(capped + 1);

  if (error) throw new Error(`อ่านข้อความไม่สำเร็จ: ${error.message}`);

  const allRows = (data ?? []) as MessageRow[];
  const truncated = Boolean(after) && allRows.length > capped;
  const hasMore = !after && allRows.length > capped;
  const rows = allRows.slice(0, capped);
  const names = await adminNames(rows.map((m) => m.admin_id).filter((v): v is string => Boolean(v)));

  /**
   * ⭐ ดึงข้อความต้นทางของ "ตอบกลับ" มาทีเดียวทั้งชุด
   *    ไม่ใช่วนถามทีละข้อความ — 100 ข้อความ = 100 รอบไป-กลับฐานข้อมูล
   *
   * ⚠️ ต้องจำกัดเฉพาะห้องนี้ด้วย แม้ trigger จะกันข้ามห้องไว้แล้ว
   *    เป็นการกันชั้นที่สองเผื่อมีข้อมูลเก่าที่เข้ามาก่อนมี trigger
   */
  const replyIds = [...new Set(
    rows.map((m) => m.reply_to_message_id).filter((v): v is string => Boolean(v)),
  )];
  const replyMap = new Map<string, { text: string | null; from_customer: boolean }>();
  if (replyIds.length > 0) {
    const { data: originals, error: originalsError } = await db()
      .from('messages')
      .select('id,text,direction')
      .eq('conversation_id', conversationId)
      .in('id', replyIds);
    if (originalsError) throw new Error(`อ่านข้อความต้นทางไม่สำเร็จ: ${originalsError.message}`);
    for (const o of (originals ?? []) as Array<{ id: string; text: string | null; direction: 'in' | 'out' }>) {
      replyMap.set(o.id, { text: o.text, from_customer: o.direction === 'in' });
    }
  }

  // ดึงมาจากใหม่ไปเก่าเพื่อให้ได้ "ล่าสุด N ข้อความ" แล้วค่อยกลับลำดับให้อ่านตามเวลา
  const messages = rows
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
      reply_to_message_id: m.reply_to_message_id ?? null,
      reply_native: m.reply_native ?? false,
      // ไม่เจอต้นทาง = ถูกลบไปแล้ว → แสดงว่า "ข้อความถูกลบ" ดีกว่าซ่อนเงียบ ๆ
      reply_preview: m.reply_to_message_id ? (replyMap.get(m.reply_to_message_id) ?? null) : null,
    }));
  if (!after) messages.reverse();

  return { messages, has_more: hasMore, truncated };
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

/* ------------------------------------------------------------------------ */
/* 4) เปิดให้ route อื่นตรวจสิทธิ์ห้องแชทได้                                     */
/* ------------------------------------------------------------------------ */

/** โยน InboxAccessError ถ้าแอดมินคนนี้ไม่มีสิทธิ์แตะห้องแชทนี้ */
export async function assertConversationAccess(
  admin: PublicAdmin,
  conversationId: string,
): Promise<{ id: string; customer_id: string; page_id: string }> {
  return requireConversationAccess(admin, conversationId);
}

/* ------------------------------------------------------------------------ */
/* 5) บันทึกที่อยู่/เบอร์ของลูกค้า (สเปกหัวข้อ 5.2)                              */
/* ------------------------------------------------------------------------ */

export type CustomerContact = {
  recipient_name?: string | null;
  phone?: string | null;
  postcode?: string | null;
  address?: string | null;
};

/**
 * บันทึกข้อมูลติดต่อของลูกค้า
 * ⭐ ค่าที่ส่งเข้ามาต้องเป็นค่าที่ "แอดมินตรวจแล้ว" เสมอ (สเปก 5.2)
 *    ระบบไม่เขียนทับข้อมูลลูกค้าจากตัวดึงอัตโนมัติเองเด็ดขาด
 *
 * ⚠️ แก้ได้เฉพาะ 4 ช่องนี้เท่านั้น ห้ามให้เขียนช่องอื่น
 *    โดยเฉพาะ last_customer_message_at ที่ Policy Engine ใช้ตัดสิน
 */
export async function updateCustomerContact(
  admin: PublicAdmin,
  conversationId: string,
  contact: CustomerContact,
  /**
   * ⭐ ข้อมูลชุดนี้ดึงมาจากข้อความไหน (ข้อ 1.5)
   *
   *    ทำไมต้องเก็บ : วันหลังถ้าที่อยู่ผิด จะไม่มีใครรู้ว่ามันมาจากข้อความไหน
   *    ต้องไล่อ่านแชททั้งห้องเพื่อหาว่าลูกค้าพิมพ์อะไรไว้กันแน่
   */
  sourceMessageId?: string | null,
): Promise<void> {
  const conv = await requireConversationAccess(admin, conversationId);

  const patch: Record<string, unknown> = {};
  if (contact.recipient_name !== undefined) patch.recipient_name = contact.recipient_name?.trim() || null;
  if (contact.phone !== undefined) patch.phone = contact.phone?.trim() || null;
  if (contact.postcode !== undefined) patch.postcode = contact.postcode?.trim() || null;
  if (contact.address !== undefined) patch.address = contact.address?.trim() || null;
  if (Object.keys(patch).length === 0) return;

  patch.contact_updated_at = new Date().toISOString();
  patch.contact_updated_by = admin.id;

  /**
   * ⚠️ ต้องตรวจว่าข้อความต้นทางอยู่ห้องนี้จริง ก่อนเก็บเป็นร่องรอย
   *    ไม่งั้นหน้าเว็บจะยัด id ข้อความของห้องอื่นมาผูกไว้ได้
   *    (กฎเดียวกับการตอบกลับข้อความใน 0015)
   */
  if (sourceMessageId) {
    const { data: src } = await db()
      .from('messages')
      .select('id')
      .eq('id', sourceMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();
    if (src) patch.contact_source_message_id = sourceMessageId;
  }

  const { error } = await db().from('customers').update(patch).eq('id', conv.customer_id);
  if (error) throw new Error(`บันทึกข้อมูลลูกค้าไม่สำเร็จ: ${error.message}`);
}

/** ข้อมูลติดต่อปัจจุบันของลูกค้าในห้องนี้ — ใช้เติมฟอร์มให้แอดมินตรวจ */
export async function getCustomerContact(
  admin: PublicAdmin,
  conversationId: string,
): Promise<CustomerContact> {
  const conv = await requireConversationAccess(admin, conversationId);
  const { data } = await db()
    .from('customers')
    .select('recipient_name,phone,postcode,address')
    .eq('id', conv.customer_id)
    .maybeSingle();
  return (data as CustomerContact | null) ?? {};
}
