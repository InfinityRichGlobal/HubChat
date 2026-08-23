/**
 * ชุดทดสอบ Message Policy Engine — ครบทุกเงื่อนไข (สเปกสัปดาห์ 1.5)
 * ===========================================================================
 * decide() เป็นฟังก์ชันบริสุทธิ์ จึงทดสอบได้ครบโดย
 *   • ไม่ต้องต่อฐานข้อมูล
 *   • ไม่ต้องมี Meta App
 *   • ไม่ต้องรอเวลาจริง (ฉีด now เข้าไปเอง)
 *
 * รัน : npm test
 */
import { describe, it, expect } from 'vitest';
import { decide, DEFAULT_CHANNEL_SUPPORT, summariseForAdmin } from '../engine';
import { loadPolicyConfig, type PolicyConfig } from '../config';
import { REASON, type MessageType, type PolicyState, type SendContext, type Channel } from '../types';

/* ---------------------------------------------------------------- */
/* ตัวช่วยสร้างข้อมูลทดสอบ                                             */
/* ---------------------------------------------------------------- */

const NOW = new Date('2026-08-23T12:00:00+07:00');

/** ลูกค้าทักมาเมื่อ n ชั่วโมงที่แล้ว */
function hoursAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 3_600_000);
}

function state(overrides: Partial<PolicyState> = {}): PolicyState {
  return {
    last_customer_message_at: hoursAgo(1),
    marketing_eligible: false,
    marketing_checked_at: null,
    now: NOW,
    ...overrides,
  };
}

function ctx(overrides: Partial<SendContext> = {}): SendContext {
  return {
    customer_id: 'cus-1',
    conversation_id: 'conv-1',
    page_id: 'page-1',
    channel: 'messenger',
    message_type: 'inquiry_response',
    triggered_by: 'admin',
    human_typed: true,
    admin_id: 'admin-1',
    content: { text: 'สวัสดีค่ะ' },
    ...overrides,
  };
}

/** env จำลอง — เริ่มจาก "ปิดหมด ยกเว้น STANDARD" ตามค่าเริ่มต้นจริง */
function config(env: Record<string, string | undefined> = {}): PolicyConfig {
  return loadPolicyConfig(env);
}

/** เปิด HUMAN_AGENT บน Messenger (สมมติว่าผ่าน App Review แล้ว) */
const HUMAN_AGENT_ON = {
  POLICY_MESSENGER_HUMAN_AGENT_ENABLED: 'true',
  POLICY_MESSENGER_HUMAN_AGENT_VERIFIED: 'true',
};

const UTILITY_ON = {
  POLICY_MESSENGER_UTILITY_ENABLED: 'true',
  POLICY_MESSENGER_UTILITY_VERIFIED: 'true',
};

const MARKETING_ON = {
  POLICY_MESSENGER_MARKETING_ENABLED: 'true',
  POLICY_MESSENGER_MARKETING_VERIFIED: 'true',
  POLICY_MESSENGER_MARKETING_COST: '2.5',
};

function run(c: SendContext, s: PolicyState, env: Record<string, string | undefined> = {}) {
  return decide(c, s, { config: config(env), channelSupport: DEFAULT_CHANNEL_SUPPORT });
}

/* ================================================================== */
/* 1. ค่าเริ่มต้นต้องปลอดภัย                                            */
/* ================================================================== */
describe('ค่าเริ่มต้นของระบบต้องปลอดภัยไว้ก่อน (default deny)', () => {
  it('เปิดใช้เฉพาะ STANDARD เท่านั้น ช่องทางอื่นปิดหมด', () => {
    const c = config();
    expect(c.channels.messenger.STANDARD.enabled).toBe(true);
    expect(c.channels.messenger.HUMAN_AGENT.enabled).toBe(false);
    expect(c.channels.messenger.UTILITY.enabled).toBe(false);
    expect(c.channels.messenger.MARKETING.enabled).toBe(false);
  });

  it('ช่องทางที่ต้องขออนุมัติ ต้องยังไม่ verified', () => {
    const c = config();
    expect(c.channels.messenger.HUMAN_AGENT.verified).toBe(false);
    expect(c.channels.messenger.UTILITY.verified).toBe(false);
    expect(c.channels.messenger.MARKETING.verified).toBe(false);
  });

  it('Instagram ต้องไม่ถูกสมมติว่าเหมือน Messenger', () => {
    const c = config();
    // Instagram ปิด Utility/Marketing ไว้ และไม่มี adapter รองรับด้วย
    expect(c.channels.instagram.UTILITY.enabled).toBe(false);
    expect(c.channels.instagram.MARKETING.enabled).toBe(false);
    expect(DEFAULT_CHANNEL_SUPPORT.UTILITY).not.toContain('instagram');
    expect(DEFAULT_CHANNEL_SUPPORT.MARKETING).not.toContain('instagram');
  });

  it('ไม่ยอมให้ใช้ช่องทางที่ยังไม่ยืนยัน เว้นแต่จะเปิดสวิตช์เอง', () => {
    expect(config().allow_unverified).toBe(false);
    expect(config({ POLICY_ALLOW_UNVERIFIED_TRANSPORTS: 'true' }).allow_unverified).toBe(true);
  });
});

/* ================================================================== */
/* 2. STANDARD — กรอบเวลาปกติ                                          */
/* ================================================================== */
describe('STANDARD : อยู่ในกรอบเวลาปกติ', () => {
  it('ลูกค้าเพิ่งทักมา 1 ชม. → ส่งได้', () => {
    const d = run(ctx(), state({ last_customer_message_at: hoursAgo(1) }));
    expect(d.allowed).toBe(true);
    expect(d.transport).toBe('STANDARD');
    expect(d.reason_code).toBe(REASON.OK_STANDARD_WINDOW);
    expect(d.estimated_cost).toBeNull();
  });

  it('23 ชม. 59 นาที → ยังส่งได้', () => {
    const d = run(ctx(), state({ last_customer_message_at: hoursAgo(23.98) }));
    expect(d.allowed).toBe(true);
    expect(d.transport).toBe('STANDARD');
  });

  it('ครบ 24 ชม. พอดี → หมดกรอบแล้ว', () => {
    const d = run(ctx(), state({ last_customer_message_at: hoursAgo(24) }));
    expect(d.transport).not.toBe('STANDARD');
    expect(d.evaluated.find((e) => e.transport === 'STANDARD')?.reason_code).toBe(REASON.OUTSIDE_WINDOW);
  });

  it('ลูกค้ายังไม่เคยทักเลย → ส่งหาก่อนไม่ได้', () => {
    const d = run(ctx(), state({ last_customer_message_at: null }));
    expect(d.allowed).toBe(false);
    expect(d.evaluated.find((e) => e.transport === 'STANDARD')?.reason_code).toBe(
      REASON.NO_CUSTOMER_MESSAGE_YET,
    );
  });

  it('บอกวันหมดอายุของช่องทางกลับมาด้วย', () => {
    const last = hoursAgo(2);
    const d = run(ctx(), state({ last_customer_message_at: last }));
    expect(d.expires_at).toBe(new Date(last.getTime() + 24 * 3_600_000).toISOString());
  });

  it('เปลี่ยนกรอบเวลาจาก env ได้โดยไม่ต้องแก้โค้ด', () => {
    const d = run(ctx(), state({ last_customer_message_at: hoursAgo(30) }), {
      POLICY_MESSENGER_STANDARD_WINDOW_HOURS: '48',
    });
    expect(d.allowed).toBe(true);
    expect(d.transport).toBe('STANDARD');
  });

  it('ไม่มีเนื้อหาเลย → ไม่ต้องส่ง', () => {
    const d = run(ctx({ content: {} }), state());
    expect(d.allowed).toBe(false);
    expect(d.reason_code).toBe(REASON.EMPTY_CONTENT);
  });

  it('มีแต่รูปไม่มีข้อความ → ยังส่งได้', () => {
    const d = run(ctx({ content: { images: [{ meta_attachment_id: 'att-1' }] } }), state());
    expect(d.allowed).toBe(true);
  });
});

/* ================================================================== */
/* 3. HUMAN_AGENT — ด่านที่ผิดแล้วเพจโดนระงับ                            */
/* ================================================================== */
describe('HUMAN_AGENT : ใช้ได้เฉพาะข้อความที่คนพิมพ์จริงเพื่อตอบคำถามลูกค้า', () => {
  const outsideStandard = state({ last_customer_message_at: hoursAgo(30) });

  it('ยังไม่ได้รับอนุมัติ → ใช้ไม่ได้ ถึงจะเปิด enabled ไว้', () => {
    const d = run(ctx(), outsideStandard, { POLICY_MESSENGER_HUMAN_AGENT_ENABLED: 'true' });
    expect(d.allowed).toBe(false);
    expect(d.evaluated.find((e) => e.transport === 'HUMAN_AGENT')?.reason_code).toBe(
      REASON.TRANSPORT_UNVERIFIED,
    );
  });

  it('แอดมินพิมพ์เอง + พ้นกรอบปกติ + อนุมัติแล้ว → ส่งได้', () => {
    const d = run(ctx(), outsideStandard, HUMAN_AGENT_ON);
    expect(d.allowed).toBe(true);
    expect(d.transport).toBe('HUMAN_AGENT');
    expect(d.reason_code).toBe(REASON.OK_HUMAN_AGENT_WINDOW);
  });

  it('🔴 บอทคีย์เวิร์ดใช้ HUMAN_AGENT ไม่ได้เด็ดขาด', () => {
    const d = run(
      ctx({ triggered_by: 'bot', human_typed: false }),
      outsideStandard,
      HUMAN_AGENT_ON,
    );
    expect(d.allowed).toBe(false);
    expect(d.transport).toBeNull();
    expect(d.evaluated.find((e) => e.transport === 'HUMAN_AGENT')?.reason_code).toBe(
      REASON.REQUIRES_HUMAN_TYPED,
    );
  });

  it('🔴 scheduler ส่ง follow-up ใช้ HUMAN_AGENT ไม่ได้เด็ดขาด', () => {
    const d = run(
      ctx({ triggered_by: 'scheduler', human_typed: false, message_type: 'inquiry_response' }),
      outsideStandard,
      HUMAN_AGENT_ON,
    );
    expect(d.allowed).toBe(false);
    expect(d.evaluated.find((e) => e.transport === 'HUMAN_AGENT')?.reason_code).toBe(
      REASON.REQUIRES_HUMAN_TYPED,
    );
  });

  it('🔴 แอดมินอ้างว่าพิมพ์เอง แต่ triggered_by เป็นบอท → ยังใช้ไม่ได้', () => {
    const d = run(ctx({ triggered_by: 'bot', human_typed: true }), outsideStandard, HUMAN_AGENT_ON);
    expect(d.allowed).toBe(false);
  });

  it('🔴 ข้อความขายใช้ HUMAN_AGENT ไม่ได้ ถึงแอดมินจะพิมพ์เอง', () => {
    const d = run(ctx({ message_type: 'promotion' }), outsideStandard, HUMAN_AGENT_ON);
    expect(d.allowed).toBe(false);
    expect(d.evaluated.find((e) => e.transport === 'HUMAN_AGENT')?.reason_code).toBe(
      REASON.MESSAGE_TYPE_NOT_ALLOWED,
    );
  });

  it('🔴 แจ้งเลขพัสดุใช้ HUMAN_AGENT ไม่ได้ (ต้องไปทาง UTILITY)', () => {
    const d = run(ctx({ message_type: 'shipping_update' }), outsideStandard, HUMAN_AGENT_ON);
    expect(d.evaluated.find((e) => e.transport === 'HUMAN_AGENT')?.reason_code).toBe(
      REASON.MESSAGE_TYPE_NOT_ALLOWED,
    );
  });

  it('พ้น 7 วันแล้ว → HUMAN_AGENT ก็ใช้ไม่ได้', () => {
    const d = run(ctx(), state({ last_customer_message_at: hoursAgo(169) }), HUMAN_AGENT_ON);
    expect(d.allowed).toBe(false);
    expect(d.evaluated.find((e) => e.transport === 'HUMAN_AGENT')?.reason_code).toBe(REASON.OUTSIDE_WINDOW);
  });

  it('อยู่ในกรอบปกติอยู่แล้ว → ต้องเลือก STANDARD ก่อนเสมอ ไม่แตะ HUMAN_AGENT', () => {
    const d = run(ctx(), state({ last_customer_message_at: hoursAgo(2) }), HUMAN_AGENT_ON);
    expect(d.transport).toBe('STANDARD');
  });
});

/* ================================================================== */
/* 4. UTILITY                                                          */
/* ================================================================== */
describe('UTILITY : ข้อความแจ้งข้อมูลล้วน', () => {
  const outside = state({ last_customer_message_at: hoursAgo(200) });

  it('แจ้งเลขพัสดุ + มีเทมเพลต + อนุมัติแล้ว → ส่งได้', () => {
    const d = run(
      ctx({ message_type: 'shipping_update', triggered_by: 'scheduler', human_typed: false, content: { text: 'x', template_name: 'shipping_update_v1' } }),
      outside,
      UTILITY_ON,
    );
    expect(d.allowed).toBe(true);
    expect(d.transport).toBe('UTILITY');
  });

  it('ไม่มีเทมเพลต → ส่งไม่ได้', () => {
    const d = run(
      ctx({ message_type: 'shipping_update', triggered_by: 'scheduler', human_typed: false }),
      outside,
      UTILITY_ON,
    );
    expect(d.allowed).toBe(false);
    expect(d.evaluated.find((e) => e.transport === 'UTILITY')?.reason_code).toBe(REASON.TEMPLATE_REQUIRED);
  });

  it('🔴 ข้อความขายห้ามเนียนส่งผ่าน UTILITY', () => {
    const d = run(
      ctx({ message_type: 'promotion', content: { text: 'ลดราคา!', template_name: 'shipping_update_v1' } }),
      outside,
      UTILITY_ON,
    );
    expect(d.allowed).toBe(false);
    expect(d.evaluated.find((e) => e.transport === 'UTILITY')?.reason_code).toBe(
      REASON.MESSAGE_TYPE_NOT_ALLOWED,
    );
  });

  it('บน Instagram ใช้ UTILITY ไม่ได้ (ไม่มี adapter รองรับ)', () => {
    const d = run(
      ctx({ channel: 'instagram', message_type: 'shipping_update', content: { text: 'x', template_name: 't' } }),
      outside,
      { ...UTILITY_ON, POLICY_INSTAGRAM_UTILITY_ENABLED: 'true', POLICY_INSTAGRAM_UTILITY_VERIFIED: 'true' },
    );
    expect(d.evaluated.find((e) => e.transport === 'UTILITY')?.reason_code).toBe(
      REASON.CHANNEL_NOT_SUPPORTED,
    );
  });
});

/* ================================================================== */
/* 5. MARKETING                                                        */
/* ================================================================== */
describe('MARKETING : ข้อความขาย เสียเงินรายข้อความ', () => {
  const outside = state({ last_customer_message_at: hoursAgo(200) });
  const promo = ctx({
    message_type: 'promotion',
    triggered_by: 'scheduler',
    human_typed: false,
    content: { text: 'โปรใหม่', template_name: 'promo_v1' },
  });

  it('ลูกค้าเข้าเกณฑ์ + เพิ่งตรวจ → ส่งได้ พร้อมบอกค่าใช้จ่าย', () => {
    const d = run(
      promo,
      state({ last_customer_message_at: hoursAgo(200), marketing_eligible: true, marketing_checked_at: hoursAgo(1) }),
      MARKETING_ON,
    );
    expect(d.allowed).toBe(true);
    expect(d.transport).toBe('MARKETING');
    expect(d.estimated_cost).toBe(2.5);
  });

  it('ลูกค้าไม่เข้าเกณฑ์ → ส่งไม่ได้', () => {
    const d = run(promo, state({ ...outside, marketing_eligible: false }), MARKETING_ON);
    expect(d.allowed).toBe(false);
    expect(d.evaluated.find((e) => e.transport === 'MARKETING')?.reason_code).toBe(
      REASON.MARKETING_NOT_ELIGIBLE,
    );
  });

  it('ผลตรวจ eligibility เก่าเกินไป → ต้องตรวจใหม่ก่อน', () => {
    const d = run(
      promo,
      state({ last_customer_message_at: hoursAgo(200), marketing_eligible: true, marketing_checked_at: hoursAgo(48) }),
      MARKETING_ON,
    );
    expect(d.allowed).toBe(false);
    expect(d.evaluated.find((e) => e.transport === 'MARKETING')?.reason_code).toBe(
      REASON.MARKETING_ELIGIBILITY_STALE,
    );
  });

  it('ไม่เคยตรวจ eligibility เลย → ส่งไม่ได้', () => {
    const d = run(
      promo,
      state({ last_customer_message_at: hoursAgo(200), marketing_eligible: true, marketing_checked_at: null }),
      MARKETING_ON,
    );
    expect(d.evaluated.find((e) => e.transport === 'MARKETING')?.reason_code).toBe(
      REASON.MARKETING_ELIGIBILITY_STALE,
    );
  });
});

/* ================================================================== */
/* 6. กฎเหล็กข้อ 2 — ห้ามแปลง marketing ให้เนียนเป็นช่องทางอื่น           */
/* ================================================================== */
describe('🔴 ข้อความขายต้องไม่มีทางเล็ดลอดไปช่องทางอื่นได้', () => {
  const outside = state({ last_customer_message_at: hoursAgo(200) });
  const allTransportsOn = { ...HUMAN_AGENT_ON, ...UTILITY_ON, ...MARKETING_ON };

  for (const type of ['promotion', 'upsell'] as MessageType[]) {
    it(`${type} : เปิดทุกช่องทาง แต่ลูกค้าไม่เข้าเกณฑ์ → ต้องส่งไม่ได้ ไม่ใช่ตกไปช่องอื่น`, () => {
      const d = run(
        ctx({ message_type: type, triggered_by: 'admin', human_typed: true, content: { text: 'ลดราคา', template_name: 'promo_v1' } }),
        outside,
        allTransportsOn,
      );
      expect(d.allowed).toBe(false);
      expect(d.transport).toBeNull();
      // ต้องตกที่ MARKETING เพราะไม่เข้าเกณฑ์ ไม่ใช่ไปโผล่ที่ HUMAN_AGENT/UTILITY
      expect(d.evaluated.find((e) => e.transport === 'HUMAN_AGENT')?.reason_code).toBe(
        REASON.MESSAGE_TYPE_NOT_ALLOWED,
      );
      expect(d.evaluated.find((e) => e.transport === 'UTILITY')?.reason_code).toBe(
        REASON.MESSAGE_TYPE_NOT_ALLOWED,
      );
      expect(d.evaluated.find((e) => e.transport === 'MARKETING')?.reason_code).toBe(
        REASON.MARKETING_NOT_ELIGIBLE,
      );
    });
  }

  it('ในกรอบเวลาปกติ ข้อความขายส่งได้ตามปกติ (ลูกค้าเพิ่งคุยอยู่)', () => {
    const d = run(ctx({ message_type: 'promotion' }), state({ last_customer_message_at: hoursAgo(1) }));
    expect(d.allowed).toBe(true);
    expect(d.transport).toBe('STANDARD');
  });
});

/* ================================================================== */
/* 7. ไม่มีช่องทางไหนใช้ได้เลย                                          */
/* ================================================================== */
describe('เมื่อไม่มีช่องทางที่อนุญาต', () => {
  it('ตอบว่าส่งไม่ได้ พร้อมเหตุผลภาษาไทยและทางเลือกที่ทำได้จริง', () => {
    const d = run(ctx(), state({ last_customer_message_at: hoursAgo(300) }));
    expect(d.allowed).toBe(false);
    expect(d.transport).toBeNull();
    expect(d.reason_code).toBe(REASON.NO_TRANSPORT_AVAILABLE);
    expect(d.reason_th).toContain('Meta');
    expect(d.alternatives_th.length).toBeGreaterThan(0);
  });

  it('บันทึกไว้ครบว่าลองช่องทางไหนไปบ้าง แต่ละตัวตกเพราะอะไร', () => {
    const d = run(ctx(), state({ last_customer_message_at: hoursAgo(300) }));
    expect(d.evaluated.map((e) => e.transport)).toEqual([
      'STANDARD', 'HUMAN_AGENT', 'UTILITY', 'MARKETING',
    ]);
    expect(d.evaluated.every((e) => e.eligible === false)).toBe(true);
  });
});

/* ================================================================== */
/* 8. Instagram ต้องไม่ถูกสมมติว่าเหมือน Messenger                       */
/* ================================================================== */
describe('Messenger กับ Instagram แยกกันคนละชุด', () => {
  it('ตั้งกรอบเวลา Instagram ต่างจาก Messenger ได้', () => {
    const env = {
      POLICY_MESSENGER_STANDARD_WINDOW_HOURS: '24',
      POLICY_INSTAGRAM_STANDARD_WINDOW_HOURS: '12',
    };
    const at18h = state({ last_customer_message_at: hoursAgo(18) });
    expect(run(ctx({ channel: 'messenger' }), at18h, env).allowed).toBe(true);
    expect(run(ctx({ channel: 'instagram' }), at18h, env).allowed).toBe(false);
  });

  it('เปิด HUMAN_AGENT บน Messenger ไม่ทำให้ Instagram เปิดตาม', () => {
    const outside = state({ last_customer_message_at: hoursAgo(30) });
    expect(run(ctx({ channel: 'messenger' }), outside, HUMAN_AGENT_ON).allowed).toBe(true);
    expect(run(ctx({ channel: 'instagram' }), outside, HUMAN_AGENT_ON).allowed).toBe(false);
  });
});

/* ================================================================== */
/* 9. สรุปสถานะให้แอดมินอ่าน                                            */
/* ================================================================== */
describe('สรุปสถานะช่องทางส่งไว้โชว์บนหัวห้องแชท', () => {
  it('ส่งได้ → บอกว่าเหลือกี่ชั่วโมง', () => {
    const d = run(ctx(), state({ last_customer_message_at: hoursAgo(2) }));
    const s = summariseForAdmin(d, NOW);
    expect(s.can_send).toBe(true);
    expect(s.label_th).toContain('เหลือ 22 ชม.');
  });

  it('เหลือน้อยกว่า 1 ชม. → บอกเป็นนาที', () => {
    const d = run(ctx(), state({ last_customer_message_at: hoursAgo(23.5) }));
    const s = summariseForAdmin(d, NOW);
    expect(s.label_th).toContain('นาที');
  });

  it('ส่งไม่ได้ → บอกเหตุผลภาษาไทย ไม่โชว์ชื่อ transport ให้แอดมินเลือก', () => {
    const d = run(ctx(), state({ last_customer_message_at: hoursAgo(300) }));
    const s = summariseForAdmin(d, NOW);
    expect(s.can_send).toBe(false);
    expect(s.label_th).not.toContain('HUMAN_AGENT');
    expect(s.label_th).not.toContain('STANDARD');
  });
});

/* ================================================================== */
/* 10. ค่าตั้งผิดต้องฟ้องทันที                                          */
/* ================================================================== */
describe('ค่าตั้งใน env ผิดต้องฟ้องทันที ไม่เดาให้', () => {
  it('ค่า boolean ที่ไม่ใช่ true/false → โยน error', () => {
    expect(() => config({ POLICY_MESSENGER_HUMAN_AGENT_ENABLED: 'maybe' })).toThrow();
  });

  it('ค่ากรอบเวลาติดลบ → โยน error', () => {
    expect(() => config({ POLICY_MESSENGER_STANDARD_WINDOW_HOURS: '-5' })).toThrow();
  });

  it('คำว่า "false" ต้องแปลเป็น false จริง ๆ ไม่ใช่ true', () => {
    expect(config({ POLICY_MESSENGER_STANDARD_ENABLED: 'false' }).channels.messenger.STANDARD.enabled).toBe(false);
  });
});

/* ================================================================== */
/* 11. ทุกช่องทางต้องถูกลองตามลำดับที่สเปกกำหนด                          */
/* ================================================================== */
describe('ลำดับการเลือกช่องทาง', () => {
  it('เรียงตาม STANDARD → HUMAN_AGENT → UTILITY → MARKETING', () => {
    const d = run(ctx({ content: {} }), state());
    // เนื้อหาว่างจะตัดจบก่อน จึงทดสอบด้วยเคสที่ไล่ครบแทน
    expect(d.evaluated.length).toBe(0);

    const full = run(ctx(), state({ last_customer_message_at: hoursAgo(500) }));
    expect(full.evaluated.map((e) => e.transport)).toEqual([
      'STANDARD', 'HUMAN_AGENT', 'UTILITY', 'MARKETING',
    ]);
  });

  const channels: Channel[] = ['messenger', 'instagram'];
  for (const ch of channels) {
    it(`${ch} : ในกรอบเวลาปกติเลือก STANDARD เสมอ`, () => {
      const d = run(ctx({ channel: ch }), state({ last_customer_message_at: hoursAgo(1) }));
      expect(d.transport).toBe('STANDARD');
    });
  }
});
