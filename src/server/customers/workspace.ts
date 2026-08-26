import 'server-only';
/**
 * พื้นที่ทำงานของลูกค้าในห้องแชท (ก้อน 2 ข้อ 1.6 / 1.11)
 * ===========================================================================
 * รวมของสามอย่างที่แอดมินต้องดูบ่อยที่สุดไว้ที่เดียว โดยไม่ต้องออกจากอินบ็อกซ์ :
 *   ข้อมูลลูกค้า | ออเดอร์ของลูกค้าคนนี้ | บันทึกภายใน
 *
 * ⚠️ ตั้งใจ **ไม่** ทำเป็น CRM ใหญ่
 *    ร้าน 3-5 แอดมินไม่ได้ต้องการ segment / lifecycle / lead score
 *    ต้องการแค่ "คนนี้เคยซื้ออะไร เบอร์อะไร มีอะไรต้องระวังไหม"
 *    ของที่ใส่เกินมาคือของที่ต้องดูแลต่อไปตลอดโดยไม่มีใครใช้
 *
 * 🔴 ทุกฟังก์ชันต้องผ่านด่านสิทธิ์รายเพจก่อนเสมอ
 *    ใช้ requireConversationAccess ตัวเดียวกับที่อินบ็อกซ์ใช้
 *    ห้ามเขียนด่านสิทธิ์ขึ้นมาใหม่เอง — ด่านที่มีสองชุดคือด่านที่จะไม่ตรงกันวันหนึ่ง
 */
import { db } from '@/lib/supabase/admin';
import type { PublicAdmin } from '@/types/db';
import { requireConversationAccess } from '@/server/inbox/service';

export type WorkspaceCustomer = {
  id: string;
  name: string | null;
  username: string | null;
  profile_pic_url: string | null;
  psid: string;
  platform: string;
  recipient_name: string | null;
  phone: string | null;
  address: string | null;
  postcode: string | null;
  total_orders: number;
  total_spent: number;
  first_contact_at: string | null;
  contact_updated_at: string | null;
  /** ข้อมูลชุดนี้ดึงมาจากข้อความไหน (ข้อ 1.5) */
  contact_source_message_id: string | null;
};

export type WorkspaceOrder = {
  id: string;
  order_no: string;
  status: string;
  total: number;
  payment_status: string;
  shipping_carrier: string | null;
  tracking_no: string | null;
  tracking_notify_status: string | null;
  created_at: string;
};

export type WorkspaceNote = {
  id: string;
  body: string;
  admin_id: string | null;
  admin_name: string | null;
  created_at: string;
  updated_at: string;
};

export type Workspace = {
  customer: WorkspaceCustomer;
  page: { id: string; name: string; platform: string };
  orders: WorkspaceOrder[];
  notes: WorkspaceNote[];
};

/** จำนวนออเดอร์ย้อนหลังที่แสดงในห้อง — มากกว่านี้ให้ไปดูหน้าออเดอร์ */
const ORDER_LIMIT = 10;
const NOTE_LIMIT = 20;

export async function loadWorkspace(
  admin: PublicAdmin,
  conversationId: string,
): Promise<Workspace> {
  // 🔴 ด่านสิทธิ์รายเพจ — ต้องมาก่อนอ่านอะไรทั้งสิ้น
  const conv = await requireConversationAccess(admin, conversationId);

  const [custRes, pageRes, orderRes, noteRes] = await Promise.all([
    db()
      .from('customers')
      .select(
        'id,name,username,profile_pic_url,psid,platform,recipient_name,phone,address,postcode,' +
          'total_orders,total_spent,first_contact_at,contact_updated_at,contact_source_message_id',
      )
      .eq('id', conv.customer_id)
      .maybeSingle(),
    db().from('pages').select('id,page_name,display_name,platform').eq('id', conv.page_id).maybeSingle(),
    /**
     * ⭐ ออเดอร์ของ "ลูกค้าคนนี้" ไม่ใช่ "ห้องแชทนี้"
     *    ลูกค้าหนึ่งคนมีห้องเดียวตลอดชีวิตอยู่แล้ว (unique บน customer_id)
     *    แต่ผูกกับ customer_id ตรง ๆ ชัดเจนกว่า และถูกต้องแม้วันหนึ่งกฎนั้นเปลี่ยน
     */
    db()
      .from('orders')
      .select(
        'id,order_no,status,total,payment_status,shipping_carrier,tracking_no,' +
          'tracking_notify_status,created_at',
      )
      .eq('customer_id', conv.customer_id)
      .order('created_at', { ascending: false })
      .limit(ORDER_LIMIT)
      .overrideTypes<WorkspaceOrder[], { merge: false }>(),
    db()
      .from('customer_notes')
      .select('id,body,admin_id,created_at,updated_at')
      .eq('customer_id', conv.customer_id)
      .order('created_at', { ascending: false })
      .limit(NOTE_LIMIT),
  ]);

  if (custRes.error) throw new Error(`อ่านข้อมูลลูกค้าไม่สำเร็จ: ${custRes.error.message}`);
  if (orderRes.error) throw new Error(`อ่านออเดอร์ของลูกค้าไม่สำเร็จ: ${orderRes.error.message}`);
  if (noteRes.error) throw new Error(`อ่านบันทึกภายในไม่สำเร็จ: ${noteRes.error.message}`);

  const customer = custRes.data as WorkspaceCustomer | null;
  if (!customer) throw new Error('ไม่พบข้อมูลลูกค้า');

  const pageRow = pageRes.data as {
    id: string; page_name: string; display_name: string | null; platform: string;
  } | null;

  const noteRows = (noteRes.data ?? []) as Array<{
    id: string; body: string; admin_id: string | null; created_at: string; updated_at: string;
  }>;

  // ชื่อคนเขียนบันทึก — ดึงทีเดียวทั้งชุด ไม่ใช่วนถามทีละแถว
  const adminIds = [...new Set(noteRows.map((n) => n.admin_id).filter((v): v is string => Boolean(v)))];
  const nameMap = new Map<string, string>();
  if (adminIds.length > 0) {
    const { data } = await db().from('admins').select('id,name').in('id', adminIds);
    for (const a of (data ?? []) as Array<{ id: string; name: string }>) nameMap.set(a.id, a.name);
  }

  return {
    customer: {
      ...customer,
      total_spent: Number(customer.total_spent ?? 0),
    },
    page: {
      id: pageRow?.id ?? conv.page_id,
      name: pageRow?.display_name || pageRow?.page_name || '(ไม่ทราบเพจ)',
      platform: pageRow?.platform ?? '',
    },
    orders: (orderRes.data ?? []).map((o) => ({
      ...o,
      total: Number(o.total ?? 0),
    })),
    notes: noteRows.map((n) => ({
      id: n.id,
      body: n.body,
      admin_id: n.admin_id,
      admin_name: n.admin_id ? (nameMap.get(n.admin_id) ?? 'แอดมินที่ถูกลบแล้ว') : null,
      created_at: n.created_at,
      updated_at: n.updated_at,
    })),
  };
}

/* ------------------------------------------------------------------------ */
/* บันทึกภายใน                                                                */
/* ------------------------------------------------------------------------ */

/**
 * 🔴 บันทึกภายในห้ามหลุดไปถึงลูกค้าเด็ดขาด
 *    ไฟล์นี้จึงไม่มี import ของสายส่งข้อความเลยแม้แต่ตัวเดียว
 *    และมี architecture test คุมไว้ว่าห้ามมี
 */
export async function addNote(
  admin: PublicAdmin,
  conversationId: string,
  body: string,
): Promise<void> {
  const conv = await requireConversationAccess(admin, conversationId);
  const text = body.trim();
  if (!text) throw new Error('บันทึกว่างเปล่า');

  const { error } = await db().from('customer_notes').insert({
    customer_id: conv.customer_id,
    admin_id: admin.id,
    body: text,
    updated_by: admin.id,
  });
  if (error) throw new Error(`บันทึกไม่สำเร็จ: ${error.message}`);
}

export async function deleteNote(
  admin: PublicAdmin,
  conversationId: string,
  noteId: string,
): Promise<void> {
  const conv = await requireConversationAccess(admin, conversationId);

  /**
   * ⚠️ ต้องผูกกับ customer_id ของห้องนี้ด้วย ไม่ใช่ลบด้วย id เปล่า ๆ
   *    ไม่งั้นแอดมินจะยัด id ของบันทึกลูกค้าคนอื่นมาลบได้
   */
  const { error } = await db()
    .from('customer_notes')
    .delete()
    .eq('id', noteId)
    .eq('customer_id', conv.customer_id);

  if (error) throw new Error(`ลบบันทึกไม่สำเร็จ: ${error.message}`);
}
