/**
 * ชุดทดสอบ sendMessage() — ทางออกเดียวของการส่งข้อความ (รอบ 2.1)
 * ===========================================================================
 * ชุดนี้ทดสอบ "การประสานงาน" ของ sendMessage โดยสวมชั้นฐานข้อมูลปลอมเข้าไป
 * ส่วนการรับประกันที่ต้องพึ่งฐานข้อมูลจริง (จองสิทธิ์พร้อมกัน / unique constraint)
 * อยู่ในชุด tests/pg/ ที่รันกับ PostgreSQL จริง
 *
 * สิ่งที่ตรวจในชุดนี้ :
 *   • แหล่งที่มาปลอม → ถูกปฏิเสธก่อนแตะฐานข้อมูล
 *   • ส่งไม่ได้ตามนโยบาย → ไม่ยิงออกไปเลยแม้แต่ครั้งเดียว
 *   • บันทึกทุกครั้งที่ยิงเป็นคนละแถว ประวัติ retry อยู่ครบ
 *   • ไม่รู้ผล (timeout) → ห้ามลองใหม่ และทำเครื่องหมายไว้ให้คนตรวจ
 *   • คำตอบของ Meta ไม่ไปแตะประวัติข้อความจริง
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'a'.repeat(40);
process.env.SUPABASE_SERVICE_ROLE_KEY = 'b'.repeat(40);
process.env.SESSION_SECRET = 'c'.repeat(40);
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

/* ---------------------------------------------------------------- */
/* ชั้นฐานข้อมูลปลอม                                                  */
/* ---------------------------------------------------------------- */

type Attempt = Record<string, unknown>;

const store = {
  attempts: [] as Attempt[],
  finishes: [] as Record<string, unknown>[],
  observations: [] as Record<string, unknown>[],
  verified: [] as string[],
  /** ผลของการจองสิทธิ์ครั้งถัดไป */
  nextClaim: { won: true, status: 'claimed' as string },
  /** ผลการดึงบริบท */
  resolveResult: null as unknown,
  /** ⭐ ประวัติข้อความจริง — ชุดทดสอบจะยืนยันว่าค่านี้ห้ามเปลี่ยน */
  factualLastCustomerMessageAt: new Date('2026-08-23T11:00:00Z'),
};

vi.mock('../store', () => ({
  resolveSendContext: vi.fn(async () => store.resolveResult),
  claimSend: vi.fn(async () => ({
    send_id: 'send-1',
    won: store.nextClaim.won,
    status: store.nextClaim.status,
    selected_transport: null,
    meta_message_id: null,
    policy_reason_code: null,
    policy_reason_th: null,
    network_attempts: 0,
  })),
  finishSend: vi.fn(async (p: Record<string, unknown>) => {
    store.finishes.push(p);
  }),
  recordAttempt: vi.fn(async (r: Attempt) => {
    store.attempts.push(r);
    return `attempt-${store.attempts.length}`;
  }),
  recordPolicyObservation: vi.fn(async (p: Record<string, unknown>) => {
    store.observations.push(p);
  }),
  recordSendVerified: vi.fn(async (id: string) => {
    store.verified.push(id);
  }),
}));

/* ---------------------------------------------------------------- */
import { sendMessage } from '../send-message';
import { keywordBotProvenance, schedulerProvenance, bulkJobProvenance } from '../provenance';
import { __setFetcherForTests } from '@/server/meta/client';
import { encryptSecret } from '@/lib/crypto';
import { resetPolicyConfigCache } from '@/server/policy/config';
import type { SendContent } from '@/server/policy/types';

const NOW = new Date('2026-08-23T12:00:00Z');

function seedContext(overrides: Record<string, unknown> = {}) {
  store.resolveResult = {
    conversation_id: 'conv-1',
    customer_id: 'cus-1',
    page_id: 'page-1',
    channel: 'messenger',
    recipient_psid: 'psid-1',
    page: {
      id: 'page-1',
      platform: 'facebook',
      page_id: '123456',
      access_token: encryptSecret('EAA-fake-token'),
    },
    state: {
      last_customer_message_at: store.factualLastCustomerMessageAt,
      marketing_eligible: false,
      marketing_checked_at: null,
      window_closed_observed_at: null,
      now: NOW,
    },
    ...overrides,
  };
}

function req(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: 'conv-1',
    message_type: 'inquiry_response' as const,
    provenance: keywordBotProvenance(),
    content: { text: 'สวัสดีค่ะ' } as SendContent,
    ...overrides,
  };
}

/** Meta ปลอม — นับจำนวนครั้งที่ถูกยิงจริง */
function fakeMeta(responses: Array<{ status: number; body: unknown } | { throws: string }>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  let i = 0;
  __setFetcherForTests((async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if ('throws' in r) throw new Error(r.throws);
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch);
  return calls;
}

const noSleep = async () => {};

beforeEach(() => {
  resetPolicyConfigCache();
  __setFetcherForTests(null);
  store.attempts = [];
  store.finishes = [];
  store.observations = [];
  store.verified = [];
  store.nextClaim = { won: true, status: 'claimed' };
  store.factualLastCustomerMessageAt = new Date('2026-08-23T11:00:00Z');
  seedContext();
});

/* ================================================================== */
describe('🔴 แหล่งที่มาที่ปลอมมา ต้องถูกปฏิเสธก่อนทำอะไรทั้งสิ้น', () => {
  it('object ที่หน้าตาเหมือน provenance ของคน แต่ไม่มีตราประทับ → ปฏิเสธ', async () => {
    const calls = fakeMeta([{ status: 200, body: { message_id: 'ไม่ควรถูกเรียก' } }]);
    const forged = {
      kind: 'human_admin_reply',
      triggered_by: 'admin',
      human_authored: true,
      admin_id: 'admin-1',
    };

    const result = await sendMessage(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req({ provenance: forged as any }),
      { now: NOW, sleep: noSleep },
    );

    expect(result.sent).toBe(false);
    expect(result.reason_code).toBe('UNTRUSTED_PROVENANCE');
    expect(calls).toHaveLength(0);
    // ไม่แม้แต่จะจองสิทธิ์ส่ง
    expect(store.attempts).toHaveLength(0);
  });

  it('ของจริงจากโรงงานอัตโนมัติ → ผ่านด่านตราประทับ', async () => {
    fakeMeta([{ status: 200, body: { message_id: 'mid.1' } }]);
    const result = await sendMessage(req({ provenance: schedulerProvenance() }), { now: NOW, sleep: noSleep });
    expect(result.reason_code).not.toBe('UNTRUSTED_PROVENANCE');
  });
});

/* ================================================================== */
describe('ส่งได้ตามปกติ', () => {
  it('ยิงออกไปแล้วเก็บ meta_message_id ไว้ครบ', async () => {
    const calls = fakeMeta([{ status: 200, body: { message_id: 'mid.123' } }]);

    const result = await sendMessage(req(), { now: NOW, sleep: noSleep });

    expect(result.sent).toBe(true);
    expect(result.meta_message_id).toBe('mid.123');
    expect(result.attempts).toBe(1);
    expect(calls).toHaveLength(1);

    // ⭐ เก็บ id ของ Meta ทั้งในแถว attempt และในสรุปของการส่ง
    expect(store.attempts[0].meta_message_id).toBe('mid.123');
    expect(store.finishes[0].meta_message_id).toBe('mid.123');
    expect(store.finishes[0].status).toBe('succeeded');
    expect(store.finishes[0].network_attempts).toBe(1);
    expect(store.verified).toContain('conv-1');
  });

  it('ผูก attempt เข้ากับการส่งหนึ่งครั้งเสมอ', async () => {
    fakeMeta([{ status: 200, body: { message_id: 'mid.1' } }]);
    await sendMessage(req(), { now: NOW, sleep: noSleep });
    expect(store.attempts[0].message_send_id).toBe('send-1');
    expect(store.attempts[0].attempt_no).toBe(1);
  });
});

/* ================================================================== */
describe('🔴 กันส่งซ้ำ : แพ้การจองสิทธิ์ = ห้ามยิง', () => {
  it('มีคำขออื่นกำลังส่งอยู่ → ไม่ยิงซ้ำ', async () => {
    store.nextClaim = { won: false, status: 'claimed' };
    const calls = fakeMeta([{ status: 200, body: { message_id: 'ไม่ควรถูกเรียก' } }]);

    const result = await sendMessage(req({ idempotency_key: 'k1' }), { now: NOW, sleep: noSleep });

    expect(result.sent).toBe(false);
    expect(result.reason_code).toBe('SEND_IN_PROGRESS');
    expect(calls).toHaveLength(0);
  });

  it('เคยส่งสำเร็จไปแล้ว → ข้าม ไม่ยิงซ้ำ', async () => {
    store.nextClaim = { won: false, status: 'succeeded' };
    const calls = fakeMeta([{ status: 200, body: {} }]);

    const result = await sendMessage(req({ idempotency_key: 'k1' }), { now: NOW, sleep: noSleep });

    expect(result.sent).toBe(false);
    expect(result.reason_code).toBe('DUPLICATE_SKIPPED');
    expect(calls).toHaveLength(0);
  });

  it('งานเดิมอยู่ในสถานะไม่ทราบผล → ห้ามส่งซ้ำอัตโนมัติ', async () => {
    store.nextClaim = { won: false, status: 'outcome_unknown' };
    const calls = fakeMeta([{ status: 200, body: {} }]);

    const result = await sendMessage(req({ idempotency_key: 'k1' }), { now: NOW, sleep: noSleep });

    expect(result.sent).toBe(false);
    expect(result.outcome_unknown).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('ไม่ระบุกุญแจมา ระบบสร้างให้เอง (ทุกการส่งมีร่องรอย)', async () => {
    fakeMeta([{ status: 200, body: { message_id: 'mid.1' } }]);
    const result = await sendMessage(req(), { now: NOW, sleep: noSleep });
    expect(result.idempotency_key).toMatch(/^auto:/);
  });
});

/* ================================================================== */
describe('🔴 ไม่รู้ผล : ห้ามลองใหม่เด็ดขาด', () => {
  it('timeout ระหว่างยิง → หยุดทันที ไม่ retry', async () => {
    const calls = fakeMeta([{ throws: 'The operation was aborted due to timeout' }]);

    const result = await sendMessage(req(), { now: NOW, sleep: noSleep, maxRetries: 5 });

    expect(result.sent).toBe(false);
    expect(result.outcome_unknown).toBe(true);
    expect(result.reason_code).toBe('META_OUTCOME_UNKNOWN');
    expect(calls).toHaveLength(1); // ← ยิงครั้งเดียว ไม่ลองซ้ำ
    expect(store.finishes[0].status).toBe('outcome_unknown');
  });

  it('เน็ตขาดกลางทาง → ทำเครื่องหมายให้คนมาตรวจ ไม่ส่งซ้ำ', async () => {
    const calls = fakeMeta([{ throws: 'ECONNRESET' }]);
    const result = await sendMessage(req(), { now: NOW, sleep: noSleep, maxRetries: 3 });
    expect(calls).toHaveLength(1);
    expect(result.outcome_unknown).toBe(true);
    expect(result.reason_th).toContain('ไม่ทราบ');
  });

  it('gateway timeout (504) → ถือว่าไม่รู้ผลเช่นกัน', async () => {
    const calls = fakeMeta([{ status: 504, body: {} }]);
    const result = await sendMessage(req(), { now: NOW, sleep: noSleep, maxRetries: 3 });
    expect(calls).toHaveLength(1);
    expect(result.outcome_unknown).toBe(true);
  });

  it('5xx ที่มีคำตอบของ Meta ชัดเจน → ยัง retry ได้ตามปกติ', async () => {
    const calls = fakeMeta([
      { status: 500, body: { error: { code: 2, message: 'temporary' } } },
      { status: 200, body: { message_id: 'mid.ok' } },
    ]);
    const result = await sendMessage(req(), { now: NOW, sleep: noSleep, maxRetries: 3 });
    expect(result.sent).toBe(true);
    expect(calls).toHaveLength(2);
    expect(result.attempts).toBe(2);
  });
});

/* ================================================================== */
describe('ประวัติการยิงต้องอยู่ครบ ไม่ทับกัน', () => {
  it('ยิง 3 ครั้ง → มี 3 แถว เลขลำดับไม่ซ้ำ', async () => {
    const calls = fakeMeta([{ status: 503, body: { error: { code: 2 } } }]);
    const result = await sendMessage(req(), { now: NOW, sleep: noSleep, maxRetries: 3 });

    expect(calls).toHaveLength(3);
    expect(result.attempts).toBe(3);
    expect(store.attempts).toHaveLength(3);
    expect(store.attempts.map((a) => a.attempt_no)).toEqual([1, 2, 3]);
    expect(store.finishes[0].network_attempts).toBe(3);
    expect(store.finishes[0].status).toBe('retryable_failed');
  });

  it('เก็บ fbtrace_id ของแต่ละครั้งไว้สืบย้อนหลัง', async () => {
    fakeMeta([{ status: 400, body: { error: { code: 10, message: 'nope', fbtrace_id: 'TRACE-9' } } }]);
    const result = await sendMessage(req(), { now: NOW, sleep: noSleep });
    expect(store.attempts[0].fbtrace_id).toBe('TRACE-9');
    expect(result.fbtrace_id).toBe('TRACE-9');
  });

  it('ถูก policy ปฏิเสธ → บันทึกด้วย attempt_no = 0 (ไม่ได้ยิงออกไป)', async () => {
    seedContext({
      state: {
        last_customer_message_at: new Date(NOW.getTime() - 300 * 3_600_000),
        marketing_eligible: false,
        marketing_checked_at: null,
        window_closed_observed_at: null,
        now: NOW,
      },
    });
    const calls = fakeMeta([{ status: 200, body: {} }]);

    const result = await sendMessage(req(), { now: NOW, sleep: noSleep });

    expect(result.sent).toBe(false);
    expect(calls).toHaveLength(0);
    expect(store.attempts[0].attempt_no).toBe(0);
    expect(store.finishes[0].status).toBe('blocked_by_policy');
  });
});

/* ================================================================== */
describe('🔴 คำตอบของ Meta ห้ามแตะประวัติข้อความจริง', () => {
  it('Meta บอกว่ากรอบเวลาปิด → บันทึกเป็นข้อสังเกต ไม่แก้ประวัติ', async () => {
    const before = store.factualLastCustomerMessageAt;
    fakeMeta([
      { status: 400, body: { error: { code: 10, error_subcode: 2018278, message: 'outside window' } } },
    ]);

    await sendMessage(req(), { now: NOW, sleep: noSleep });

    // บันทึกข้อสังเกตไว้แล้ว
    expect(store.observations).toHaveLength(1);
    expect(store.observations[0].window_closed).toBe(true);
    expect(store.observations[0].conversation_id).toBe('conv-1');

    // ⭐ ประวัติข้อความจริงยังเป็นค่าเดิมเป๊ะ
    expect(store.factualLastCustomerMessageAt).toBe(before);
    const ctx = store.resolveResult as { state: { last_customer_message_at: Date } };
    expect(ctx.state.last_customer_message_at).toBe(before);
  });

  it('error ชั่วคราวไม่ต้องบันทึกเป็นข้อสังเกตเชิงนโยบาย', async () => {
    fakeMeta([{ status: 503, body: { error: { code: 2 } } }]);
    await sendMessage(req(), { now: NOW, sleep: noSleep, maxRetries: 1 });
    expect(store.observations).toHaveLength(0);
  });
});

/* ================================================================== */
describe('🔴 ความสัมพันธ์ของข้อมูลไม่ตรง → ไม่ส่ง', () => {
  it('ห้องแชทไม่มีจริง', async () => {
    store.resolveResult = { error_code: 'not_found', error_th: 'ไม่พบห้องแชทนี้' };
    const calls = fakeMeta([{ status: 200, body: {} }]);
    const result = await sendMessage(req(), { now: NOW, sleep: noSleep });
    expect(result.sent).toBe(false);
    expect(result.reason_code).toBe('CONTEXT_NOT_FOUND');
    expect(calls).toHaveLength(0);
  });

  it('ลูกค้ากับเพจไม่สัมพันธ์กัน', async () => {
    store.resolveResult = {
      error_code: 'mismatch',
      error_th: 'ข้อมูลลูกค้ากับเพจของห้องแชทไม่ตรงกัน ระบบจึงไม่ส่งเพื่อความปลอดภัย',
    };
    const calls = fakeMeta([{ status: 200, body: {} }]);
    const result = await sendMessage(req(), { now: NOW, sleep: noSleep });
    expect(result.sent).toBe(false);
    expect(result.reason_code).toBe('CONTEXT_MISMATCH');
    expect(calls).toHaveLength(0);
  });
});

/* ================================================================== */
describe('payload ที่ยิงออกไป', () => {
  it('ส่งไปที่เพจถูกตัว ผู้รับถูกคน', async () => {
    const calls = fakeMeta([{ status: 200, body: { message_id: 'mid.1' } }]);
    await sendMessage(req(), { now: NOW, sleep: noSleep });
    expect(calls[0].url).toContain('/123456/messages');
    expect(calls[0].body).toMatchObject({ recipient: { id: 'psid-1' } });
  });

  it('งานส่งเป็นชุดยังคงบันทึกว่าไม่ใช่คนพิมพ์เอง', async () => {
    fakeMeta([{ status: 200, body: { message_id: 'mid.1' } }]);
    await sendMessage(req({ provenance: bulkJobProvenance('admin-9') }), { now: NOW, sleep: noSleep });
    expect(store.attempts[0].human_typed).toBe(false);
    expect(store.attempts[0].admin_id).toBe('admin-9');
  });
});
