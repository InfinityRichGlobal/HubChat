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
 * ห้ามมีที่ไหนในระบบเรียก adapter หรือ Meta API ตรง ๆ
 * (ชุดทดสอบมีข้อที่ไล่ตรวจทั้งโปรเจกต์ ถ้ามีจะ fail ทันที)
 *
 * ลำดับการทำงาน :
 *   1. กันส่งซ้ำด้วย idempotency_key
 *   2. ดึงข้อเท็จจริงจากฐานข้อมูล (ลูกค้าทักล่าสุดเมื่อไหร่ ฯลฯ)
 *   3. ถาม Policy Engine ว่าส่งได้ไหม และต้องส่งด้วยช่องทางไหน
 *   4. ถ้าส่งไม่ได้ → บันทึก send_attempts แล้วคืนเหตุผลภาษาไทย (ไม่ยิงออกไป)
 *   5. ถ้าส่งได้ → ประกอบ payload ด้วย adapter แล้วยิงผ่าน Meta client กลาง
 *   6. retry เฉพาะ error ชั่วคราวเท่านั้น (กฎเหล็กข้อ 3)
 *   7. บันทึกผลลง send_attempts ทุกครั้ง ทั้งสำเร็จและไม่สำเร็จ
 *   8. ถ้า Meta บอกว่ากรอบเวลาปิดแล้วทั้งที่เราคิดว่าเปิด → แก้ข้อมูลให้ตรงความจริง
 */
import { db } from '@/lib/supabase/admin';
import { decide } from '@/server/policy/engine';
import { policyConfig } from '@/server/policy/config';
import { transportChannelSupport, getAdapter } from '@/server/transports/registry';
import { backoffMs, isRetryable } from '@/server/meta/errors';
import type { MetaPage } from '@/server/meta/client';
import {
  REASON,
  REASON_TH,
  TRANSPORT_BADGE_TH,
  BLOCKED_BADGE_TH,
  type PolicyDecision,
  type PolicyState,
  type ReasonCode,
  type SendContext,
} from '@/server/policy/types';

export type SendResult = {
  /** ส่งออกไปถึงลูกค้าจริงหรือไม่ */
  sent: boolean;
  decision: PolicyDecision;
  reason_code: ReasonCode;
  reason_th: string;
  /** ป้ายที่โชว์ใต้ข้อความในห้องแชท */
  badge_th: string;
  meta_message_id: string | null;
  send_attempt_id: string | null;
  estimated_cost: number | null;
  /** จำนวนครั้งที่ยิงออกไปจริง (รวม retry) */
  attempts: number;
};

export type SendOptions = {
  /** จำนวนครั้งสูงสุดที่ยอมให้ลองใหม่เมื่อเจอ error ชั่วคราว */
  maxRetries?: number;
  /** ใช้ในชุดทดสอบ : ฟังก์ชันหน่วงเวลา */
  sleep?: (ms: number) => Promise<void>;
  /** ใช้ในชุดทดสอบ : ตรึงเวลาปัจจุบัน */
  now?: Date;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------------ */
/* ข้อมูลที่ต้องดึงจากฐานข้อมูลก่อนตัดสินใจ                                     */
/* ------------------------------------------------------------------------ */

type LoadedContext = {
  page: MetaPage & { platform: 'facebook' | 'instagram' };
  recipient_psid: string;
  state: PolicyState;
};

async function loadContext(ctx: SendContext, now: Date): Promise<LoadedContext | { error_th: string }> {
  const supabase = db();

  const [{ data: customer }, { data: page }] = await Promise.all([
    supabase
      .from('customers')
      .select('id,psid,page_id,marketing_eligible,marketing_checked_at,last_customer_message_at')
      .eq('id', ctx.customer_id)
      .maybeSingle(),
    supabase
      .from('pages')
      .select('id,platform,page_id,access_token,is_active')
      .eq('id', ctx.page_id)
      .maybeSingle(),
  ]);

  if (!customer) return { error_th: 'ไม่พบข้อมูลลูกค้ารายนี้' };
  if (!page) return { error_th: 'ไม่พบเพจต้นทาง' };
  if (!page.is_active) return { error_th: 'เพจนี้ถูกปิดใช้งานอยู่' };

  // ใช้เวลาจากห้องแชทเป็นหลัก ถ้าไม่มีค่อยใช้ของลูกค้า
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id,last_customer_message_at')
    .eq('id', ctx.conversation_id)
    .maybeSingle();

  const lastCustomerMessageAt =
    (conversation?.last_customer_message_at as string | null) ??
    (customer.last_customer_message_at as string | null);

  return {
    page: {
      id: page.id as string,
      platform: page.platform as 'facebook' | 'instagram',
      page_id: page.page_id as string,
      access_token: page.access_token as string | null,
    },
    recipient_psid: customer.psid as string,
    state: {
      last_customer_message_at: lastCustomerMessageAt ? new Date(lastCustomerMessageAt) : null,
      marketing_eligible: Boolean(customer.marketing_eligible),
      marketing_checked_at: customer.marketing_checked_at
        ? new Date(customer.marketing_checked_at as string)
        : null,
      now,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* ตัวหลัก                                                                    */
/* ------------------------------------------------------------------------ */

export async function sendMessage(ctx: SendContext, options: SendOptions = {}): Promise<SendResult> {
  const now = options.now ?? new Date();
  const maxRetries = options.maxRetries ?? 3;
  const sleep = options.sleep ?? defaultSleep;

  // ---- 1) กันส่งซ้ำ ------------------------------------------------------
  if (ctx.idempotency_key) {
    const { data: already } = await db()
      .from('send_attempts')
      .select('id,selected_transport')
      .eq('idempotency_key', ctx.idempotency_key)
      .eq('success', true)
      .maybeSingle();

    if (already) {
      return {
        sent: false,
        decision: skippedDecision(),
        reason_code: REASON.DUPLICATE_SKIPPED,
        reason_th: REASON_TH.DUPLICATE_SKIPPED,
        badge_th: TRANSPORT_BADGE_TH[(already.selected_transport as 'STANDARD') ?? 'STANDARD'],
        meta_message_id: null,
        send_attempt_id: already.id as string,
        estimated_cost: null,
        attempts: 0,
      };
    }
  }

  // ---- 2) ดึงข้อเท็จจริง --------------------------------------------------
  const loaded = await loadContext(ctx, now);
  if ('error_th' in loaded) {
    const decision = blockedDecision(REASON.CONTEXT_NOT_FOUND, loaded.error_th);
    const id = await recordAttempt(ctx, decision, null, null, loaded.error_th);
    return failure(decision, id, loaded.error_th, REASON.CONTEXT_NOT_FOUND);
  }

  // ---- 3) ถาม Policy Engine ----------------------------------------------
  const decision = decide(ctx, loaded.state, {
    config: policyConfig(),
    channelSupport: transportChannelSupport(),
  });

  // ---- 4) ส่งไม่ได้ → บันทึกแล้วจบ ห้ามยิงออกไป ----------------------------
  if (!decision.allowed || !decision.transport) {
    const id = await recordAttempt(ctx, decision, null, null, null);
    return failure(decision, id, decision.reason_th, decision.reason_code);
  }

  const adapter = getAdapter(decision.transport);
  if (!adapter || !adapter.enabled(ctx.channel)) {
    const blocked = blockedDecision(
      REASON.ADAPTER_NOT_CONFIGURED,
      REASON_TH.ADAPTER_NOT_CONFIGURED,
      decision,
    );
    const id = await recordAttempt(ctx, blocked, null, null, null);
    return failure(blocked, id, blocked.reason_th, blocked.reason_code);
  }

  // ตาข่ายชั้นสุดท้ายของ adapter เอง
  const eligibility = adapter.isEligible(ctx);
  if (!eligibility.ok) {
    const blocked = blockedDecision(REASON.MESSAGE_TYPE_NOT_ALLOWED, eligibility.reason_th, decision);
    const id = await recordAttempt(ctx, blocked, null, null, null);
    return failure(blocked, id, blocked.reason_th, blocked.reason_code);
  }

  const built = adapter.build(ctx, loaded.recipient_psid);
  if (!built.ok) {
    const blocked = blockedDecision(REASON.EMPTY_CONTENT, built.reason_th, decision);
    const id = await recordAttempt(ctx, blocked, null, null, null);
    return failure(blocked, id, blocked.reason_th, blocked.reason_code);
  }

  // ---- 5-6) ยิงจริง + retry เฉพาะ error ชั่วคราว --------------------------
  let attempts = 0;
  let lastError: Awaited<ReturnType<typeof adapter.send>> | null = null;

  while (attempts < Math.max(1, maxRetries)) {
    attempts += 1;
    const result = await adapter.send(loaded.page, built.payload);

    if (result.ok) {
      const id = await recordAttempt(ctx, decision, result.message_id, result.http_status, null, true);
      return {
        sent: true,
        decision,
        reason_code: REASON.SENT_OK,
        reason_th: REASON_TH.SENT_OK,
        badge_th: TRANSPORT_BADGE_TH[decision.transport],
        meta_message_id: result.message_id,
        send_attempt_id: id,
        estimated_cost: decision.estimated_cost,
        attempts,
      };
    }

    lastError = result;

    // ⭐ กฎเหล็กข้อ 3 : error เชิงนโยบายห้าม retry เด็ดขาด
    if (!isRetryable(result.error)) break;
    if (attempts >= maxRetries) break;
    await sleep(backoffMs(attempts));
  }

  // ---- 7-8) บันทึกผล + แก้ข้อมูลให้ตรงความจริง ----------------------------
  const err = lastError && !lastError.ok ? lastError.error : null;
  const reasonCode: ReasonCode = !err
    ? REASON.META_UNKNOWN_ERROR
    : err.kind === 'transient'
      ? REASON.META_TRANSIENT_ERROR
      : err.kind === 'policy'
        ? REASON.META_POLICY_ERROR
        : REASON.META_UNKNOWN_ERROR;

  const failedDecision: PolicyDecision = {
    ...decision,
    allowed: false,
    reason_code: reasonCode,
    reason_th: err?.message_th ?? REASON_TH.META_UNKNOWN_ERROR,
  };

  const id = await recordAttempt(
    ctx,
    failedDecision,
    null,
    lastError && !lastError.ok ? lastError.http_status : null,
    null,
    false,
    err,
  );

  // feedback loop : Meta บอกว่ากรอบเวลาปิดแล้ว ทั้งที่เราคำนวณว่ายังเปิด
  // → แก้ข้อมูลในฐานข้อมูลให้ตรงความจริงทันที ไม่ปล่อยให้คำนวณผิดซ้ำ ๆ
  if (err?.window_actually_closed) {
    await markWindowClosed(ctx);
  }

  return {
    sent: false,
    decision: failedDecision,
    reason_code: reasonCode,
    reason_th: failedDecision.reason_th,
    badge_th: BLOCKED_BADGE_TH,
    meta_message_id: null,
    send_attempt_id: id,
    estimated_cost: null,
    attempts,
  };
}

/* ------------------------------------------------------------------------ */
/* บันทึกลง send_attempts — ต้องบันทึก "ทุกครั้งที่พยายามส่ง"                   */
/* ------------------------------------------------------------------------ */

async function recordAttempt(
  ctx: SendContext,
  decision: PolicyDecision,
  metaMessageId: string | null,
  httpStatus: number | null,
  overrideReasonTh: string | null,
  success = false,
  err: { code: number | null; subcode: number | null; message: string; fbtrace_id: string | null } | null = null,
): Promise<string | null> {
  try {
    const { data, error } = await db()
      .from('send_attempts')
      .insert({
        customer_id: ctx.customer_id,
        conversation_id: ctx.conversation_id,
        channel: ctx.channel,
        message_type: ctx.message_type,
        selected_transport: decision.transport,
        policy_reason_code: decision.reason_code,
        policy_reason_th: overrideReasonTh ?? decision.reason_th,
        policy_decision: decision as unknown as Record<string, unknown>,
        meta_response_code: err?.code ?? httpStatus,
        meta_error_subcode: err?.subcode ?? null,
        meta_error_message: err?.message ?? null,
        fbtrace_id: err?.fbtrace_id ?? null,
        success,
        estimated_cost: decision.estimated_cost,
        triggered_by: ctx.triggered_by,
        human_typed: ctx.human_typed,
        admin_id: ctx.admin_id ?? null,
        idempotency_key: ctx.idempotency_key ?? null,
        sent_at: success ? new Date().toISOString() : null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[send-message] บันทึก send_attempts ไม่สำเร็จ:', error.message);
      return null;
    }
    void metaMessageId;
    return data.id as string;
  } catch (e) {
    // บันทึกไม่ได้ต้องไม่ทำให้การส่งพัง แต่ต้องเห็นใน log
    console.error('[send-message] บันทึก send_attempts ไม่สำเร็จ:', e);
    return null;
  }
}

/**
 * แก้ข้อมูลให้ตรงความจริงเมื่อ Meta บอกว่ากรอบเวลาปิดแล้ว
 * ล้าง last_customer_message_at ทิ้ง เพื่อไม่ให้ engine คำนวณว่ายังส่งได้อีก
 */
async function markWindowClosed(ctx: SendContext): Promise<void> {
  try {
    await Promise.all([
      db().from('conversations').update({ last_customer_message_at: null }).eq('id', ctx.conversation_id),
      db().from('customers').update({ last_customer_message_at: null }).eq('id', ctx.customer_id),
    ]);
  } catch (e) {
    console.error('[send-message] อัปเดตสถานะกรอบเวลาไม่สำเร็จ:', e);
  }
}

/* ------------------------------------------------------------------------ */
/* ตัวช่วยสร้างผลลัพธ์                                                         */
/* ------------------------------------------------------------------------ */

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

function skippedDecision(): PolicyDecision {
  return blockedDecision(REASON.DUPLICATE_SKIPPED, REASON_TH.DUPLICATE_SKIPPED);
}

function failure(
  decision: PolicyDecision,
  id: string | null,
  reasonTh: string,
  code: ReasonCode,
): SendResult {
  return {
    sent: false,
    decision,
    reason_code: code,
    reason_th: reasonTh,
    badge_th: BLOCKED_BADGE_TH,
    meta_message_id: null,
    send_attempt_id: id,
    estimated_cost: null,
    attempts: 0,
  };
}
