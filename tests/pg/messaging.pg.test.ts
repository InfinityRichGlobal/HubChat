/**
 * ชุดทดสอบกับ PostgreSQL จริง (รอบ 2.1)
 * ===========================================================================
 * ชุดนี้พิสูจน์สิ่งที่ฐานข้อมูลปลอมพิสูจน์ไม่ได้ :
 *
 *   1. คำขอสองอันมาพร้อมกันด้วยกุญแจเดียวกัน → ยิง Meta ครั้งเดียวเท่านั้น
 *   2. ความปลอดภัยมาจาก unique constraint ของฐานข้อมูลจริง ไม่ใช่จังหวะของ JavaScript
 *   3. timeout → ไม่ลองใหม่ และบันทึกว่า "ไม่ทราบผล"
 *   4. คำตอบของ Meta ไม่ไปลบประวัติข้อความจริง
 *   5. งานอัตโนมัติปลอมเป็นคนไม่ได้
 *   6. ข้อมูลที่ไม่สัมพันธ์กันถูกปฏิเสธ
 *
 * รัน : npm run test:pg     (ต้องมี PostgreSQL ในเครื่อง)
 * ถ้าไม่มี Postgres ชุดนี้จะข้ามให้เอง
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { postgresAvailable, resetDatabase, startRestServer, testPool, type RestServer } from './harness';

const available = await postgresAvailable();

/* ---------------------------------------------------------------- */
/* ตั้งค่า env ให้ชี้มาที่สนามทดสอบ ก่อน import โค้ดจริง                 */
/* ---------------------------------------------------------------- */
const REST_PORT = Number(process.env.HUBCHAT_TEST_REST_PORT ?? 54399);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${REST_PORT}`;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'a'.repeat(40);
process.env.SUPABASE_SERVICE_ROLE_KEY = 'b'.repeat(40);
process.env.SESSION_SECRET = 'c'.repeat(40);
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');

const { sendMessage } = await import('@/server/messaging/send-message');
const { keywordBotProvenance, schedulerProvenance } = await import('@/server/messaging/provenance');
const { __setFetcherForTests } = await import('@/server/meta/client');
const { encryptSecret } = await import('@/lib/crypto');
const { resetPolicyConfigCache } = await import('@/server/policy/config');

let pool: Pool;
let rest: RestServer;

const ids = {
  page: randomUUID(),
  customer: randomUUID(),
  conversation: randomUUID(),
  otherPage: randomUUID(),
  strayCustomer: randomUUID(),
  strayConversation: randomUUID(),
};

/** เวลาที่ลูกค้าทักมาจริง — ชุดทดสอบจะยืนยันว่าค่านี้ห้ามถูกแก้ */
const CUSTOMER_MESSAGED_AT = new Date(Date.now() - 2 * 3_600_000);

describe.skipIf(!available)('PostgreSQL จริง — การรับประกันของระบบส่งข้อความ', () => {
  beforeAll(async () => {
    await resetDatabase();
    pool = testPool();
    rest = await startRestServer(pool);
  }, 120_000);

  afterAll(async () => {
    await rest?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    resetPolicyConfigCache();
    __setFetcherForTests(null);

    await pool.query('truncate send_attempts, message_sends, conversation_policy_state cascade');
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');

    const token = encryptSecret('EAA-fake-token');
    await pool.query(
      `insert into pages (id, platform, page_id, page_name, access_token, is_active)
       values ($1,'facebook','111111','เพจทดสอบ',$2,true), ($3,'facebook','222222','เพจอื่น',$2,true)`,
      [ids.page, token, ids.otherPage],
    );
    await pool.query(
      `insert into customers (id, page_id, psid, platform, name, last_customer_message_at)
       values ($1,$2,'psid-1','facebook','คุณลูกค้า',$3)`,
      [ids.customer, ids.page, CUSTOMER_MESSAGED_AT.toISOString()],
    );
    await pool.query(
      `insert into conversations (id, customer_id, page_id, last_message_at, last_customer_message_at)
       values ($1,$2,$3, now(), $4)`,
      [ids.conversation, ids.customer, ids.page, CUSTOMER_MESSAGED_AT.toISOString()],
    );

    // ลูกค้าที่อยู่คนละเพจกับห้องแชท — ใช้ทดสอบว่าข้อมูลไม่สัมพันธ์กันต้องถูกบล็อก
    await pool.query(
      `insert into customers (id, page_id, psid, platform, last_customer_message_at)
       values ($1,$2,'psid-stray','facebook',$3)`,
      [ids.strayCustomer, ids.otherPage, CUSTOMER_MESSAGED_AT.toISOString()],
    );
    await pool.query(
      `insert into conversations (id, customer_id, page_id, last_message_at, last_customer_message_at)
       values ($1,$2,$3, now(), $4)`,
      [ids.strayConversation, ids.strayCustomer, ids.page, CUSTOMER_MESSAGED_AT.toISOString()],
    );
  });

  /** Meta ปลอมที่นับจำนวนครั้งที่ถูกยิงจริง (นับแบบ atomic ในโปรเซสเดียว) */
  function fakeMeta(handler: (n: number) => Promise<Response> | Response) {
    const state = { calls: 0 };
    __setFetcherForTests((async () => {
      state.calls += 1;
      return handler(state.calls);
    }) as typeof fetch);
    return state;
  }

  const okResponse = (id: string) =>
    new Response(JSON.stringify({ message_id: id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  function baseReq(overrides: Record<string, unknown> = {}) {
    return {
      conversation_id: ids.conversation,
      message_type: 'inquiry_response' as const,
      provenance: keywordBotProvenance(),
      content: { text: 'สวัสดีค่ะ' },
      ...overrides,
    };
  }

  /* ============================================================== */
  it('🔴 คำขอพร้อมกัน 5 อันด้วยกุญแจเดียวกัน → ยิง Meta ครั้งเดียว', async () => {
    const meta = fakeMeta(async (n) => {
      // หน่วงให้คำขออื่นมีโอกาสวิ่งแซง — จำลองสถานการณ์จริงที่แย่ที่สุด
      await new Promise((r) => setTimeout(r, 60));
      return okResponse(`mid.${n}`);
    });

    const key = `race-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => sendMessage(baseReq({ idempotency_key: key }), { sleep: async () => {} })),
    );

    // ⭐ ยิงออกไปหา Meta ครั้งเดียวเท่านั้น
    expect(meta.calls).toBe(1);

    // มีคำขอเดียวที่ส่งสำเร็จ ที่เหลือรู้ตัวว่าแพ้การจอง
    expect(results.filter((r) => r.sent)).toHaveLength(1);
    expect(results.filter((r) => !r.sent)).toHaveLength(4);
    for (const r of results.filter((x) => !x.sent)) {
      expect(['SEND_IN_PROGRESS', 'DUPLICATE_SKIPPED']).toContain(r.reason_code);
    }

    // ฐานข้อมูลมี logical send เดียว และสำเร็จเดียว
    const sends = await pool.query('select status from message_sends where idempotency_key = $1', [key]);
    expect(sends.rowCount).toBe(1);
    expect(sends.rows[0].status).toBe('succeeded');

    const success = await pool.query(
      'select count(*)::int n from send_attempts where idempotency_key = $1 and success = true',
      [key],
    );
    expect(success.rows[0].n).toBe(1);
  }, 60_000);

  /* ============================================================== */
  it('🔴 ความปลอดภัยมาจากฐานข้อมูลจริง ไม่ใช่จังหวะของ JavaScript', async () => {
    const key = `dbguard-${randomUUID()}`;
    // จองสิทธิ์ตรง ๆ สองครั้งด้วยกุญแจเดียวกัน
    const args = [key, ids.customer, ids.conversation, ids.page, 'messenger', 'inquiry_response',
      'bot', 'keyword_bot', false, null, 120];
    const sql = `select * from claim_message_send($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;

    const [a, b] = await Promise.all([pool.query(sql, args), pool.query(sql, args)]);
    const wins = [a.rows[0].won, b.rows[0].won];

    // ต้องมีผู้ชนะคนเดียวเสมอ
    expect(wins.filter(Boolean)).toHaveLength(1);
    expect(a.rows[0].send_id).toBe(b.rows[0].send_id);

    // และ unique index กันแถวซ้ำที่ระดับฐานข้อมูล
    await expect(
      pool.query(
        `insert into message_sends (idempotency_key, channel, message_type, triggered_by,
           provenance_kind, claim_expires_at)
         values ($1,'messenger','inquiry_response','bot','keyword_bot', now() + interval '1 minute')`,
        [key],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  /* ============================================================== */
  it('🔴 timeout ระหว่างยิง → ไม่ลองใหม่ และบันทึกว่าไม่ทราบผล', async () => {
    const meta = fakeMeta(() => {
      throw new Error('The operation was aborted due to timeout');
    });

    const key = `timeout-${randomUUID()}`;
    const result = await sendMessage(baseReq({ idempotency_key: key }), {
      maxRetries: 5,
      sleep: async () => {},
    });

    expect(meta.calls).toBe(1); // ← ยิงครั้งเดียว ไม่ retry
    expect(result.sent).toBe(false);
    expect(result.outcome_unknown).toBe(true);

    const row = await pool.query(
      'select status, network_attempts from message_sends where idempotency_key = $1',
      [key],
    );
    expect(row.rows[0].status).toBe('outcome_unknown');
    expect(row.rows[0].network_attempts).toBe(1);

    // ⭐ ลองส่งด้วยกุญแจเดิมอีกครั้ง ต้องไม่ยิงซ้ำ
    const again = await sendMessage(baseReq({ idempotency_key: key }), { sleep: async () => {} });
    expect(meta.calls).toBe(1);
    expect(again.outcome_unknown).toBe(true);
  });

  /* ============================================================== */
  it('🔴 คำตอบเชิงนโยบายของ Meta ห้ามลบประวัติข้อความจริง', async () => {
    fakeMeta(
      () =>
        new Response(
          JSON.stringify({
            error: { code: 10, error_subcode: 2018278, message: 'outside window', fbtrace_id: 'TR-1' },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const before = await pool.query(
      'select last_customer_message_at from conversations where id = $1',
      [ids.conversation],
    );

    const result = await sendMessage(baseReq({ idempotency_key: `policy-${randomUUID()}` }), {
      sleep: async () => {},
    });
    expect(result.sent).toBe(false);

    /* ⭐ ประวัติข้อความจริงต้องเป็นค่าเดิมเป๊ะ */
    const afterConv = await pool.query(
      'select last_customer_message_at from conversations where id = $1',
      [ids.conversation],
    );
    const afterCust = await pool.query(
      'select last_customer_message_at from customers where id = $1',
      [ids.customer],
    );
    expect(afterConv.rows[0].last_customer_message_at).toEqual(before.rows[0].last_customer_message_at);
    expect(afterConv.rows[0].last_customer_message_at).not.toBeNull();
    expect(afterCust.rows[0].last_customer_message_at).not.toBeNull();

    /* ⭐ สิ่งที่ Meta บอกถูกเก็บไว้ต่างหาก */
    const observed = await pool.query(
      'select * from conversation_policy_state where conversation_id = $1',
      [ids.conversation],
    );
    expect(observed.rowCount).toBe(1);
    expect(observed.rows[0].window_closed_observed_at).not.toBeNull();
    expect(observed.rows[0].last_policy_error_subcode).toBe(2018278);
    expect(observed.rows[0].last_fbtrace_id).toBe('TR-1');
  });

  /* ============================================================== */
  it('เมื่อ Meta เคยบอกว่าส่งไม่ได้ ครั้งต่อไปต้องไม่ยิงออกไปอีก (fail closed)', async () => {
    // บันทึกข้อสังเกตไว้ก่อน
    await pool.query(
      `insert into conversation_policy_state (conversation_id, window_closed_observed_at)
       values ($1, now())`,
      [ids.conversation],
    );

    const meta = fakeMeta(() => okResponse('ไม่ควรถูกเรียก'));
    const result = await sendMessage(baseReq({ idempotency_key: `closed-${randomUUID()}` }), {
      sleep: async () => {},
    });

    expect(meta.calls).toBe(0);
    expect(result.sent).toBe(false);
    expect(result.decision.evaluated.find((e) => e.transport === 'STANDARD')?.reason_code).toBe(
      'WINDOW_CLOSED_BY_META',
    );
  });

  /* ============================================================== */
  it('ส่งสำเร็จ → ล้างสถานะ "เคยถูกปฏิเสธ" และเก็บ meta_message_id', async () => {
    await pool.query(
      `insert into conversation_policy_state (conversation_id, window_closed_observed_at)
       values ($1, now())`,
      [ids.conversation],
    );
    // ลูกค้าทักกลับมาใหม่ ข้อสังเกตเก่าจึงใช้ไม่ได้แล้ว
    await pool.query('update conversations set last_customer_message_at = now() where id = $1', [
      ids.conversation,
    ]);

    fakeMeta(() => okResponse('mid.success'));
    const key = `ok-${randomUUID()}`;
    const result = await sendMessage(baseReq({ idempotency_key: key }), { sleep: async () => {} });

    expect(result.sent).toBe(true);
    expect(result.meta_message_id).toBe('mid.success');

    const send = await pool.query(
      'select meta_message_id, network_attempts, status from message_sends where idempotency_key = $1',
      [key],
    );
    expect(send.rows[0].meta_message_id).toBe('mid.success');
    expect(send.rows[0].status).toBe('succeeded');

    const attempt = await pool.query(
      'select meta_message_id, attempt_no from send_attempts where idempotency_key = $1 and success = true',
      [key],
    );
    expect(attempt.rows[0].meta_message_id).toBe('mid.success');
    expect(attempt.rows[0].attempt_no).toBe(1);

    const observed = await pool.query(
      'select window_closed_observed_at, last_verified_send_at from conversation_policy_state where conversation_id = $1',
      [ids.conversation],
    );
    expect(observed.rows[0].window_closed_observed_at).toBeNull();
    expect(observed.rows[0].last_verified_send_at).not.toBeNull();
  });

  /* ============================================================== */
  it('ประวัติการ retry เก็บครบทุกครั้ง ไม่เขียนทับกัน', async () => {
    fakeMeta(
      () =>
        new Response(JSON.stringify({ error: { code: 2, message: 'temporary' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const key = `retry-${randomUUID()}`;
    const result = await sendMessage(baseReq({ idempotency_key: key }), {
      maxRetries: 3,
      sleep: async () => {},
    });

    expect(result.attempts).toBe(3);
    const rows = await pool.query(
      'select attempt_no, success from send_attempts where idempotency_key = $1 order by attempt_no',
      [key],
    );
    expect(rows.rows.map((r) => r.attempt_no)).toEqual([1, 2, 3]);
    expect(rows.rows.every((r) => r.success === false)).toBe(true);

    const send = await pool.query(
      'select status, network_attempts from message_sends where idempotency_key = $1',
      [key],
    );
    expect(send.rows[0].network_attempts).toBe(3);
    expect(send.rows[0].status).toBe('retryable_failed');
  });

  /* ============================================================== */
  it('🔴 งานอัตโนมัติใช้ HUMAN_AGENT ไม่ได้ แม้เปิดช่องทางไว้แล้ว', async () => {
    process.env.POLICY_MESSENGER_HUMAN_AGENT_ENABLED = 'true';
    process.env.POLICY_MESSENGER_HUMAN_AGENT_VERIFIED = 'true';
    resetPolicyConfigCache();

    // ให้พ้นกรอบเวลาปกติ เพื่อบังคับให้ต้องใช้ HUMAN_AGENT ถึงจะส่งได้
    await pool.query(
      `update conversations set last_customer_message_at = now() - interval '30 hours' where id = $1`,
      [ids.conversation],
    );
    await pool.query(
      `update customers set last_customer_message_at = now() - interval '30 hours' where id = $1`,
      [ids.customer],
    );

    const meta = fakeMeta(() => okResponse('ไม่ควรถูกเรียก'));

    for (const prov of [keywordBotProvenance(), schedulerProvenance()]) {
      const r = await sendMessage(
        baseReq({ provenance: prov, idempotency_key: `auto-${randomUUID()}` }),
        { sleep: async () => {} },
      );
      expect(r.sent).toBe(false);
      expect(r.decision.evaluated.find((e) => e.transport === 'HUMAN_AGENT')?.reason_code).toBe(
        'REQUIRES_HUMAN_TYPED',
      );
    }

    expect(meta.calls).toBe(0);

    delete process.env.POLICY_MESSENGER_HUMAN_AGENT_ENABLED;
    delete process.env.POLICY_MESSENGER_HUMAN_AGENT_VERIFIED;
    resetPolicyConfigCache();
  });

  /* ============================================================== */
  it('🔴 แหล่งที่มาที่ปลอมมา ถูกปฏิเสธก่อนแตะฐานข้อมูล', async () => {
    const meta = fakeMeta(() => okResponse('ไม่ควรถูกเรียก'));
    const forged = {
      kind: 'human_admin_reply',
      triggered_by: 'admin',
      human_authored: true,
      admin_id: randomUUID(),
    };

    const r = await sendMessage(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      baseReq({ provenance: forged as any, idempotency_key: `forge-${randomUUID()}` }),
      { sleep: async () => {} },
    );

    expect(r.sent).toBe(false);
    expect(r.reason_code).toBe('UNTRUSTED_PROVENANCE');
    expect(meta.calls).toBe(0);
    // ไม่มีการจองสิทธิ์เกิดขึ้นเลย
    const sends = await pool.query('select count(*)::int n from message_sends');
    expect(sends.rows[0].n).toBe(0);
  });

  /* ============================================================== */
  it('🔴 ลูกค้ากับเพจไม่สัมพันธ์กัน → ไม่ส่ง', async () => {
    const meta = fakeMeta(() => okResponse('ไม่ควรถูกเรียก'));
    const r = await sendMessage(
      baseReq({ conversation_id: ids.strayConversation, idempotency_key: `mismatch-${randomUUID()}` }),
      { sleep: async () => {} },
    );

    expect(r.sent).toBe(false);
    expect(r.reason_code).toBe('CONTEXT_MISMATCH');
    expect(meta.calls).toBe(0);
  });

  /* ============================================================== */
  it('🔴 ระบุลูกค้า/เพจที่ไม่ใช่ของห้องแชทนี้ → ไม่ส่ง', async () => {
    const meta = fakeMeta(() => okResponse('ไม่ควรถูกเรียก'));

    const wrongCustomer = await sendMessage(
      baseReq({
        expect: { expect_customer_id: ids.strayCustomer },
        idempotency_key: `x1-${randomUUID()}`,
      }),
      { sleep: async () => {} },
    );
    expect(wrongCustomer.reason_code).toBe('CONTEXT_MISMATCH');

    const wrongPage = await sendMessage(
      baseReq({ expect: { expect_page_id: ids.otherPage }, idempotency_key: `x2-${randomUUID()}` }),
      { sleep: async () => {} },
    );
    expect(wrongPage.reason_code).toBe('CONTEXT_MISMATCH');

    const wrongChannel = await sendMessage(
      baseReq({ expect: { expect_channel: 'instagram' as const }, idempotency_key: `x3-${randomUUID()}` }),
      { sleep: async () => {} },
    );
    expect(wrongChannel.reason_code).toBe('CONTEXT_MISMATCH');

    expect(meta.calls).toBe(0);
  });

  /* ============================================================== */
  it('claim ที่ค้างเกินเวลา → กลายเป็น "ไม่ทราบผล" ไม่ใช่ยิงซ้ำให้', async () => {
    const key = `stale-${randomUUID()}`;
    // จำลอง process ที่ตายกลางทาง : จองไว้แล้วหมดอายุ
    await pool.query(
      `insert into message_sends (idempotency_key, customer_id, conversation_id, page_id, channel,
         message_type, triggered_by, provenance_kind, status, claim_expires_at)
       values ($1,$2,$3,$4,'messenger','inquiry_response','bot','keyword_bot','claimed', now() - interval '1 minute')`,
      [key, ids.customer, ids.conversation, ids.page],
    );

    const meta = fakeMeta(() => okResponse('ไม่ควรถูกเรียก'));
    const r = await sendMessage(baseReq({ idempotency_key: key }), { sleep: async () => {} });

    expect(meta.calls).toBe(0);
    expect(r.outcome_unknown).toBe(true);

    const row = await pool.query('select status from message_sends where idempotency_key = $1', [key]);
    expect(row.rows[0].status).toBe('outcome_unknown');
  });
});
