import 'server-only';
/**
 * sendMessage() — ทางออกเดียวของการส่งข้อความในระบบนี้
 * ===========================================================================
 * 🔴 ทุกจุดที่ส่งข้อความหาลูกค้าต้องเรียกฟังก์ชันนี้ ไม่มีข้อยกเว้น
 *    • แอดมินกดส่งในห้องแชท
 *    • บอทคีย์เวิร์ดตอบอัตโนมัติ
 *    • scheduler ส่ง follow-up
 *    • ระบบแจ้งเลขพัสดุ
 *
 * ลำดับการทำงาน (รอบ 2.1) :
 *
 *   1. ตรวจตราประทับของ provenance
 *        ผู้เรียกอ้างว่า "เป็นคนพิมพ์เอง" ลอย ๆ ไม่ได้ ต้องเป็นของที่ออกจากโรงงานจริง
 *
 *   2. ดึงบริบทจากฐานข้อมูลจาก "รหัสห้องแชท" อย่างเดียว
 *        ลูกค้าคนไหน เพจไหน ช่องทางไหน psid อะไร — เราอ่านเอง ไม่เชื่อผู้เรียก
 *        แล้วตรวจว่าทุกอย่างสัมพันธ์กันจริง ไม่ตรงเมื่อไหร่ = ไม่ส่ง
 *
 *   3. ⭐ จองสิทธิ์ส่งกับฐานข้อมูล (atomic claim)
 *        ถ้ามีคำขออื่นถือกุญแจเดียวกันอยู่ เราจะรู้ทันทีและไม่ยิงซ้ำ
 *        เดิมใช้วิธี "SELECT ดูก่อนแล้วค่อยยิง" ซึ่งสองคำขอพร้อมกันผ่านได้ทั้งคู่
 *
 *   4. ถาม Policy Engine — ถ้าส่งไม่ได้ ปิดงานทันที ไม่ยิงออกไปเลย
 *
 *   5. ยิงผ่าน adapter + Meta client กลาง
 *        บันทึกทุกครั้งที่ยิงเป็นคนละแถว (ประวัติ retry ต้องอยู่ครบ)
 *
 *   6. ⭐ retry เฉพาะกรณีที่ "แน่ใจว่า Meta ไม่ได้รับ" เท่านั้น
 *        ถ้าไม่ได้รับคำตอบเลย (timeout / เน็ตขาด) = ไม่รู้ผล → หยุด ให้คนมาตรวจ
 *        ยอมส่งขาด ดีกว่าส่งซ้ำแล้วแก้ไม่ได้
 *
 *   7. ⭐ คำตอบจาก Meta บันทึกเป็น "ข้อสังเกต" คนละตารางกับประวัติข้อความจริง
 *        ห้ามเอา error ของ Meta ไปลบ last_customer_message_at เด็ดขาด
 */
import { randomUUID } from 'node:crypto';
import { decide } from '@/server/policy/engine';
import { policyConfig } from '@/server/policy/config';
import { transportChannelSupport, getAdapter } from '@/server/transports/registry';
import { backoffMs, isOutcomeUnknown, isRetryable } from '@/server/meta/errors';
import { isTrustedProvenance, type Provenance } from './provenance';
import {
  claimSend,
  finishSend,
  recordAttempt,
  recordOutboundMessage,
  recordPolicyObservation,
  recordSendVerified,
  resolveReplyTarget,
  resolveSendContext,
  type ContextExpectation,
  type SendStatus,
} from './store';
import {
  REASON,
  REASON_TH,
  TRANSPORT_BADGE_TH,
  BLOCKED_BADGE_TH,
  type MessageType,
  type PolicyDecision,
  type ReasonCode,
  type SendContent,
  type SendContext,
} from '@/server/policy/types';

/* ------------------------------------------------------------------------ */
/* สิ่งที่ผู้เรียกส่งเข้ามา — น้อยที่สุดเท่าที่จำเป็น                              */
/* ------------------------------------------------------------------------ */

export type SendRequest = {
  /** ⭐ รหัสห้องแชท — ตัวเดียวที่เรารับจากผู้เรียก ที่เหลือดึงจากฐานข้อมูลเอง */
  conversation_id: string;

  /** ประเภทข้อความ มาจากบริบท ห้ามเดาจากเนื้อข้อความ */
  message_type: MessageType;

  /** ที่มาที่เชื่อถือได้ — สร้างได้จาก @/server/messaging/provenance เท่านั้น */
  provenance: Provenance;

  content: SendContent;

  /** กุญแจกันส่งซ้ำ — ไม่ใส่ก็ได้ ระบบจะสร้างให้เอง */
  idempotency_key?: string | null;

  /**
   * (ไม่บังคับ) ความคาดหวังของผู้เรียกว่าเป็นลูกค้า/เพจ/ช่องทางไหน
   * ถ้าใส่มาแล้วไม่ตรงกับของจริงในฐานข้อมูล ระบบจะปฏิเสธทันที
   * ใช้เป็นตาข่ายกันเคสที่โค้ดเรียกผิดห้องแชท
   */
  expect?: ContextExpectation;

  /**
   * ⭐ ตอบกลับข้อความไหน — เป็น **id ของข้อความในระบบเรา** เท่านั้น
   *
   * 🔴 ห้ามรับ mid ของ Meta จากผู้เรียกเด็ดขาด
   *    sendMessage จะแปลงเป็น mid ให้เอง พร้อมตรวจว่าอยู่ห้องเดียวกันจริง
   *    (กฎเดียวกับ psid / transport / tag ที่ผู้เรียกกำหนดเองไม่ได้)
   */
  reply_to_message_id?: string | null;
};

export type SendResult = {
  /** ส่งออกไปถึงลูกค้าจริงหรือไม่ */
  sent: boolean;
  /** ⚠️ true = ยิงออกไปแล้วแต่ไม่รู้ผล ต้องให้คนตรวจก่อนส่งใหม่ */
  outcome_unknown: boolean;
  decision: PolicyDecision;
  reason_code: ReasonCode;
  reason_th: string;
  badge_th: string;
  meta_message_id: string | null;
  fbtrace_id: string | null;
  /** รหัสของ "การส่งหนึ่งครั้ง" ในเชิงตรรกะ — ใช้ตามรอยย้อนหลัง */
  message_send_id: string | null;
  idempotency_key: string;
  estimated_cost: number | null;
  /** จำนวนครั้งที่ยิงออกไปหา Meta จริง */
  attempts: number;
};

export type SendOptions = {
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: Date;
  /** อายุการจองสิทธิ์ (วินาที) — ถ้า process ตายกลางทาง งานจะถูกทำเครื่องหมายว่าไม่ทราบผล */
  claimTtlSeconds?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------------ */
/* ตัวหลัก                                                                    */
/* ------------------------------------------------------------------------ */

export async function sendMessage(req: SendRequest, options: SendOptions = {}): Promise<SendResult> {
  const now = options.now ?? new Date();
  const maxRetries = Math.max(1, options.maxRetries ?? 3);
  const sleep = options.sleep ?? defaultSleep;
  const claimTtl = options.claimTtlSeconds ?? 120;
  const idempotencyKey = req.idempotency_key?.trim() || `auto:${randomUUID()}`;

  // ---- 1) ตรวจตราประทับของแหล่งที่มา ------------------------------------
  //      ถ้าใครเขียน object หน้าตาเหมือน provenance เองแล้วยัดเข้ามา จะตกด่านนี้
  if (!isTrustedProvenance(req.provenance)) {
    const decision = blockedDecision(REASON.UNTRUSTED_PROVENANCE, REASON_TH.UNTRUSTED_PROVENANCE);
    return earlyFailure(decision, idempotencyKey);
  }
  const prov = req.provenance;

  // ---- 2) ดึงบริบทจากฐานข้อมูล + ตรวจความสัมพันธ์ -------------------------
  const resolved = await resolveSendContext(req.conversation_id, now, req.expect ?? {});
  if ('error_code' in resolved) {
    const code =
      resolved.error_code === 'mismatch' ? REASON.CONTEXT_MISMATCH : REASON.CONTEXT_NOT_FOUND;
    const decision = blockedDecision(code, resolved.error_th);
    return earlyFailure(decision, idempotencyKey);
  }

  /**
   * ---- 2.5) ⭐ แปลง "ข้อความที่จะตอบกลับ" เป็น mid ของ Meta -------------
   *
   * 🔴 ทำ **หลัง** resolveSendContext เสมอ เพราะต้องใช้ conversation_id
   *    ที่ยืนยันจากฐานข้อมูลแล้ว ไม่ใช่ค่าที่ผู้เรียกส่งมา
   *
   * ⚠️ ตอบกลับข้อความที่ผิดห้อง = ปฏิเสธทั้งคำขอ ไม่ใช่ "ส่งไปโดยไม่ตอบกลับ"
   *    เพราะแอดมินตั้งใจอ้างอิงข้อความหนึ่ง ถ้าเงียบ ๆ ส่งไปเฉย ๆ
   *    ข้อความจะไปถึงลูกค้าโดยขาดบริบทที่ตั้งใจไว้ ซึ่งอาจทำให้เข้าใจผิด
   */
  const replyTarget = await resolveReplyTarget(resolved.conversation_id, req.reply_to_message_id);
  if (!replyTarget.ok) {
    const decision = blockedDecision(REASON.CONTEXT_MISMATCH, replyTarget.reason_th);
    return earlyFailure(decision, idempotencyKey);
  }

  // ---- 3) ⭐ จองสิทธิ์ส่งกับฐานข้อมูล ------------------------------------
  const claim = await claimSend({
    idempotency_key: idempotencyKey,
    customer_id: resolved.customer_id,
    conversation_id: resolved.conversation_id,
    page_id: resolved.page_id,
    channel: resolved.channel,
    message_type: req.message_type,
    triggered_by: prov.triggered_by,
    provenance_kind: prov.kind,
    human_authored: prov.human_authored,
    admin_id: prov.admin_id,
    claim_ttl_seconds: claimTtl,
  });

  // แพ้การจอง = มีคำขออื่นดูแลอยู่แล้ว ห้ามยิงซ้ำเด็ดขาด
  if (!claim.won) {
    return alreadyHandled(claim, idempotencyKey);
  }

  // ตั้งแต่บรรทัดนี้ไป เราคือเจ้าของงานนี้แต่เพียงผู้เดียว
  const ctx: SendContext = {
    customer_id: resolved.customer_id,
    conversation_id: resolved.conversation_id,
    page_id: resolved.page_id,
    channel: resolved.channel,
    message_type: req.message_type,
    provenance: prov,
    /**
     * ⚠️ mid มาจากฐานข้อมูลเท่านั้น (resolveReplyTarget) ไม่ใช่จากผู้เรียก
     *    ต่อให้ผู้เรียกยัด reply_to_meta_mid มาใน content เอง ก็จะถูกทับตรงนี้
     */
    content: { ...req.content, reply_to_meta_mid: replyTarget.meta_message_id },
    idempotency_key: idempotencyKey,
  };

  /**
   * ⭐ ช่องทางนี้จะส่ง reply_to ไปกับ payload จริงไหม
   *    ต้องคำนวณจากค่าเดียวกับที่ adapter ใช้ ไม่ใช่เดาเอา
   *    เพราะค่านี้จะถูกบันทึกเป็น "ความจริงเชิงประวัติ" ลงฐานข้อมูล
   */
  const replyNative =
    Boolean(replyTarget.meta_message_id) && policyConfig().native_reply[resolved.channel];

  // ---- 4) ถาม Policy Engine ----------------------------------------------
  const decision = decide(ctx, resolved.state, {
    config: policyConfig(),
    channelSupport: transportChannelSupport(),
  });

  if (!decision.allowed || !decision.transport) {
    return await closeWithoutDispatch(ctx, claim.send_id, decision, idempotencyKey);
  }

  const adapter = getAdapter(decision.transport);
  if (!adapter || !adapter.enabled(ctx.channel)) {
    const blocked = blockedDecision(REASON.ADAPTER_NOT_CONFIGURED, REASON_TH.ADAPTER_NOT_CONFIGURED, decision);
    return await closeWithoutDispatch(ctx, claim.send_id, blocked, idempotencyKey);
  }

  // ตาข่ายชั้นสุดท้ายของ adapter เอง (เผื่อมีใครข้าม engine มา)
  const eligibility = adapter.isEligible(ctx);
  if (!eligibility.ok) {
    const blocked = blockedDecision(REASON.MESSAGE_TYPE_NOT_ALLOWED, eligibility.reason_th, decision);
    return await closeWithoutDispatch(ctx, claim.send_id, blocked, idempotencyKey);
  }

  const built = adapter.build(ctx, resolved.recipient_psid);
  if (!built.ok) {
    const blocked = blockedDecision(REASON.EMPTY_CONTENT, built.reason_th, decision);
    return await closeWithoutDispatch(ctx, claim.send_id, blocked, idempotencyKey);
  }

  // ---- 5-6) ยิงจริง -------------------------------------------------------
  let attempts = 0;
  let lastResult: Awaited<ReturnType<typeof adapter.send>> | null = null;

  while (attempts < maxRetries) {
    attempts += 1;
    const result = await adapter.send(resolved.page, built.payload);
    lastResult = result;

    /* ---- สำเร็จ ---- */
    if (result.ok) {
      await recordAttempt({
        message_send_id: claim.send_id,
        attempt_no: attempts,
        customer_id: ctx.customer_id,
        conversation_id: ctx.conversation_id,
        channel: ctx.channel,
        message_type: ctx.message_type,
        selected_transport: decision.transport,
        policy_reason_code: REASON.SENT_OK,
        policy_reason_th: REASON_TH.SENT_OK,
        policy_decision: decision,
        meta_response_code: result.http_status,
        meta_error_subcode: null,
        meta_error_message: null,
        meta_message_id: result.message_id,
        fbtrace_id: null,
        success: true,
        estimated_cost: decision.estimated_cost,
        triggered_by: prov.triggered_by,
        human_typed: prov.human_authored,
        admin_id: prov.admin_id,
        idempotency_key: idempotencyKey,
      });

      await finishSend({
        send_id: claim.send_id,
        status: 'succeeded',
        selected_transport: decision.transport,
        policy_reason_code: REASON.SENT_OK,
        policy_reason_th: REASON_TH.SENT_OK,
        policy_decision: decision,
        meta_message_id: result.message_id,
        fbtrace_id: null,
        network_attempts: attempts,
      });

      // ส่งได้จริง = ล้างสถานะ "เคยถูกปฏิเสธ" ของห้องแชทนี้
      await recordSendVerified(ctx.conversation_id);

      // บันทึกลงประวัติแชทให้แอดมินคนอื่นเห็น (D-4)
      // ⚠️ ล้มเหลวได้โดยไม่กระทบผลการส่ง — ข้อความถึงลูกค้าไปแล้วจริง
      //    และ echo จาก Meta จะเติมให้เองถ้าแถวนี้หายไป (กันซ้ำด้วย meta_message_id)
      await recordOutboundMessage({
        conversation_id: ctx.conversation_id,
        admin_id: prov.admin_id,
        sender_type: prov.human_authored ? 'admin' : 'bot',
        text: ctx.content.text ?? null,
        attachments: (ctx.content.images ?? []).map((img) => ({
          type: 'image',
          url: img.url,
          meta_attachment_id: img.meta_attachment_id,
        })),
        meta_message_id: result.message_id,
        human_agent_tag: decision.transport === 'HUMAN_AGENT',
        reply_to_message_id: req.reply_to_message_id ?? null,
        // 🔴 บันทึกตามความจริง : ใส่ reply_to ลง payload ไปจริงหรือเปล่า
        //    ไม่ใช่ "ตั้งใจจะตอบกลับ" ซึ่งเป็นคนละเรื่องกัน
        reply_native: replyNative,
      });

      return {
        sent: true,
        outcome_unknown: false,
        decision,
        reason_code: REASON.SENT_OK,
        reason_th: REASON_TH.SENT_OK,
        badge_th: TRANSPORT_BADGE_TH[decision.transport],
        meta_message_id: result.message_id,
        fbtrace_id: null,
        message_send_id: claim.send_id,
        idempotency_key: idempotencyKey,
        estimated_cost: decision.estimated_cost,
        attempts,
      };
    }

    /* ---- ล้มเหลว : บันทึกครั้งนี้เป็นแถวของตัวเอง ---- */
    const err = result.error;
    const attemptReason: ReasonCode =
      err.kind === 'transient'
        ? REASON.META_TRANSIENT_ERROR
        : err.kind === 'policy'
          ? REASON.META_POLICY_ERROR
          : err.kind === 'ambiguous'
            ? REASON.META_OUTCOME_UNKNOWN
            : REASON.META_UNKNOWN_ERROR;

    await recordAttempt({
      message_send_id: claim.send_id,
      attempt_no: attempts,
      customer_id: ctx.customer_id,
      conversation_id: ctx.conversation_id,
      channel: ctx.channel,
      message_type: ctx.message_type,
      selected_transport: decision.transport,
      policy_reason_code: attemptReason,
      policy_reason_th: err.message_th,
      policy_decision: decision,
      meta_response_code: err.code ?? result.http_status,
      meta_error_subcode: err.subcode,
      meta_error_message: err.message,
      meta_message_id: null,
      fbtrace_id: err.fbtrace_id,
      success: false,
      estimated_cost: decision.estimated_cost,
      triggered_by: prov.triggered_by,
      human_typed: prov.human_authored,
      admin_id: prov.admin_id,
      idempotency_key: idempotencyKey,
    });

    // ⭐ ไม่รู้ผล → หยุดทันที ห้ามลองใหม่ (ลูกค้าอาจได้ข้อความไปแล้ว)
    if (isOutcomeUnknown(err)) break;
    // ⭐ error เชิงนโยบาย/ถาวร → หยุดทันทีเช่นกัน
    if (!isRetryable(err)) break;
    if (attempts >= maxRetries) break;
    await sleep(backoffMs(attempts));
  }

  /* ---- ปิดงานแบบล้มเหลว ---- */
  const err = lastResult && !lastResult.ok ? lastResult.error : null;
  const unknown = err ? isOutcomeUnknown(err) : false;

  const reasonCode: ReasonCode = !err
    ? REASON.META_UNKNOWN_ERROR
    : unknown
      ? REASON.META_OUTCOME_UNKNOWN
      : err.kind === 'transient'
        ? REASON.META_TRANSIENT_ERROR
        : err.kind === 'policy'
          ? REASON.META_POLICY_ERROR
          : REASON.META_UNKNOWN_ERROR;

  const status: SendStatus = unknown
    ? 'outcome_unknown'
    : err?.kind === 'transient'
      ? 'retryable_failed'
      : 'permanent_failed';

  const failedDecision: PolicyDecision = {
    ...decision,
    allowed: false,
    reason_code: reasonCode,
    reason_th: err?.message_th ?? REASON_TH.META_UNKNOWN_ERROR,
  };

  await finishSend({
    send_id: claim.send_id,
    status,
    selected_transport: decision.transport,
    policy_reason_code: reasonCode,
    policy_reason_th: failedDecision.reason_th,
    policy_decision: failedDecision,
    meta_message_id: null,
    fbtrace_id: err?.fbtrace_id ?? null,
    network_attempts: attempts,
  });

  // ---- 7) ⭐ บันทึกสิ่งที่ Meta บอกเป็น "ข้อสังเกต" ------------------------
  //      ไม่แตะ last_customer_message_at ของ conversations/customers เด็ดขาด
  if (err && (err.kind === 'policy' || err.window_actually_closed)) {
    await recordPolicyObservation({
      conversation_id: ctx.conversation_id,
      window_closed: err.window_actually_closed,
      error_code: err.code,
      error_subcode: err.subcode,
      reason_code: reasonCode,
      reason_th: err.message_th,
      fbtrace_id: err.fbtrace_id,
    });
  }

  return {
    sent: false,
    outcome_unknown: unknown,
    decision: failedDecision,
    reason_code: reasonCode,
    reason_th: failedDecision.reason_th,
    badge_th: BLOCKED_BADGE_TH,
    meta_message_id: null,
    fbtrace_id: err?.fbtrace_id ?? null,
    message_send_id: claim.send_id,
    idempotency_key: idempotencyKey,
    estimated_cost: null,
    attempts,
  };
}

/* ------------------------------------------------------------------------ */
/* ตัวช่วย                                                                    */
/* ------------------------------------------------------------------------ */

/** ปฏิเสธก่อนถึงขั้นจองสิทธิ์ — ยังไม่มี message_send ให้บันทึก */
function earlyFailure(decision: PolicyDecision, idempotencyKey: string): SendResult {
  return {
    sent: false,
    outcome_unknown: false,
    decision,
    reason_code: decision.reason_code,
    reason_th: decision.reason_th,
    badge_th: BLOCKED_BADGE_TH,
    meta_message_id: null,
    fbtrace_id: null,
    message_send_id: null,
    idempotency_key: idempotencyKey,
    estimated_cost: null,
    attempts: 0,
  };
}

/** Policy ปฏิเสธ — ปิดงานโดยไม่ยิงออกไปแม้แต่ครั้งเดียว */
async function closeWithoutDispatch(
  ctx: SendContext,
  sendId: string,
  decision: PolicyDecision,
  idempotencyKey: string,
): Promise<SendResult> {
  await recordAttempt({
    message_send_id: sendId,
    attempt_no: 0, // 0 = ไม่ได้ยิงออกไปเลย
    customer_id: ctx.customer_id,
    conversation_id: ctx.conversation_id,
    channel: ctx.channel,
    message_type: ctx.message_type,
    selected_transport: decision.transport,
    policy_reason_code: decision.reason_code,
    policy_reason_th: decision.reason_th,
    policy_decision: decision,
    meta_response_code: null,
    meta_error_subcode: null,
    meta_error_message: null,
    meta_message_id: null,
    fbtrace_id: null,
    success: false,
    estimated_cost: decision.estimated_cost,
    triggered_by: ctx.provenance.triggered_by,
    human_typed: ctx.provenance.human_authored,
    admin_id: ctx.provenance.admin_id,
    idempotency_key: idempotencyKey,
  });

  await finishSend({
    send_id: sendId,
    status: 'blocked_by_policy',
    selected_transport: decision.transport,
    policy_reason_code: decision.reason_code,
    policy_reason_th: decision.reason_th,
    policy_decision: decision,
    meta_message_id: null,
    fbtrace_id: null,
    network_attempts: 0,
  });

  return {
    sent: false,
    outcome_unknown: false,
    decision,
    reason_code: decision.reason_code,
    reason_th: decision.reason_th,
    badge_th: BLOCKED_BADGE_TH,
    meta_message_id: null,
    fbtrace_id: null,
    message_send_id: sendId,
    idempotency_key: idempotencyKey,
    estimated_cost: null,
    attempts: 0,
  };
}

/** มีคำขออื่นดูแลกุญแจนี้อยู่แล้ว — รายงานสถานะปัจจุบันโดยไม่ยิงซ้ำ */
function alreadyHandled(
  claim: { send_id: string; status: SendStatus; selected_transport: string | null; meta_message_id: string | null; network_attempts: number },
  idempotencyKey: string,
): SendResult {
  const isUnknown = claim.status === 'outcome_unknown';
  const code: ReasonCode = isUnknown
    ? REASON.META_OUTCOME_UNKNOWN
    : claim.status === 'claimed'
      ? REASON.SEND_IN_PROGRESS
      : REASON.DUPLICATE_SKIPPED;

  const decision = blockedDecision(code, REASON_TH[code]);

  return {
    sent: false,
    outcome_unknown: isUnknown,
    decision,
    reason_code: code,
    reason_th: REASON_TH[code],
    badge_th:
      claim.status === 'succeeded' && claim.selected_transport
        ? TRANSPORT_BADGE_TH[claim.selected_transport as keyof typeof TRANSPORT_BADGE_TH]
        : BLOCKED_BADGE_TH,
    meta_message_id: claim.meta_message_id,
    fbtrace_id: null,
    message_send_id: claim.send_id,
    idempotency_key: idempotencyKey,
    estimated_cost: null,
    attempts: 0,
  };
}

function blockedDecision(code: ReasonCode, reasonTh: string, base?: PolicyDecision): PolicyDecision {
  return {
    allowed: false,
    transport: null,
    reason_code: code,
    reason_th: reasonTh,
    expires_at: null,
    estimated_cost: null,
    alternatives_th: base?.alternatives_th ?? [],
    evaluated: base?.evaluated ?? [],
  };
}
