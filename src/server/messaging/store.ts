import 'server-only';
/**
 * ชั้นติดต่อฐานข้อมูลของระบบส่งข้อความ
 * ===========================================================================
 * แยกออกมาจาก sendMessage() เพื่อให้เห็นชัดว่า "อะไรถูกอ่านจากฐานข้อมูลบ้าง"
 *
 * หลักการสำคัญ 2 ข้อของไฟล์นี้ :
 *
 *   1. ⭐ ข้อเท็จจริงต้องมาจากฐานข้อมูล ไม่ใช่จากผู้เรียก
 *      ผู้เรียกบอกมาแค่ "ห้องแชทไหน" ที่เหลือ (ลูกค้าคนไหน / เพจไหน / ช่องทางไหน / psid อะไร)
 *      เราไปอ่านเองทั้งหมด แล้วตรวจว่าทุกอย่างสัมพันธ์กันจริง
 *      กันเคสที่มีคนส่ง "ลูกค้า A + ห้องแชท B + เพจ C" มาแล้วระบบเชื่อหมด
 *
 *   2. ⭐ การจองสิทธิ์ส่งต้องให้ฐานข้อมูลตัดสิน ไม่ใช่โค้ด JavaScript
 *      เพราะบนเครื่องจริงมีหลาย process/worker ล็อกในหน่วยความจำใช้ไม่ได้
 */
import { db } from '@/lib/supabase/admin';
import type { Channel, MessageType, PolicyState, Transport } from '@/server/policy/types';
import type { MetaPage } from '@/server/meta/client';

/* ------------------------------------------------------------------------ */
/* 1) ดึงบริบทจากฐานข้อมูล + ตรวจความสัมพันธ์                                  */
/* ------------------------------------------------------------------------ */

export type ResolvedContext = {
  conversation_id: string;
  customer_id: string;
  page_id: string;
  channel: Channel;
  recipient_psid: string;
  page: MetaPage;
  state: PolicyState;
};

export type ResolveFailure = { error_code: 'not_found' | 'mismatch' | 'inactive'; error_th: string };

/** ผู้เรียกยืนยันได้ว่า "คาดว่าเป็นลูกค้า/เพจนี้" — ถ้าไม่ตรงให้ปฏิเสธทันที */
export type ContextExpectation = {
  expect_customer_id?: string | null;
  expect_page_id?: string | null;
  expect_channel?: Channel | null;
};

export async function resolveSendContext(
  conversationId: string,
  now: Date,
  expect: ContextExpectation = {},
): Promise<ResolvedContext | ResolveFailure> {
  const supabase = db();

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id,customer_id,page_id,last_customer_message_at')
    .eq('id', conversationId)
    .maybeSingle();

  if (!conversation) return { error_code: 'not_found', error_th: 'ไม่พบห้องแชทนี้' };

  const [{ data: customer }, { data: page }, { data: observed }] = await Promise.all([
    supabase
      .from('customers')
      .select('id,psid,page_id,platform,marketing_eligible,marketing_checked_at,last_customer_message_at')
      .eq('id', conversation.customer_id as string)
      .maybeSingle(),
    supabase
      .from('pages')
      .select('id,platform,page_id,access_token,is_active')
      .eq('id', conversation.page_id as string)
      .maybeSingle(),
    supabase
      .from('conversation_policy_state')
      .select('window_closed_observed_at')
      .eq('conversation_id', conversationId)
      .maybeSingle(),
  ]);

  if (!customer) return { error_code: 'not_found', error_th: 'ไม่พบข้อมูลลูกค้าของห้องแชทนี้' };
  if (!page) return { error_code: 'not_found', error_th: 'ไม่พบเพจต้นทางของห้องแชทนี้' };
  if (!page.is_active) return { error_code: 'inactive', error_th: 'เพจนี้ถูกปิดใช้งานอยู่' };

  /* ---- ⭐ ตรวจความสัมพันธ์ ทุกข้อต้องผ่าน ไม่ผ่านข้อเดียวก็ไม่ส่ง ---- */

  // ลูกค้าคนนี้ต้องอยู่ในเพจเดียวกับห้องแชทจริง
  if (customer.page_id !== conversation.page_id) {
    return {
      error_code: 'mismatch',
      error_th: 'ข้อมูลลูกค้ากับเพจของห้องแชทไม่ตรงกัน ระบบจึงไม่ส่งเพื่อความปลอดภัย',
    };
  }

  // แพลตฟอร์มของลูกค้าต้องตรงกับของเพจ
  if (customer.platform !== page.platform) {
    return {
      error_code: 'mismatch',
      error_th: 'แพลตฟอร์มของลูกค้ากับของเพจไม่ตรงกัน ระบบจึงไม่ส่งเพื่อความปลอดภัย',
    };
  }

  // ต้องมีตัวตนปลายทางจริง
  const psid = (customer.psid as string | null)?.trim();
  if (!psid) {
    return { error_code: 'mismatch', error_th: 'ลูกค้ารายนี้ไม่มีรหัสผู้รับของ Meta จึงส่งไม่ได้' };
  }

  // ถ้าผู้เรียกระบุความคาดหวังมา ต้องตรงกับของจริงในฐานข้อมูล
  if (expect.expect_customer_id && expect.expect_customer_id !== customer.id) {
    return { error_code: 'mismatch', error_th: 'ลูกค้าที่ระบุมาไม่ใช่ลูกค้าของห้องแชทนี้' };
  }
  if (expect.expect_page_id && expect.expect_page_id !== page.id) {
    return { error_code: 'mismatch', error_th: 'เพจที่ระบุมาไม่ใช่เพจของห้องแชทนี้' };
  }

  // ช่องทางมาจากแพลตฟอร์มของเพจ ไม่ได้รับจากผู้เรียก
  const channel: Channel = page.platform === 'instagram' ? 'instagram' : 'messenger';
  if (expect.expect_channel && expect.expect_channel !== channel) {
    return { error_code: 'mismatch', error_th: 'ช่องทางที่ระบุมาไม่ตรงกับแพลตฟอร์มของเพจ' };
  }

  const lastCustomerMessageAt =
    (conversation.last_customer_message_at as string | null) ??
    (customer.last_customer_message_at as string | null);

  return {
    conversation_id: conversation.id as string,
    customer_id: customer.id as string,
    page_id: page.id as string,
    channel,
    recipient_psid: psid,
    page: {
      id: page.id as string,
      platform: page.platform as 'facebook' | 'instagram',
      page_id: page.page_id as string,
      access_token: page.access_token as string | null,
    },
    state: {
      last_customer_message_at: lastCustomerMessageAt ? new Date(lastCustomerMessageAt) : null,
      marketing_eligible: Boolean(customer.marketing_eligible),
      marketing_checked_at: customer.marketing_checked_at
        ? new Date(customer.marketing_checked_at as string)
        : null,
      // สิ่งที่ Meta เคยบอกเรา — เก็บคนละที่กับประวัติข้อความจริง
      window_closed_observed_at: observed?.window_closed_observed_at
        ? new Date(observed.window_closed_observed_at as string)
        : null,
      now,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* 2) จองสิทธิ์ส่ง — ฐานข้อมูลเป็นคนตัดสิน                                      */
/* ------------------------------------------------------------------------ */

export type SendStatus =
  | 'claimed'
  | 'blocked_by_policy'
  | 'succeeded'
  | 'permanent_failed'
  | 'retryable_failed'
  | 'outcome_unknown';

export type ClaimResult = {
  send_id: string;
  /** true = คำขอนี้ได้สิทธิ์ยิง Meta */
  won: boolean;
  status: SendStatus;
  selected_transport: Transport | null;
  meta_message_id: string | null;
  policy_reason_code: string | null;
  policy_reason_th: string | null;
  network_attempts: number;
};

export async function claimSend(params: {
  idempotency_key: string;
  customer_id: string;
  conversation_id: string;
  page_id: string;
  channel: Channel;
  message_type: MessageType;
  triggered_by: string;
  provenance_kind: string;
  human_authored: boolean;
  admin_id: string | null;
  claim_ttl_seconds: number;
}): Promise<ClaimResult> {
  const { data, error } = await db().rpc('claim_message_send', {
    p_idempotency_key: params.idempotency_key,
    p_customer_id: params.customer_id,
    p_conversation_id: params.conversation_id,
    p_page_id: params.page_id,
    p_channel: params.channel,
    p_message_type: params.message_type,
    p_triggered_by: params.triggered_by,
    p_provenance_kind: params.provenance_kind,
    p_human_authored: params.human_authored,
    p_admin_id: params.admin_id,
    p_claim_ttl_seconds: params.claim_ttl_seconds,
  });

  if (error) throw new Error(`จองสิทธิ์ส่งไม่สำเร็จ: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new Error('จองสิทธิ์ส่งไม่สำเร็จ: ฐานข้อมูลไม่คืนผลลัพธ์');

  return {
    send_id: row.send_id as string,
    won: row.won === true,
    status: row.status as SendStatus,
    selected_transport: (row.selected_transport as Transport | null) ?? null,
    meta_message_id: (row.meta_message_id as string | null) ?? null,
    policy_reason_code: (row.policy_reason_code as string | null) ?? null,
    policy_reason_th: (row.policy_reason_th as string | null) ?? null,
    network_attempts: Number(row.network_attempts ?? 0),
  };
}

/** ปิดผลของการส่งหนึ่งครั้ง */
export async function finishSend(params: {
  send_id: string;
  status: SendStatus;
  selected_transport: Transport | null;
  policy_reason_code: string;
  policy_reason_th: string;
  policy_decision: unknown;
  meta_message_id: string | null;
  fbtrace_id: string | null;
  network_attempts: number;
}): Promise<void> {
  const { error } = await db().rpc('finish_message_send', {
    p_send_id: params.send_id,
    p_status: params.status,
    p_selected_transport: params.selected_transport,
    p_policy_reason_code: params.policy_reason_code,
    p_policy_reason_th: params.policy_reason_th,
    p_policy_decision: params.policy_decision,
    p_meta_message_id: params.meta_message_id,
    p_fbtrace_id: params.fbtrace_id,
    p_network_attempts: params.network_attempts,
  });
  if (error) console.error('[messaging] ปิดผลการส่งไม่สำเร็จ:', error.message);
}

/* ------------------------------------------------------------------------ */
/* 3) บันทึกทุกครั้งที่ยิงออกไป — หนึ่งแถวต่อหนึ่งครั้ง ห้ามเขียนทับ              */
/* ------------------------------------------------------------------------ */

export type AttemptRecord = {
  message_send_id: string;
  attempt_no: number;
  customer_id: string | null;
  conversation_id: string | null;
  channel: Channel;
  message_type: MessageType;
  selected_transport: Transport | null;
  policy_reason_code: string;
  policy_reason_th: string;
  policy_decision: unknown;
  meta_response_code: number | null;
  meta_error_subcode: number | null;
  meta_error_message: string | null;
  meta_message_id: string | null;
  fbtrace_id: string | null;
  success: boolean;
  estimated_cost: number | null;
  triggered_by: string;
  human_typed: boolean;
  admin_id: string | null;
  idempotency_key: string | null;
};

export async function recordAttempt(record: AttemptRecord): Promise<string | null> {
  try {
    const { data, error } = await db()
      .from('send_attempts')
      .insert({
        ...record,
        sent_at: record.success ? new Date().toISOString() : null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[messaging] บันทึก send_attempts ไม่สำเร็จ:', error.message);
      return null;
    }
    return data.id as string;
  } catch (e) {
    // บันทึกไม่ได้ต้องไม่ทำให้การส่งพัง แต่ต้องเห็นใน log
    console.error('[messaging] บันทึก send_attempts ไม่สำเร็จ:', e);
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* 4) บันทึกสิ่งที่ Meta บอก — ⚠️ ห้ามแตะประวัติข้อความจริง                      */
/* ------------------------------------------------------------------------ */

/**
 * 🔴 กฎเหล็กของฟังก์ชันนี้ :
 *    ห้ามเขียนลงตาราง conversations หรือ customers เด็ดขาด
 *
 *    `last_customer_message_at` คือ "ข้อเท็จจริง" ว่าลูกค้าทักมาเมื่อไหร่
 *    คำตอบของ Meta คือ "สิ่งที่เราสังเกตเห็น" ณ เวลาหนึ่ง
 *    เอาอย่างหลังไปลบอย่างแรก = ทำลายหลักฐาน และทำให้ Dashboard/รายงานผิดตามไปด้วย
 *
 *    ทั้งสองอย่างจึงอยู่คนละตาราง และ Policy Engine อ่านทั้งคู่มาประกอบการตัดสิน
 */
export async function recordPolicyObservation(params: {
  conversation_id: string;
  window_closed: boolean;
  error_code: number | null;
  error_subcode: number | null;
  reason_code: string;
  reason_th: string;
  fbtrace_id: string | null;
}): Promise<void> {
  try {
    const { error } = await db().rpc('record_policy_observation', {
      p_conversation_id: params.conversation_id,
      p_window_closed: params.window_closed,
      p_error_code: params.error_code,
      p_error_subcode: params.error_subcode,
      p_reason_code: params.reason_code,
      p_reason_th: params.reason_th,
      p_fbtrace_id: params.fbtrace_id,
    });
    if (error) console.error('[messaging] บันทึกข้อสังเกตจาก Meta ไม่สำเร็จ:', error.message);
  } catch (e) {
    console.error('[messaging] บันทึกข้อสังเกตจาก Meta ไม่สำเร็จ:', e);
  }
}

/** ส่งสำเร็จจริง — ล้างสถานะ "เคยถูกปฏิเสธ" ของห้องแชทนี้ทิ้ง */
export async function recordSendVerified(conversationId: string): Promise<void> {
  try {
    const { error } = await db().rpc('record_send_verified', { p_conversation_id: conversationId });
    if (error) console.error('[messaging] บันทึกผลส่งสำเร็จไม่ได้:', error.message);
  } catch (e) {
    console.error('[messaging] บันทึกผลส่งสำเร็จไม่ได้:', e);
  }
}
