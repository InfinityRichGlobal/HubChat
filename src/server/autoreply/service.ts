import 'server-only';
/**
 * ชั้นข้อมูลของกฎตอบอัตโนมัติ (สเปกหัวข้อ 5.5)
 * ===========================================================================
 * ⚠️ ไฟล์นี้ไม่ส่งข้อความเอง — หน้าที่ส่งอยู่ที่ runner.ts ซึ่งเรียก sendMessage()
 *    แยกกันเพื่อให้ "อ่านกฎ" กับ "ยิงข้อความ" ไม่ปนกัน และทดสอบแยกได้
 */
import { db } from '@/lib/supabase/admin';
import type { MatchType, PublicAdmin } from '@/types/db';
import type { MatchableRule } from './matcher';

export class RuleError extends Error {}

const RULE_COLUMNS =
  'id,name,page_ids,match_type,keywords,reply_text,priority,is_active,archived_at,' +
  'hit_count,version,created_by,updated_by,created_at,updated_at';

export type KeywordRule = MatchableRule & {
  name: string | null;
  hit_count: number;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
};

function normaliseRow(row: KeywordRule): KeywordRule {
  return {
    ...row,
    page_ids: Array.isArray(row.page_ids) ? row.page_ids : [],
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
  };
}

/**
 * กฎทั้งหมดสำหรับหน้าตั้งค่า (รวมกฎที่ปิดอยู่ด้วย เพื่อให้แอดมินเห็นและเปิดกลับได้)
 * ⚠️ ไม่รวมกฎที่เก็บเข้ากรุแล้ว เว้นแต่ขอมาโดยเฉพาะ
 */
export async function listRules(includeArchived = false): Promise<KeywordRule[]> {
  let q = db().from('keyword_rules').select(RULE_COLUMNS).order('priority').limit(300);
  if (!includeArchived) q = q.is('archived_at', null);
  const { data, error } = await q.overrideTypes<KeywordRule[], { merge: false }>();
  if (error) throw new Error(`อ่านรายการกฎไม่สำเร็จ: ${error.message}`);
  return (data ?? []).map(normaliseRow);
}

/**
 * ⭐ กฎที่ "ใช้งานได้จริงตอนนี้" — ตัวที่ตัวประมวลผลข้อความขาเข้าใช้
 *
 * ⚠️ กรองสถานะที่ฐานข้อมูลด้วย ไม่ใช่ปล่อยให้ตัวจับคีย์เวิร์ดกรองอย่างเดียว
 *    (ตัวจับกรองซ้ำอีกชั้นอยู่แล้ว — สองชั้นดีกว่า เพราะถ้าชั้นใดชั้นหนึ่งพัง
 *     ผลลัพธ์ที่ผิดคือ "ไม่ตอบ" ซึ่งปลอดภัยกว่า "ตอบมั่ว")
 */
export async function listLiveRules(): Promise<KeywordRule[]> {
  const { data, error } = await db()
    .from('keyword_rules')
    .select(RULE_COLUMNS)
    .eq('is_active', true)
    .is('archived_at', null)
    .order('priority')
    .limit(300)
    .overrideTypes<KeywordRule[], { merge: false }>();
  if (error) throw new Error(`อ่านกฎที่เปิดใช้งานไม่สำเร็จ: ${error.message}`);
  return (data ?? []).map(normaliseRow);
}

export async function getRule(id: string): Promise<KeywordRule | null> {
  const { data } = await db().from('keyword_rules').select(RULE_COLUMNS).eq('id', id).maybeSingle()
    .overrideTypes<KeywordRule | null, { merge: false }>();
  return data ? normaliseRow(data) : null;
}

export type RuleInput = {
  name?: string | null;
  page_ids?: string[];
  match_type?: MatchType;
  keywords?: string[];
  reply_text?: string | null;
  priority?: number;
  is_active?: boolean;
};

/**
 * ตรวจความถูกต้องฝั่งเซิร์ฟเวอร์
 * 🔴 ห้ามพึ่งการตรวจฝั่งหน้าเว็บอย่างเดียว — ใครก็ยิง API ตรงได้
 */
export function validateRule(input: RuleInput): string | null {
  const keywords = (input.keywords ?? []).map((k) => k.trim()).filter((k) => k.length > 0);
  if (keywords.length === 0) return 'ต้องมีคีย์เวิร์ดอย่างน้อย 1 คำ';
  if (keywords.length > 50) return 'คีย์เวิร์ดมากเกินไป (สูงสุด 50 คำ)';
  if (keywords.some((k) => k.length > 100)) return 'คีย์เวิร์ดยาวเกินไป (สูงสุด 100 ตัวอักษร)';

  const reply = (input.reply_text ?? '').trim();
  if (reply.length === 0) return 'ต้องมีข้อความตอบกลับ';
  // Messenger รับได้ 2000 ตัวอักษรต่อข้อความ — กันไว้ก่อนถึงจะไม่โดน Meta ปฏิเสธ
  if (reply.length > 1800) return 'ข้อความตอบกลับยาวเกินไป (สูงสุด 1800 ตัวอักษร)';

  if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 9999)) {
    return 'ลำดับความสำคัญต้องเป็นจำนวนเต็ม 0-9999';
  }
  return null;
}

export async function saveRule(admin: PublicAdmin, id: string | null, input: RuleInput): Promise<KeywordRule> {
  const problem = validateRule(input);
  if (problem) throw new RuleError(problem);

  const { data, error } = await db().rpc('save_keyword_rule', {
    p_id: id,
    p_admin_id: admin.id,
    p_name: input.name?.trim() || null,
    p_page_ids: input.page_ids ?? [],
    p_match_type: input.match_type ?? 'contains',
    p_keywords: (input.keywords ?? []).map((k) => k.trim()).filter((k) => k.length > 0),
    p_reply_text: (input.reply_text ?? '').trim(),
    p_priority: input.priority ?? 100,
    p_is_active: input.is_active ?? true,
  });
  if (error) throw new Error(`บันทึกกฎไม่สำเร็จ: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as KeywordRule;
  return normaliseRow(row);
}

/** เปิด/ปิดกฎอย่างเดียว — ใช้กับสวิตช์ในลิสต์ */
export async function setRuleActive(admin: PublicAdmin, id: string, active: boolean): Promise<KeywordRule> {
  const current = await getRule(id);
  if (!current) throw new RuleError('ไม่พบกฎนี้');
  return saveRule(admin, id, {
    name: current.name,
    page_ids: current.page_ids,
    match_type: current.match_type,
    keywords: current.keywords,
    reply_text: current.reply_text,
    priority: current.priority,
    is_active: active,
  });
}

/**
 * เก็บกฎเข้ากรุ — ⭐ ไม่ลบทิ้ง
 *
 * 🔴 ทำไมห้ามลบ :
 *    ตาราง auto_reply_executions อ้างถึงกฎนี้อยู่ ถ้าลบ ประวัติจะขาด
 *    วันที่ลูกค้าถามว่า "ทำไมระบบตอบแบบนี้" เราต้องตอบได้เสมอ
 *    (foreign key ตั้งเป็น on delete set null ไว้ก็จริง แต่นั่นคือตาข่ายกันพัง
 *     ไม่ใช่เหตุผลให้ลบ — ลบแล้วยังไงก็สืบไม่ได้ว่ากฎนั้นเคยเขียนว่าอะไร)
 */
export async function archiveRule(admin: PublicAdmin, id: string): Promise<void> {
  const { error } = await db()
    .from('keyword_rules')
    .update({ archived_at: new Date().toISOString(), is_active: false, updated_by: admin.id, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`เก็บกฎเข้ากรุไม่สำเร็จ: ${error.message}`);
}

/* ------------------------------------------------------------------------ */
/* ประวัติการตอบอัตโนมัติ (สำหรับหน้าตรวจสอบ)                                   */
/* ------------------------------------------------------------------------ */

export type AutoReplyLog = {
  id: string;
  message_id: string;
  conversation_id: string;
  rule_id: string | null;
  rule_version: number | null;
  matched_keyword: string | null;
  status: string;
  policy_reason_code: string | null;
  policy_reason_th: string | null;
  selected_transport: string | null;
  meta_message_id: string | null;
  error_text: string | null;
  created_at: string;
  finished_at: string | null;
};

export async function listAutoReplyLogs(limit = 100, ruleId?: string): Promise<AutoReplyLog[]> {
  let q = db()
    .from('auto_reply_executions')
    .select(
      'id,message_id,conversation_id,rule_id,rule_version,matched_keyword,status,' +
        'policy_reason_code,policy_reason_th,selected_transport,meta_message_id,error_text,created_at,finished_at',
    )
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 300));
  if (ruleId) q = q.eq('rule_id', ruleId);

  const { data, error } = await q.overrideTypes<AutoReplyLog[], { merge: false }>();
  if (error) throw new Error(`อ่านประวัติการตอบอัตโนมัติไม่สำเร็จ: ${error.message}`);
  return data ?? [];
}
