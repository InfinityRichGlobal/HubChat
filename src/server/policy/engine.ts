/**
 * Message Policy Engine — หัวใจของระบบ (สเปกหัวข้อ 6.1)
 * ===========================================================================
 * หน้าที่เดียวของไฟล์นี้ : ตอบคำถามว่า
 *   "ตอนนี้ส่งข้อความแบบนี้ หาลูกค้าคนนี้ ทางช่องทางนี้ ได้ไหม และต้องส่งยังไง"
 *
 * ✅ วิธีที่ถูก
 *     const decision = decide(ctx, state)
 *     → เลือก transport ที่ Meta อนุญาต ณ เวลานั้นให้เอง
 *
 * ❌ วิธีที่ผิด (ห้ามเขียนแบบนี้ที่ไหนในระบบเด็ดขาด)
 *     if (age > 24h) reject
 *     if (age > 24h) useHumanAgentTag()
 *   ทั้งสองแบบคือการฝังกฎ Meta ไว้นอก engine พอ Meta เปลี่ยนกฎต้องรื้อทั้งระบบ
 *
 * decide() เป็น "ฟังก์ชันบริสุทธิ์" ตั้งใจ :
 *   ไม่ต่อฐานข้อมูล ไม่ยิงเน็ต ไม่อ่านนาฬิกาเอง (รับ now เข้ามา)
 *   → ทดสอบทุกเงื่อนไขได้ครบโดยไม่ต้องรอเวลาจริงและไม่ต้องมี Meta App
 */
import {
  HUMAN_PROVENANCE_KIND,
  REASON,
  REASON_TH,
  TRANSPORT_PRIORITY,
  type Channel,
  type EvaluationStep,
  type PolicyDecision,
  type PolicyState,
  type ReasonCode,
  type SendContext,
  type Transport,
} from './types';
import { policyConfig, type PolicyConfig, type TransportCapability } from './config';

/**
 * แต่ละ transport รองรับแพลตฟอร์มไหนบ้าง
 * ⚠️ Messenger กับ Instagram ไม่เหมือนกัน — ตารางนี้บอกว่า "เราเขียน adapter ไว้ให้ตัวไหนบ้าง"
 *    ส่วนจะเปิดใช้จริงหรือไม่ ดูที่ config.ts อีกชั้น
 *    (ชุดทดสอบมีข้อที่ตรวจว่า adapter จริงตรงกับตารางนี้)
 */
export const DEFAULT_CHANNEL_SUPPORT: Record<Transport, Channel[]> = {
  STANDARD: ['messenger', 'instagram'],
  HUMAN_AGENT: ['messenger', 'instagram'],
  UTILITY: ['messenger'],   // ยังไม่ยืนยันว่า Instagram มีช่องทางนี้
  MARKETING: ['messenger'], // ยังไม่ยืนยันว่า Instagram มีช่องทางนี้
};

export type DecideOptions = {
  config?: PolicyConfig;
  channelSupport?: Record<Transport, Channel[]>;
};

/** รหัสเหตุผลตอน "ผ่าน" ของแต่ละ transport */
const OK_REASON: Record<Transport, ReasonCode> = {
  STANDARD: REASON.OK_STANDARD_WINDOW,
  HUMAN_AGENT: REASON.OK_HUMAN_AGENT_WINDOW,
  UTILITY: REASON.OK_UTILITY_TEMPLATE,
  MARKETING: REASON.OK_MARKETING_ELIGIBLE,
};

/* ------------------------------------------------------------------------ */
/* ตัวตัดสินหลัก                                                              */
/* ------------------------------------------------------------------------ */

export function decide(ctx: SendContext, state: PolicyState, options: DecideOptions = {}): PolicyDecision {
  const config = options.config ?? policyConfig();
  const channelSupport = options.channelSupport ?? DEFAULT_CHANNEL_SUPPORT;
  const channelPolicy = config.channels[ctx.channel];
  const evaluated: EvaluationStep[] = [];

  // ด่าน 0 : ไม่มีเนื้อหาก็ไม่ต้องคุยกันต่อ
  if (!hasContent(ctx)) {
    return blocked(REASON.EMPTY_CONTENT, evaluated, []);
  }

  // ไล่ลองทีละช่องทางตามลำดับความสำคัญ ตัวแรกที่ผ่านคือตัวที่ใช้
  for (const transport of TRANSPORT_PRIORITY) {
    const capability = channelPolicy[transport];
    const reason = evaluateTransport({
      transport,
      capability,
      ctx,
      state,
      config,
      channelSupport,
    });

    if (reason === null) {
      evaluated.push({ transport, eligible: true, reason_code: OK_REASON[transport] });
      return {
        allowed: true,
        transport,
        reason_code: OK_REASON[transport],
        reason_th: REASON_TH[OK_REASON[transport]],
        expires_at: windowExpiryIso(capability, state),
        estimated_cost: capability.estimated_cost,
        alternatives_th: [],
        evaluated,
      };
    }

    evaluated.push({ transport, eligible: false, reason_code: reason });
  }

  // ไม่มีช่องทางไหนใช้ได้เลย
  return blocked(REASON.NO_TRANSPORT_AVAILABLE, evaluated, suggestAlternatives(ctx));
}

/* ------------------------------------------------------------------------ */
/* ตรวจทีละช่องทาง — คืน null ถ้าผ่าน / คืนรหัสเหตุผลถ้าไม่ผ่าน                  */
/* ------------------------------------------------------------------------ */

function evaluateTransport(args: {
  transport: Transport;
  capability: TransportCapability;
  ctx: SendContext;
  state: PolicyState;
  config: PolicyConfig;
  channelSupport: Record<Transport, Channel[]>;
}): ReasonCode | null {
  const { transport, capability, ctx, state, config, channelSupport } = args;

  // 1) เรามี adapter สำหรับแพลตฟอร์มนี้ไหม
  if (!channelSupport[transport].includes(ctx.channel)) {
    return REASON.CHANNEL_NOT_SUPPORTED;
  }

  // 2) เปิดใช้ไว้ไหม (เปิด-ปิดจาก config ได้โดยไม่แก้โค้ด)
  if (!capability.enabled) return REASON.TRANSPORT_DISABLED;

  // 3) ยืนยันกับเอกสาร Meta + ได้รับอนุมัติแล้วหรือยัง
  //    ตัวกันพลาดชั้นสอง : เผลอเปิด enabled แต่ยังไม่ได้รับอนุมัติ = ยังส่งไม่ได้
  if (!capability.verified && !config.allow_unverified) {
    return REASON.TRANSPORT_UNVERIFIED;
  }

  // 4) ข้อความประเภทนี้ส่งผ่านช่องทางนี้ได้ไหม
  //    ⭐ นี่คือด่านที่กัน "แปลง marketing ให้เนียนเป็น utility/human_agent"
  //       เพราะ promotion/upsell อยู่ในรายการของ MARKETING เท่านั้น
  if (!capability.allowed_message_types.includes(ctx.message_type)) {
    return REASON.MESSAGE_TYPE_NOT_ALLOWED;
  }

  // 5) ⭐ ด่านสำคัญที่สุด : HUMAN_AGENT ต้องเป็นข้อความที่คนพิมพ์จริงเท่านั้น
  //    ตรวจจาก "แหล่งที่มาที่ยืนยันแล้ว" ไม่ใช่จากคำอ้างของผู้เรียก
  //    ต้องครบทั้งสามอย่าง :
  //      • kind เป็น human_admin_reply (ออกจากโรงงานที่ตรวจ session แอดมินแล้วเท่านั้น)
  //      • human_authored เป็น true
  //      • triggered_by เป็น admin
  //    บอทคีย์เวิร์ด / scheduler / งานเป็นชุด ตกด่านนี้เสมอ ไม่มีทางลัด
  if (capability.requires_human_typed) {
    const p = ctx.provenance;
    const isRealHuman =
      p.kind === HUMAN_PROVENANCE_KIND && p.human_authored === true && p.triggered_by === 'admin';
    if (!isRealHuman) return REASON.REQUIRES_HUMAN_TYPED;
  }

  // 6) กรอบเวลา — นับจากข้อความล่าสุดที่ "ลูกค้า" ส่งมา
  if (capability.window_hours !== null) {
    if (!state.last_customer_message_at) return REASON.NO_CUSTOMER_MESSAGE_YET;

    // ⭐ ถ้า Meta เคยบอกว่าส่งไม่ได้ "หลังจาก" ข้อความล่าสุดของลูกค้า
    //    ให้เชื่อ Meta มากกว่าการคำนวณของเราเอง (fail closed)
    //    แต่ถ้าลูกค้าทักกลับมาทีหลัง ข้อสังเกตเก่าถือว่าใช้ไม่ได้แล้ว
    //    ⚠️ ตรงนี้ "อ่าน" สิ่งที่สังเกตเห็นเท่านั้น ไม่มีการแก้ประวัติข้อความจริง
    if (
      state.window_closed_observed_at &&
      state.window_closed_observed_at.getTime() >= state.last_customer_message_at.getTime()
    ) {
      return REASON.WINDOW_CLOSED_BY_META;
    }

    const ageHours = hoursBetween(state.last_customer_message_at, state.now);
    if (ageHours >= capability.window_hours) return REASON.OUTSIDE_WINDOW;
  }

  // 7) ต้องใช้เทมเพลตที่ได้รับอนุมัติไหม
  if (capability.requires_template && !ctx.content.template_name) {
    return REASON.TEMPLATE_REQUIRED;
  }

  // 8) ต้องเช็คสิทธิ์รับข้อความการตลาดรายบุคคลไหม
  if (capability.requires_marketing_eligibility) {
    if (!state.marketing_eligible) return REASON.MARKETING_NOT_ELIGIBLE;
    if (!state.marketing_checked_at) return REASON.MARKETING_ELIGIBILITY_STALE;
    const age = hoursBetween(state.marketing_checked_at, state.now);
    if (age >= config.marketing_eligibility_max_age_hours) {
      return REASON.MARKETING_ELIGIBILITY_STALE;
    }
  }

  return null; // ผ่านทุกด่าน
}

/* ------------------------------------------------------------------------ */
/* ตัวช่วย                                                                    */
/* ------------------------------------------------------------------------ */

function hasContent(ctx: SendContext): boolean {
  const hasText = typeof ctx.content.text === 'string' && ctx.content.text.trim().length > 0;
  const hasImages = Array.isArray(ctx.content.images) && ctx.content.images.length > 0;
  const hasTemplate = typeof ctx.content.template_name === 'string' && ctx.content.template_name.length > 0;
  return hasText || hasImages || hasTemplate;
}

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

function windowExpiryIso(capability: TransportCapability, state: PolicyState): string | null {
  if (capability.window_hours === null || !state.last_customer_message_at) return null;
  return new Date(
    state.last_customer_message_at.getTime() + capability.window_hours * 3_600_000,
  ).toISOString();
}

function blocked(reason: ReasonCode, evaluated: EvaluationStep[], alternatives: string[]): PolicyDecision {
  return {
    allowed: false,
    transport: null,
    reason_code: reason,
    reason_th: REASON_TH[reason],
    expires_at: null,
    estimated_cost: null,
    alternatives_th: alternatives,
    evaluated,
  };
}

/**
 * ถ้าส่งไม่ได้ ให้บอกแอดมินว่าพอทำอะไรได้บ้าง (สเปก 6.1 "UI ฝั่งแอดมิน")
 * ห้ามบอกทางที่ผิดนโยบาย — เสนอเฉพาะทางที่ทำได้จริงและถูกกฎ
 */
function suggestAlternatives(ctx: SendContext): string[] {
  const common = [
    'ไปตอบลูกค้าใต้คอมเมนต์ของโพสต์ที่เขาทักมา',
    'ยิงโฆษณาแบบ remarketing เพื่อให้ลูกค้าทักกลับมาเอง',
  ];
  if (ctx.message_type === 'promotion' || ctx.message_type === 'upsell') {
    return [
      'ข้อความขายส่งหาลูกค้าที่เงียบไปแล้วไม่ได้ตามกฎของ Meta',
      ...common,
    ];
  }
  return ['รอให้ลูกค้าทักกลับมาก่อน แล้วจึงตอบได้ตามปกติ', ...common];
}

/**
 * สรุปสถานะช่องทางส่งไว้โชว์บนหัวห้องแชท (สเปก 5.1)
 * แอดมินเห็นแค่ "ส่งได้/ส่งไม่ได้ + เหลือเวลาเท่าไหร่" ไม่ต้องรู้จัก Meta policy
 */
export function summariseForAdmin(decision: PolicyDecision, now: Date): {
  can_send: boolean;
  label_th: string;
  /**
   * ⭐ ป้ายสั้นสำหรับหัวห้องแชท
   *
   * 🔴 ทำไมต้องแยกจาก label_th :
   *    ตอนส่งไม่ได้ label_th คือประโยคเต็ม เช่น
   *    "ตอนนี้ยังส่งข้อความหาลูกค้ารายนี้ไม่ได้ตามกฎของ Meta ..."
   *    ซึ่งยาวเกินกว่าจะอยู่ในแถวเดียวกับรูป/ชื่อ/ปุ่ม → ดันเลย์เอาต์หัวห้องพัง
   *
   *    ป้ายบอกแค่ "ส่งได้ไหม" ส่วนเหตุผลเต็มไปอยู่ใต้ช่องพิมพ์
   *    ที่ซึ่งมีที่ให้อ่านจริง ๆ และเป็นจังหวะที่แอดมินต้องการมันพอดี
   *
   * ⚠️ นี่เป็นการเปลี่ยน "วิธีแสดงผล" เท่านั้น
   *    can_send / reason_th / การตัดสินของ Policy Engine ไม่ถูกแตะเลย
   */
  badge_th: string;
  /** เหตุผลเต็ม เอาไว้แสดงในที่ที่มีพื้นที่พอ */
  detail_th: string;
  hours_left: number | null;
  estimated_cost: number | null;
} {
  const hoursLeft = decision.expires_at
    ? Math.max(0, (new Date(decision.expires_at).getTime() - now.getTime()) / 3_600_000)
    : null;

  if (!decision.allowed) {
    return {
      can_send: false,
      label_th: decision.reason_th,
      badge_th: 'ส่งไม่ได้ตามนโยบาย Meta',
      detail_th: decision.reason_th,
      hours_left: null,
      estimated_cost: null,
    };
  }

  const label =
    hoursLeft === null
      ? 'ส่งข้อความได้'
      : hoursLeft >= 1
        ? `ส่งข้อความได้ · เหลือ ${Math.floor(hoursLeft)} ชม.`
        : `ส่งข้อความได้ · เหลือ ${Math.max(1, Math.round(hoursLeft * 60))} นาที`;

  /** ป้ายตอนส่งได้ ต้องสั้นด้วย — เอาเฉพาะเวลาที่เหลือ ซึ่งเป็นสิ่งที่ต้องเห็นตลอด */
  const badge =
    hoursLeft === null
      ? 'ส่งได้'
      : hoursLeft >= 1
        ? `เหลือ ${Math.floor(hoursLeft)} ชม.`
        : `เหลือ ${Math.max(1, Math.round(hoursLeft * 60))} นาที`;

  return {
    can_send: true,
    label_th: label,
    badge_th: badge,
    detail_th: label,
    hours_left: hoursLeft,
    estimated_cost: decision.estimated_cost,
  };
}
