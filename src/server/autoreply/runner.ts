import 'server-only';
/**
 * ตัวสั่งตอบอัตโนมัติ — สเปกหัวข้อ 5.5
 * ===========================================================================
 * 🔴 นี่คือจุดเดียวในระบบที่ "ส่งข้อความหาลูกค้าโดยไม่มีคนกดปุ่ม"
 *
 * กฎเหล็กที่ไฟล์นี้ต้องรักษาตลอดไป :
 *
 *   1. ยิง Meta เองไม่ได้ — ต้องผ่าน sendMessage() เท่านั้น
 *      (Policy Engine จะเป็นคนตัดสินว่าส่งได้ไหม ไม่ใช่ไฟล์นี้)
 *
 *   2. ใช้ตราประทับ keywordBotProvenance() ซึ่ง human_authored = false เสมอ
 *      → Policy Engine จะไม่มีวันเลือก HUMAN_AGENT ให้
 *      → ตรงกับกฎ Meta ที่ว่า HUMAN_AGENT ใช้ได้เฉพาะข้อความที่คนพิมพ์จริง
 *
 *   3. ⭐ ต้องจองสิทธิ์กับฐานข้อมูลก่อนส่งเสมอ
 *      หนึ่งข้อความขาเข้า = ตอบอัตโนมัติได้ครั้งเดียวตลอดกาล
 *      ต่อให้ worker สองตัวทำงานพร้อมกัน หรือ webhook เดิมเข้ามาซ้ำ
 *
 *   4. ⚠️ ผลลัพธ์ "ไม่ทราบผล" ห้ามลองใหม่อัตโนมัติเด็ดขาด
 *      ยิงออกไปแล้วแต่ไม่รู้ผล → ลองใหม่ = เสี่ยงลูกค้าได้ข้อความสองครั้ง
 *      ปล่อยให้คนมาตัดสินใจเอง ดีกว่าเดาแล้วผิด
 */
import { db } from '@/lib/supabase/admin';
import { sendMessage } from '@/server/messaging/send-message';
import { keywordBotProvenance } from '@/server/messaging/provenance';
import { findMatchingRule } from './matcher';
import { listLiveRules } from './service';

/** ผลของการพิจารณาข้อความหนึ่งข้อความ — ใช้ในสรุปและชุดทดสอบ */
export type AutoReplyOutcome =
  | { kind: 'no_rule' }
  | { kind: 'already_claimed'; execution_id: string | null }
  | { kind: 'sent'; execution_id: string; rule_id: string }
  | { kind: 'blocked'; execution_id: string; rule_id: string; reason_code: string; reason_th: string }
  | { kind: 'unknown'; execution_id: string; rule_id: string }
  | { kind: 'failed'; execution_id: string; rule_id: string; reason_th: string };

export type AutoReplyInput = {
  message_id: string;
  conversation_id: string;
  page_id: string;
  /** ข้อความที่ลูกค้าพิมพ์มา — ใช้เทียบคีย์เวิร์ดเท่านั้น */
  text: string | null;
};

type ClaimRow = { execution_id: string | null; won: boolean };

async function claim(
  input: AutoReplyInput,
  rule: { id: string; version: number },
  snapshot: unknown,
  matchedKeyword: string,
): Promise<ClaimRow> {
  const { data, error } = await db().rpc('claim_auto_reply', {
    p_message_id: input.message_id,
    p_conversation_id: input.conversation_id,
    p_page_id: input.page_id,
    p_rule_id: rule.id,
    p_rule_version: rule.version,
    p_rule_snapshot: snapshot,
    p_matched_keyword: matchedKeyword,
  });
  if (error) throw new Error(`จองสิทธิ์ตอบอัตโนมัติไม่สำเร็จ: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as ClaimRow | undefined;
  if (!row) throw new Error('ฐานข้อมูลไม่ได้คืนผลการจองสิทธิ์กลับมา');
  return row;
}

async function finish(
  executionId: string,
  status: 'sent' | 'blocked' | 'failed' | 'unknown',
  fields: {
    reason_code?: string | null;
    reason_th?: string | null;
    transport?: string | null;
    message_send_id?: string | null;
    meta_message_id?: string | null;
    error_text?: string | null;
  },
): Promise<void> {
  const { error } = await db().rpc('finish_auto_reply', {
    p_execution_id: executionId,
    p_status: status,
    p_reason_code: fields.reason_code ?? null,
    p_reason_th: fields.reason_th ?? null,
    p_transport: fields.transport ?? null,
    p_message_send_id: fields.message_send_id ?? null,
    p_meta_message_id: fields.meta_message_id ?? null,
    p_error_text: fields.error_text ?? null,
  });
  // ⚠️ จดผลไม่ได้ = เรื่องใหญ่ ต้องเห็นในล็อก แต่ห้ามโยนต่อจนงานอื่นพัง
  //    เพราะข้อความอาจส่งออกไปแล้ว การโยน error จะทำให้ระบบลองส่งใหม่
  if (error) console.error(`[autoreply] จดผลไม่สำเร็จ (execution=${executionId}): ${error.message}`);
}

/**
 * พิจารณาข้อความขาเข้าหนึ่งข้อความ แล้วตอบถ้าเข้าเงื่อนไข
 *
 * ⚠️ ฟังก์ชันนี้ต้องไม่โยน error ออกไปในกรณีปกติ
 *    เพราะถูกเรียกจากสายรับข้อความขาเข้า — ถ้าตอบอัตโนมัติพัง
 *    ต้องไม่ทำให้ "การบันทึกข้อความของลูกค้า" พังตามไปด้วย
 *    ข้อความของลูกค้าสำคัญกว่าคำตอบอัตโนมัติเสมอ
 */
export async function runAutoReply(input: AutoReplyInput): Promise<AutoReplyOutcome> {
  // ---- 1) หากฎที่ตรง (ฟังก์ชันบริสุทธิ์ ทดสอบแยกแล้ว) --------------------
  const rules = await listLiveRules();
  const match = findMatchingRule(input.text, input.page_id, rules);
  if (!match) return { kind: 'no_rule' };

  const { rule, matched_keyword } = match;

  // ---- 2) ⭐ จองสิทธิ์กับฐานข้อมูล "ก่อน" ส่ง ------------------------------
  //      สำเนากฎถูกเก็บไว้ตรงนี้ เพราะแอดมินแก้กฎได้ระหว่างที่งานกำลังทำ
  //      เราต้องตอบได้เสมอว่า "ตอนนั้นส่งข้อความว่าอะไรไป"
  const snapshot = {
    id: rule.id,
    version: rule.version,
    match_type: rule.match_type,
    keywords: rule.keywords,
    reply_text: rule.reply_text,
    priority: rule.priority,
  };

  const claimed = await claim(input, rule, snapshot, matched_keyword);
  if (!claimed.won) {
    // มีคนจองไปแล้ว — อาจเป็น worker อีกตัว หรือ webhook เดิมที่เข้ามาซ้ำ
    return { kind: 'already_claimed', execution_id: claimed.execution_id };
  }
  const executionId = claimed.execution_id!;

  // ---- 3) ส่งผ่านทางเดินกลางเส้นเดิม ------------------------------------
  //      ไม่มีการเลือก transport เอง ไม่มีการใส่ message tag เอง
  //      Policy Engine เป็นคนตัดสินทั้งหมดจากบริบทในฐานข้อมูล
  try {
    const result = await sendMessage(
      {
        conversation_id: input.conversation_id,
        message_type: 'inquiry_response',
        provenance: keywordBotProvenance(),
        content: { text: rule.reply_text ?? '' },
        // กุญแจกันซ้ำผูกกับ "ข้อความขาเข้า" ไม่ใช่เวลาปัจจุบัน
        // ถ้าเส้นทางนี้ถูกเรียกซ้ำแบบที่การจองสิทธิ์จับไม่ทัน
        // ชั้นกันซ้ำของ sendMessage จะรับไม้ต่อเป็นตาข่ายชั้นสอง
        idempotency_key: `autoreply:${input.message_id}`,
      },
      // ⚠️ ไม่ลองใหม่หลายรอบสำหรับงานอัตโนมัติ
      //    ลูกค้าไม่ได้รอคำตอบนี้อยู่ และการลองซ้ำเพิ่มโอกาสตอบซ้ำ
      { maxRetries: 1 },
    );

    if (result.sent) {
      await finish(executionId, 'sent', {
        reason_code: result.reason_code,
        reason_th: result.reason_th,
        transport: result.decision.transport ?? null,
        message_send_id: result.message_send_id,
        meta_message_id: result.meta_message_id,
      });
      return { kind: 'sent', execution_id: executionId, rule_id: rule.id };
    }

    if (result.outcome_unknown) {
      // 🔴 จุดที่ห้ามพลาด : ยิงไปแล้วไม่รู้ผล
      //    จดไว้ว่า 'unknown' แล้วหยุด — ไม่มีการลองใหม่อัตโนมัติ
      //    แถวนี้ถูกจองไว้แล้ว จึงไม่มีรอบไหนหยิบข้อความนี้ไปตอบซ้ำได้อีก
      await finish(executionId, 'unknown', {
        reason_code: result.reason_code,
        reason_th: result.reason_th,
        transport: result.decision.transport ?? null,
        message_send_id: result.message_send_id,
      });
      console.warn(
        `[autoreply] ⚠️ ไม่ทราบผลการส่ง (execution=${executionId} conv=${input.conversation_id}) — ไม่ลองใหม่โดยตั้งใจ`,
      );
      return { kind: 'unknown', execution_id: executionId, rule_id: rule.id };
    }

    // Policy Engine ไม่อนุญาต = พฤติกรรมปกติ ไม่ใช่ความผิดพลาด
    await finish(executionId, 'blocked', {
      reason_code: result.reason_code,
      reason_th: result.reason_th,
      transport: result.decision.transport ?? null,
    });
    return {
      kind: 'blocked',
      execution_id: executionId,
      rule_id: rule.id,
      reason_code: result.reason_code,
      reason_th: result.reason_th,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish(executionId, 'failed', { error_text: message });
    console.error(`[autoreply] ส่งไม่สำเร็จ (execution=${executionId}): ${message}`);
    return { kind: 'failed', execution_id: executionId, rule_id: rule.id, reason_th: message };
  }
}
