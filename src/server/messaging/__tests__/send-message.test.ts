/**
 * ชุดทดสอบ sendMessage() — ทางออกเดียวของการส่งข้อความ
 * ===========================================================================
 * ใช้ฐานข้อมูลจำลองในหน่วยความจำ + Meta ปลอม
 * จึงทดสอบได้ครบโดยไม่ต้องมี Supabase และไม่ต้องมี Meta App
 *
 * สิ่งที่ตรวจในชุดนี้ :
 *   • ส่งไม่ได้ตามนโยบาย → ต้องไม่ยิงออกไปหา Meta เลยแม้แต่ครั้งเดียว
 *   • บันทึก send_attempts ทุกครั้ง ทั้งสำเร็จและไม่สำเร็จ
 *   • retry เฉพาะ error ชั่วคราว / error เชิงนโยบายห้าม retry
 *   • กันส่งซ้ำด้วย idempotency_key
 *   • feedback loop : Meta บอกว่ากรอบเวลาปิดแล้ว → แก้ข้อมูลให้ตรงความจริง
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* ---------------------------------------------------------------- */
/* ตั้งค่า env จำลองก่อน import อะไรที่อ่าน env                        */
/* ---------------------------------------------------------------- */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'a'.repeat(40);
process.env.SUPABASE_SERVICE_ROLE_KEY = 'b'.repeat(40);
process.env.SESSION_SECRET = 'c'.repeat(40);
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

/* ---------------------------------------------------------------- */
/* ฐานข้อมูลจำลอง                                                    */
/* ---------------------------------------------------------------- */
type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  customers: [],
  pages: [],
  conversations: [],
  send_attempts: [],
};

function resetTables() {
  for (const key of Object.keys(tables)) tables[key] = [];
}

/** ตัวจำลอง query builder ของ supabase-js เท่าที่ send-message ใช้จริง */
function fakeFrom(table: string) {
  const filters: Array<[string, unknown]> = [];
  let pending: 'select' | 'insert' | 'update' | null = null;
  let payload: Row | null = null;

  const api = {
    select() {
      if (pending === null) pending = 'select';
      return api;
    },
    insert(row: Row) {
      pending = 'insert';
      payload = { id: `${table}-${tables[table].length + 1}`, ...row };
      return api;
    },
    update(row: Row) {
      pending = 'update';
      payload = row;
      return api;
    },
    eq(col: string, val: unknown) {
      filters.push([col, val]);
      return api;
    },
    match() {
      return api;
    },
    async maybeSingle() {
      const found = rows().at(0) ?? null;
      return { data: found, error: null };
    },
    async single() {
      if (pending === 'insert' && payload) {
        tables[table].push(payload);
        return { data: payload, error: null };
      }
      return { data: rows().at(0) ?? null, error: null };
    },
    /** update ที่ไม่ต่อ .select() — await ตรง ๆ */
    then(resolve: (v: { data: null; error: null }) => void) {
      if (pending === 'update' && payload) {
        for (const row of rows()) Object.assign(row, payload);
      }
      if (pending === 'insert' && payload) tables[table].push(payload);
      resolve({ data: null, error: null });
    },
  };

  function rows(): Row[] {
    return tables[table].filter((r) => filters.every(([c, v]) => r[c] === v));
  }

  return api;
}

vi.mock('@/lib/supabase/admin', () => ({
  db: () => ({ from: (t: string) => fakeFrom(t) }),
}));

/* ---------------------------------------------------------------- */
import { sendMessage } from '../send-message';
import { __setFetcherForTests } from '@/server/meta/client';
import { encryptSecret } from '@/lib/crypto';
import { resetPolicyConfigCache } from '@/server/policy/config';
import type { SendContext } from '@/server/policy/types';

const NOW = new Date('2026-08-23T12:00:00Z');
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

/** ตั้งข้อมูลตั้งต้น : เพจ 1 เพจ ลูกค้า 1 คน ห้องแชท 1 ห้อง */
function seed(opts: { lastCustomerMessageAt?: string | null; marketingEligible?: boolean } = {}) {
  resetTables();
  tables.pages.push({
    id: 'page-1',
    platform: 'facebook',
    page_id: '123456',
    access_token: encryptSecret('EAA-fake-token'),
    is_active: true,
  });
  tables.customers.push({
    id: 'cus-1',
    psid: 'psid-1',
    page_id: 'page-1',
    marketing_eligible: opts.marketingEligible ?? false,
    marketing_checked_at: null,
    last_customer_message_at: opts.lastCustomerMessageAt ?? hoursAgo(1),
  });
  tables.conversations.push({
    id: 'conv-1',
    last_customer_message_at: opts.lastCustomerMessageAt ?? hoursAgo(1),
  });
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

/** Meta ปลอม — นับจำนวนครั้งที่ถูกยิง */
function fakeMeta(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  let i = 0;
  __setFetcherForTests((async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
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
  seed();
});

/* ================================================================== */
describe('ส่งได้ตามปกติ', () => {
  it('อยู่ในกรอบเวลา → ยิงออกไปหา Meta และบันทึกผลสำเร็จ', async () => {
    const calls = fakeMeta([{ status: 200, body: { message_id: 'mid.123' } }]);

    const result = await sendMessage(ctx(), { now: NOW, sleep: noSleep });

    expect(result.sent).toBe(true);
    expect(result.decision.transport).toBe('STANDARD');
    expect(result.meta_message_id).toBe('mid.123');
    expect(result.badge_th).toBe('ส่งปกติ');
    expect(calls).toHaveLength(1);

    const attempt = tables.send_attempts[0];
    expect(attempt.success).toBe(true);
    expect(attempt.selected_transport).toBe('STANDARD');
    expect(attempt.triggered_by).toBe('admin');
    expect(attempt.human_typed).toBe(true);
    expect(attempt.sent_at).toBeTruthy();
  });

  it('เก็บผลการตัดสินของ engine ไว้ใน send_attempts ด้วย', async () => {
    fakeMeta([{ status: 200, body: { message_id: 'mid.1' } }]);
    await sendMessage(ctx(), { now: NOW, sleep: noSleep });
    const decision = tables.send_attempts[0].policy_decision as { evaluated: unknown[] };
    expect(Array.isArray(decision.evaluated)).toBe(true);
  });
});

/* ================================================================== */
describe('🔴 ส่งไม่ได้ตามนโยบาย → ต้องไม่ยิงออกไปเลย', () => {
  it('พ้นกรอบเวลาแล้ว และไม่มีช่องทางอื่นเปิดอยู่', async () => {
    seed({ lastCustomerMessageAt: hoursAgo(300) });
    const calls = fakeMeta([{ status: 200, body: { message_id: 'ไม่ควรถูกเรียก' } }]);

    const result = await sendMessage(ctx(), { now: NOW, sleep: noSleep });

    expect(result.sent).toBe(false);
    expect(calls).toHaveLength(0); // ← ไม่ยิงออกไปแม้แต่ครั้งเดียว
    expect(result.badge_th).toBe('ส่งไม่ได้ตาม Meta');
    expect(result.reason_th).toContain('Meta');
    expect(tables.send_attempts).toHaveLength(1);
    expect(tables.send_attempts[0].success).toBe(false);
    expect(tables.send_attempts[0].selected_transport).toBeNull();
  });

  it('บอทพยายามส่งข้อความขายหลังลูกค้าเงียบ → ถูกปฏิเสธ ไม่ยิงออกไป', async () => {
    seed({ lastCustomerMessageAt: hoursAgo(300) });
    const calls = fakeMeta([{ status: 200, body: {} }]);

    const result = await sendMessage(
      ctx({ message_type: 'promotion', triggered_by: 'bot', human_typed: false }),
      { now: NOW, sleep: noSleep },
    );

    expect(result.sent).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('ไม่พบลูกค้า → ตอบเป็นภาษาไทย ไม่ยิงออกไป', async () => {
    resetTables();
    const calls = fakeMeta([{ status: 200, body: {} }]);
    const result = await sendMessage(ctx(), { now: NOW, sleep: noSleep });
    expect(result.sent).toBe(false);
    expect(result.reason_th).toContain('ไม่พบข้อมูลลูกค้า');
    expect(calls).toHaveLength(0);
  });
});

/* ================================================================== */
describe('🔴 retry — เฉพาะ error ชั่วคราวเท่านั้น', () => {
  it('เจอ 500 แล้วสำเร็จในครั้งที่สอง', async () => {
    const calls = fakeMeta([
      { status: 500, body: { error: { code: 2, message: 'temporary' } } },
      { status: 200, body: { message_id: 'mid.retry' } },
    ]);

    const result = await sendMessage(ctx(), { now: NOW, sleep: noSleep, maxRetries: 3 });

    expect(result.sent).toBe(true);
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('error เชิงนโยบาย → ยิงครั้งเดียวแล้วหยุด ห้ามลองซ้ำ', async () => {
    const calls = fakeMeta([
      { status: 400, body: { error: { code: 10, error_subcode: 2018278, message: 'outside window' } } },
    ]);

    const result = await sendMessage(ctx(), { now: NOW, sleep: noSleep, maxRetries: 5 });

    expect(result.sent).toBe(false);
    expect(result.attempts).toBe(1); // ← ไม่ลองซ้ำ
    expect(calls).toHaveLength(1);
    expect(result.reason_code).toBe('META_POLICY_ERROR');
  });

  it('ชั่วคราวแต่ลองครบโควตาแล้วยังไม่ผ่าน → หยุดตามจำนวนที่กำหนด', async () => {
    const calls = fakeMeta([{ status: 503, body: { error: { code: 2 } } }]);
    const result = await sendMessage(ctx(), { now: NOW, sleep: noSleep, maxRetries: 3 });
    expect(result.sent).toBe(false);
    expect(calls).toHaveLength(3);
    expect(result.reason_code).toBe('META_TRANSIENT_ERROR');
  });

  it('บันทึกรายละเอียด error ของ Meta ไว้สืบย้อนหลัง', async () => {
    fakeMeta([
      { status: 400, body: { error: { code: 10, error_subcode: 2018278, message: 'nope', fbtrace_id: 'TRACE1' } } },
    ]);
    await sendMessage(ctx(), { now: NOW, sleep: noSleep });
    const a = tables.send_attempts[0];
    expect(a.meta_response_code).toBe(10);
    expect(a.meta_error_subcode).toBe(2018278);
    expect(a.fbtrace_id).toBe('TRACE1');
  });
});

/* ================================================================== */
describe('feedback loop — แก้ข้อมูลให้ตรงความจริง', () => {
  it('Meta บอกว่ากรอบเวลาปิดแล้ว → ล้าง last_customer_message_at ทิ้ง', async () => {
    fakeMeta([
      { status: 400, body: { error: { code: 10, error_subcode: 2018278, message: 'outside window' } } },
    ]);

    expect(tables.conversations[0].last_customer_message_at).toBeTruthy();
    await sendMessage(ctx(), { now: NOW, sleep: noSleep });

    expect(tables.conversations[0].last_customer_message_at).toBeNull();
    expect(tables.customers[0].last_customer_message_at).toBeNull();
  });

  it('error ชั่วคราวไม่ควรไปแก้ข้อมูล', async () => {
    fakeMeta([{ status: 500, body: { error: { code: 2 } } }]);
    await sendMessage(ctx(), { now: NOW, sleep: noSleep, maxRetries: 1 });
    expect(tables.conversations[0].last_customer_message_at).toBeTruthy();
  });
});

/* ================================================================== */
describe('กันส่งซ้ำ (idempotency)', () => {
  it('กุญแจเดิมที่เคยส่งสำเร็จแล้ว → ข้าม ไม่ยิงซ้ำ', async () => {
    const calls = fakeMeta([{ status: 200, body: { message_id: 'mid.1' } }]);

    const first = await sendMessage(ctx({ idempotency_key: 'ship-order-1' }), { now: NOW, sleep: noSleep });
    expect(first.sent).toBe(true);
    expect(calls).toHaveLength(1);

    const second = await sendMessage(ctx({ idempotency_key: 'ship-order-1' }), { now: NOW, sleep: noSleep });
    expect(second.sent).toBe(false);
    expect(second.reason_code).toBe('DUPLICATE_SKIPPED');
    expect(calls).toHaveLength(1); // ← ยังคงยิงแค่ครั้งเดียว
  });

  it('กุญแจคนละตัว → ส่งได้ตามปกติ', async () => {
    const calls = fakeMeta([{ status: 200, body: { message_id: 'mid.1' } }]);
    await sendMessage(ctx({ idempotency_key: 'a' }), { now: NOW, sleep: noSleep });
    await sendMessage(ctx({ idempotency_key: 'b' }), { now: NOW, sleep: noSleep });
    expect(calls).toHaveLength(2);
  });

  it('ครั้งที่ส่งไม่สำเร็จไม่นับว่าเคยส่งแล้ว ยังลองใหม่ได้', async () => {
    fakeMeta([{ status: 400, body: { error: { code: 100, message: 'bad' } } }]);
    const first = await sendMessage(ctx({ idempotency_key: 'k1' }), { now: NOW, sleep: noSleep });
    expect(first.sent).toBe(false);

    const calls = fakeMeta([{ status: 200, body: { message_id: 'mid.ok' } }]);
    const second = await sendMessage(ctx({ idempotency_key: 'k1' }), { now: NOW, sleep: noSleep });
    expect(second.sent).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

/* ================================================================== */
describe('payload ที่ยิงออกไปต้องถูกต้อง', () => {
  it('ส่งไปที่ page_id ของเพจ และมี recipient เป็น psid ของลูกค้า', async () => {
    const calls = fakeMeta([{ status: 200, body: { message_id: 'mid.1' } }]);
    await sendMessage(ctx(), { now: NOW, sleep: noSleep });
    expect(calls[0].url).toContain('/123456/messages');
    expect(calls[0].body).toMatchObject({
      recipient: { id: 'psid-1' },
      messaging_type: 'RESPONSE',
      message: { text: 'สวัสดีค่ะ' },
    });
  });

  it('ไม่มี message tag แบบเก่าติดไปกับ payload', async () => {
    const calls = fakeMeta([{ status: 200, body: { message_id: 'mid.1' } }]);
    await sendMessage(ctx(), { now: NOW, sleep: noSleep });
    const json = JSON.stringify(calls[0].body);
    expect(json).not.toContain('POST_PURCHASE');
    expect(json).not.toContain('ACCOUNT_UPDATE');
  });
});
