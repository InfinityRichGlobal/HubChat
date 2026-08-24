/**
 * ชุดทดสอบตอบอัตโนมัติกับ PostgreSQL จริง (รอบ 6)
 * ===========================================================================
 * 🔴 นี่คือรอบแรกที่ระบบส่งข้อความเองโดยไม่มีคนกด
 *    ชุดนี้จึงพิสูจน์เรื่องที่ "ผิดแล้วลูกค้าเห็นทันที" :
 *
 *   A. webhook เดิมเข้ามาซ้ำ → ตอบครั้งเดียว
 *   B. worker 2 ตัวพร้อมกัน  → ตอบครั้งเดียว (ฐานข้อมูลเป็นคนกัน ไม่ใช่ JavaScript)
 *   C. ตรงสองกฎ → กฎ priority สูงกว่าชนะ
 *   D. priority เท่ากัน → ผลเหมือนเดิมทุกครั้ง
 *   E. กฎที่ปิดอยู่ → ไม่ส่ง
 *   F. Policy Engine บล็อก → ไม่ส่ง
 *   G. งานอัตโนมัติ → ห้ามได้ HUMAN_AGENT เด็ดขาด
 *   H. ไม่ทราบผล → ห้ามลองใหม่
 *   I. คีย์เวิร์ดภาษาไทย → จับถูก
 *   J. แก้กฎระหว่างทาง → ใช้กฎที่อ่านมาตอนนั้น และจดสำเนาไว้
 *   K. กฎที่เก็บเข้ากรุ → ไม่ทำงาน แต่ประวัติยังอยู่
 *   L. ข้อความพัง/ว่าง → ไม่ทำให้ระบบล้ม
 *
 * รัน : npm run test:pg
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { postgresAvailable, resetDatabase, startRestServer, testPool, type RestServer } from './harness';

const available = await postgresAvailable();

const REST_PORT = Number(process.env.HUBCHAT_TEST_REST_PORT ?? 54399);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${REST_PORT}`;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'a'.repeat(40);
process.env.SUPABASE_SERVICE_ROLE_KEY = 'b'.repeat(40);
process.env.SESSION_SECRET = 'c'.repeat(40);
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');

const { runAutoReply } = await import('@/server/autoreply/runner');
const { __setFetcherForTests } = await import('@/server/meta/client');
const { encryptSecret } = await import('@/lib/crypto');
const { resetPolicyConfigCache } = await import('@/server/policy/config');

let pool: Pool;
let rest: RestServer;

const ids = {
  page: randomUUID(),
  otherPage: randomUUID(),
  customer: randomUUID(),
  conversation: randomUUID(),
  admin: randomUUID(),
};

/** ลูกค้าทักมา 2 ชั่วโมงที่แล้ว = ยังอยู่ในกรอบ 24 ชม. จึงส่งได้ */
const RECENT = new Date(Date.now() - 2 * 3_600_000);
/** พ้นกรอบ 24 ชม. มาแล้ว — ใช้ทดสอบว่า Policy Engine บล็อกจริง */
const STALE = new Date(Date.now() - 40 * 3_600_000);

/* ------------------------------------------------------------------ */

describe.skipIf(!available)('PostgreSQL จริง — ตอบอัตโนมัติด้วยคีย์เวิร์ด', () => {
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

    await pool.query('truncate auto_reply_executions, send_attempts, message_sends, conversation_policy_state cascade');
    await pool.query('delete from keyword_rules');
    await pool.query('delete from messages');
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');
    await pool.query('delete from admins');

    await pool.query(
      `insert into admins (id, name, email, password_hash, role) values ($1,'เจ้าของ','o@test.local','x','owner')`,
      [ids.admin],
    );

    const token = encryptSecret('EAA-fake-token');
    await pool.query(
      `insert into pages (id, platform, page_id, page_name, access_token, is_active)
       values ($1,'facebook','111111','เพจทดสอบ',$2,true), ($3,'facebook','222222','เพจอื่น',$2,true)`,
      [ids.page, token, ids.otherPage],
    );
    await pool.query(
      `insert into customers (id, page_id, psid, platform, name, last_customer_message_at)
       values ($1,$2,'psid-1','facebook','คุณลูกค้า',$3)`,
      [ids.customer, ids.page, RECENT.toISOString()],
    );
    await pool.query(
      `insert into conversations (id, customer_id, page_id, last_message_at, last_customer_message_at)
       values ($1,$2,$3, now(), $4)`,
      [ids.conversation, ids.customer, ids.page, RECENT.toISOString()],
    );
  });

  /* ---------------- ตัวช่วย ---------------- */

  /** Meta ปลอมที่นับจำนวนครั้งที่ถูกยิงจริง */
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

  async function addRule(over: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `insert into keyword_rules (id, name, page_ids, match_type, keywords, reply_text, priority, is_active, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        over.name ?? 'กฎทดสอบ',
        over.page_ids ?? [],
        over.match_type ?? 'contains',
        over.keywords ?? ['ราคา'],
        over.reply_text ?? 'ราคา 290 บาทค่ะ',
        over.priority ?? 100,
        over.is_active ?? true,
        over.created_at ?? new Date().toISOString(),
      ],
    );
    return id;
  }

  /** สร้างข้อความขาเข้าหนึ่งข้อความ แล้วคืน id */
  async function addInbound(text: string | null, metaId = `mid-${randomUUID()}`): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `insert into messages (id, conversation_id, direction, sender_type, text, meta_message_id)
       values ($1,$2,'in','customer',$3,$4)`,
      [id, ids.conversation, text, metaId],
    );
    return id;
  }

  function input(messageId: string, text: string | null) {
    return {
      message_id: messageId,
      conversation_id: ids.conversation,
      page_id: ids.page,
      text,
    };
  }

  /* ================================================================ */
  /* A + B — กันตอบซ้ำ                                                 */
  /* ================================================================ */

  it('⭐ A) ข้อความเดิมถูกประมวลผลซ้ำ → ตอบครั้งเดียวเท่านั้น', async () => {
    await addRule();
    const meta = fakeMeta(() => okResponse('mid-out-1'));
    const msg = await addInbound('ราคาเท่าไหร่คะ');

    const first = await runAutoReply(input(msg, 'ราคาเท่าไหร่คะ'));
    const second = await runAutoReply(input(msg, 'ราคาเท่าไหร่คะ'));
    const third = await runAutoReply(input(msg, 'ราคาเท่าไหร่คะ'));

    expect(first.kind).toBe('sent');
    expect(second.kind).toBe('already_claimed');
    expect(third.kind).toBe('already_claimed');

    // 🔴 ตัวเลขนี้คือหัวใจ — ยิง Meta ครั้งเดียวจริง ๆ
    expect(meta.calls).toBe(1);

    const rows = await pool.query('select count(*)::int as n from auto_reply_executions where message_id = $1', [msg]);
    expect(rows.rows[0].n).toBe(1);
  });

  it('⭐ B) worker 2 ตัวยิงพร้อมกัน → ตอบครั้งเดียว (ฐานข้อมูลเป็นคนกัน)', async () => {
    await addRule();
    const meta = fakeMeta(() => okResponse('mid-out-2'));
    const msg = await addInbound('สนใจราคาค่ะ');

    // ยิงพร้อมกันจริง ๆ ไม่ใช่ทีละตัว
    const results = await Promise.all([
      runAutoReply(input(msg, 'สนใจราคาค่ะ')),
      runAutoReply(input(msg, 'สนใจราคาค่ะ')),
      runAutoReply(input(msg, 'สนใจราคาค่ะ')),
      runAutoReply(input(msg, 'สนใจราคาค่ะ')),
    ]);

    expect(results.filter((r) => r.kind === 'sent')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'already_claimed')).toHaveLength(3);
    expect(meta.calls).toBe(1);
  });

  it('ข้อความคนละข้อความ → ตอบได้ทั้งคู่ (การกันซ้ำต้องไม่กันเกินไป)', async () => {
    await addRule();
    const meta = fakeMeta((n) => okResponse(`mid-out-${n}`));
    const a = await addInbound('ราคาเท่าไหร่');
    const b = await addInbound('ราคาส่งด้วยเท่าไหร่');

    expect((await runAutoReply(input(a, 'ราคาเท่าไหร่'))).kind).toBe('sent');
    expect((await runAutoReply(input(b, 'ราคาส่งด้วยเท่าไหร่'))).kind).toBe('sent');
    expect(meta.calls).toBe(2);
  });

  /* ================================================================ */
  /* C + D — ลำดับความสำคัญ                                            */
  /* ================================================================ */

  it('⭐ C) ตรงสองกฎ → กฎ priority น้อยกว่าชนะ', async () => {
    const urgent = await addRule({ priority: 10, keywords: ['ราคา'], reply_text: 'ตอบด่วน' });
    await addRule({ priority: 200, keywords: ['ราคา'], reply_text: 'ตอบทั่วไป' });

    fakeMeta(() => okResponse('mid-out-3'));
    const msg = await addInbound('ราคาเท่าไหร่');
    const result = await runAutoReply(input(msg, 'ราคาเท่าไหร่'));

    expect(result.kind).toBe('sent');
    if (result.kind === 'sent') expect(result.rule_id).toBe(urgent);

    const exec = await pool.query('select rule_snapshot from auto_reply_executions where message_id = $1', [msg]);
    expect(exec.rows[0].rule_snapshot.reply_text).toBe('ตอบด่วน');
  });

  it('⭐ D) priority เท่ากัน → กฎที่สร้างก่อนชนะ และผลเหมือนเดิมทุกครั้ง', async () => {
    const older = await addRule({
      priority: 50, reply_text: 'กฎเก่า', created_at: '2026-01-01T00:00:00.000Z',
    });
    await addRule({ priority: 50, reply_text: 'กฎใหม่', created_at: '2026-06-01T00:00:00.000Z' });

    fakeMeta((n) => okResponse(`mid-out-${n}`));

    // ทำซ้ำ 5 รอบด้วยข้อความคนละข้อความ — ต้องได้กฎเดิมทุกครั้ง
    for (let i = 0; i < 5; i += 1) {
      const msg = await addInbound(`ราคา ${i}`);
      const r = await runAutoReply(input(msg, `ราคา ${i}`));
      expect(r.kind).toBe('sent');
      if (r.kind === 'sent') expect(r.rule_id).toBe(older);
    }
  });

  /* ================================================================ */
  /* E + K — สถานะของกฎ                                                */
  /* ================================================================ */

  it('⭐ E) กฎที่ปิดอยู่ → ไม่ส่ง และไม่ยิง Meta เลย', async () => {
    await addRule({ is_active: false });
    const meta = fakeMeta(() => okResponse('ไม่ควรถูกเรียก'));
    const msg = await addInbound('ราคาเท่าไหร่');

    expect((await runAutoReply(input(msg, 'ราคาเท่าไหร่'))).kind).toBe('no_rule');
    expect(meta.calls).toBe(0);
  });

  it('⭐ K) กฎที่เก็บเข้ากรุ → ไม่ทำงาน แม้ is_active ยังเป็น true', async () => {
    const id = await addRule({ is_active: true });
    await pool.query('update keyword_rules set archived_at = now() where id = $1', [id]);

    const meta = fakeMeta(() => okResponse('ไม่ควรถูกเรียก'));
    const msg = await addInbound('ราคาเท่าไหร่');

    expect((await runAutoReply(input(msg, 'ราคาเท่าไหร่'))).kind).toBe('no_rule');
    expect(meta.calls).toBe(0);
  });

  it('กฎของเพจอื่น → ไม่ทำงานกับเพจนี้', async () => {
    await addRule({ page_ids: [ids.otherPage] });
    const meta = fakeMeta(() => okResponse('ไม่ควรถูกเรียก'));
    const msg = await addInbound('ราคาเท่าไหร่');

    expect((await runAutoReply(input(msg, 'ราคาเท่าไหร่'))).kind).toBe('no_rule');
    expect(meta.calls).toBe(0);
  });

  /* ================================================================ */
  /* F + G — Policy Engine                                             */
  /* ================================================================ */

  it('⭐ F) พ้นกรอบ 24 ชม. → Policy Engine บล็อก ไม่ส่ง และจดเหตุผลไว้', async () => {
    await addRule();
    await pool.query(
      'update conversations set last_customer_message_at = $2 where id = $1',
      [ids.conversation, STALE.toISOString()],
    );
    await pool.query('update customers set last_customer_message_at = $2 where id = $1', [
      ids.customer, STALE.toISOString(),
    ]);

    const meta = fakeMeta(() => okResponse('ไม่ควรถูกเรียก'));
    const msg = await addInbound('ราคาเท่าไหร่');
    const result = await runAutoReply(input(msg, 'ราคาเท่าไหร่'));

    expect(result.kind).toBe('blocked');
    // 🔴 ไม่ยิง Meta เลยแม้แต่ครั้งเดียว
    expect(meta.calls).toBe(0);

    const exec = await pool.query(
      'select status, policy_reason_code, policy_reason_th from auto_reply_executions where message_id = $1',
      [msg],
    );
    expect(exec.rows[0].status).toBe('blocked');
    expect(exec.rows[0].policy_reason_th).toBeTruthy();
  });

  it('⭐ G) งานอัตโนมัติต้องไม่ได้ HUMAN_AGENT เด็ดขาด', async () => {
    await addRule();
    fakeMeta(() => okResponse('mid-out-4'));
    const msg = await addInbound('ราคาเท่าไหร่');
    await runAutoReply(input(msg, 'ราคาเท่าไหร่'));

    const exec = await pool.query(
      'select selected_transport from auto_reply_executions where message_id = $1',
      [msg],
    );
    expect(exec.rows[0].selected_transport).not.toBe('HUMAN_AGENT');
    expect(exec.rows[0].selected_transport).toBe('STANDARD');

    // ตรวจที่ตาราง send_attempts ด้วย — เป็นหลักฐานที่ใช้ยื่น App Review
    const attempts = await pool.query('select selected_transport from send_attempts');
    for (const row of attempts.rows) {
      expect(row.selected_transport).not.toBe('HUMAN_AGENT');
    }
  });

  it('⭐ G2) แม้พ้นกรอบ ก็ต้องไม่ยกระดับไปใช้ HUMAN_AGENT เพื่อให้ส่งได้', async () => {
    await addRule();
    await pool.query('update conversations set last_customer_message_at = $2 where id = $1', [
      ids.conversation, STALE.toISOString(),
    ]);
    await pool.query('update customers set last_customer_message_at = $2 where id = $1', [
      ids.customer, STALE.toISOString(),
    ]);

    const msg = await addInbound('ราคาเท่าไหร่');
    await runAutoReply(input(msg, 'ราคาเท่าไหร่'));

    const attempts = await pool.query('select selected_transport from send_attempts');
    for (const row of attempts.rows) {
      expect(row.selected_transport).not.toBe('HUMAN_AGENT');
    }
  });

  /* ================================================================ */
  /* H — ไม่ทราบผล                                                     */
  /* ================================================================ */

  it('⭐ H) ยิงแล้วไม่รู้ผล (timeout) → จดว่า unknown และห้ามลองใหม่', async () => {
    await addRule();
    const meta = fakeMeta(() => {
      throw new Error('network timeout');
    });
    const msg = await addInbound('ราคาเท่าไหร่');

    const result = await runAutoReply(input(msg, 'ราคาเท่าไหร่'));
    expect(result.kind).toBe('unknown');

    // 🔴 ยิงแค่ครั้งเดียว ไม่มีการลองใหม่
    expect(meta.calls).toBe(1);

    const exec = await pool.query('select status from auto_reply_executions where message_id = $1', [msg]);
    expect(exec.rows[0].status).toBe('unknown');

    // เรียกซ้ำอีกครั้ง (จำลอง worker รอบถัดไป) → ต้องไม่ยิงเพิ่ม
    const again = await runAutoReply(input(msg, 'ราคาเท่าไหร่'));
    expect(again.kind).toBe('already_claimed');
    expect(meta.calls).toBe(1);
  });

  /* ================================================================ */
  /* I — ภาษาไทย                                                       */
  /* ================================================================ */

  it('⭐ I) คีย์เวิร์ดภาษาไทยที่ไม่มีช่องว่าง → จับได้', async () => {
    await addRule({ keywords: ['เก็บเงินปลายทาง'], reply_text: 'มีเก็บเงินปลายทางค่ะ' });
    fakeMeta(() => okResponse('mid-out-5'));

    const msg = await addInbound('มีเก็บเงินปลายทางไหมคะ');
    const result = await runAutoReply(input(msg, 'มีเก็บเงินปลายทางไหมคะ'));

    expect(result.kind).toBe('sent');
    const exec = await pool.query('select matched_keyword from auto_reply_executions where message_id = $1', [msg]);
    expect(exec.rows[0].matched_keyword).toBe('เก็บเงินปลายทาง');
  });

  /* ================================================================ */
  /* J — แก้กฎระหว่างทาง                                                */
  /* ================================================================ */

  it('⭐ J) แก้กฎหลังตอบไปแล้ว → ประวัติยังบอกได้ว่าตอนนั้นส่งอะไรไป', async () => {
    const ruleId = await addRule({ reply_text: 'ข้อความเดิม' });
    fakeMeta(() => okResponse('mid-out-6'));

    const msg = await addInbound('ราคาเท่าไหร่');
    await runAutoReply(input(msg, 'ราคาเท่าไหร่'));

    // แอดมินมาแก้กฎทีหลัง
    await pool.query(
      `update keyword_rules set reply_text = 'ข้อความใหม่', version = version + 1 where id = $1`,
      [ruleId],
    );

    // 🔴 สำเนาที่จดไว้ต้องเป็นของเดิม ไม่เปลี่ยนตามกฎที่แก้
    const exec = await pool.query(
      'select rule_snapshot, rule_version from auto_reply_executions where message_id = $1',
      [msg],
    );
    expect(exec.rows[0].rule_snapshot.reply_text).toBe('ข้อความเดิม');
    expect(exec.rows[0].rule_version).toBe(1);

    const rule = await pool.query('select reply_text, version from keyword_rules where id = $1', [ruleId]);
    expect(rule.rows[0].reply_text).toBe('ข้อความใหม่');
    expect(rule.rows[0].version).toBe(2);
  });

  it('ปิดกฎหลังจากตอบไปแล้ว → ประวัติเดิมยังอยู่ครบ', async () => {
    const ruleId = await addRule();
    fakeMeta(() => okResponse('mid-out-7'));
    const msg = await addInbound('ราคาเท่าไหร่');
    await runAutoReply(input(msg, 'ราคาเท่าไหร่'));

    await pool.query('update keyword_rules set archived_at = now(), is_active = false where id = $1', [ruleId]);

    const exec = await pool.query(
      'select rule_id, status, rule_snapshot from auto_reply_executions where message_id = $1',
      [msg],
    );
    expect(exec.rows[0].rule_id).toBe(ruleId);
    expect(exec.rows[0].status).toBe('sent');
    expect(exec.rows[0].rule_snapshot.reply_text).toBeTruthy();
  });

  /* ================================================================ */
  /* L — ข้อมูลพัง                                                     */
  /* ================================================================ */

  it('⭐ L) ข้อความว่าง / null → ไม่ตอบ และไม่ทำให้ระบบล้ม', async () => {
    await addRule();
    const meta = fakeMeta(() => okResponse('ไม่ควรถูกเรียก'));

    const a = await addInbound(null);
    expect((await runAutoReply(input(a, null))).kind).toBe('no_rule');

    const b = await addInbound('   ');
    expect((await runAutoReply(input(b, '   '))).kind).toBe('no_rule');

    expect(meta.calls).toBe(0);
  });

  it('L2) ลูกค้าส่งมาแต่รูป (ไม่มีข้อความ) → ไม่ตอบอัตโนมัติ', async () => {
    await addRule();
    const meta = fakeMeta(() => okResponse('ไม่ควรถูกเรียก'));
    const msg = await addInbound(null);
    await pool.query(
      `update messages set attachments = '[{"type":"image","url":"https://x/y.jpg"}]'::jsonb where id = $1`,
      [msg],
    );
    expect((await runAutoReply(input(msg, null))).kind).toBe('no_rule');
    expect(meta.calls).toBe(0);
  });

  it('L3) ข้อความยาวมาก → ยังทำงานได้ ไม่ค้าง', async () => {
    await addRule();
    fakeMeta(() => okResponse('mid-out-8'));
    const huge = 'ก'.repeat(50_000) + 'ราคา';
    const msg = await addInbound(huge.slice(0, 1000));

    const started = Date.now();
    const result = await runAutoReply(input(msg, huge));
    expect(result.kind).toBe('sent');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('L4) Meta ปฏิเสธแบบรู้ผลชัดเจน → จดว่าล้มเหลว ไม่ใช่ไม่ทราบผล', async () => {
    await addRule();
    fakeMeta(
      () =>
        new Response(JSON.stringify({ error: { message: 'Invalid recipient', code: 100 } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const msg = await addInbound('ราคาเท่าไหร่');
    const result = await runAutoReply(input(msg, 'ราคาเท่าไหร่'));

    // ไม่ใช่ unknown — รู้ผลชัดว่าไม่ถึงลูกค้า
    expect(result.kind).not.toBe('unknown');
    expect(result.kind).not.toBe('sent');

    const exec = await pool.query('select status from auto_reply_executions where message_id = $1', [msg]);
    expect(['blocked', 'failed']).toContain(exec.rows[0].status);
  });

  /* ================================================================ */
  /* นับจำนวนครั้งที่กฎทำงาน                                             */
  /* ================================================================ */

  it('ตอบสำเร็จแล้วต้องบวกตัวนับของกฎ (ให้ฐานข้อมูลบวกเอง)', async () => {
    const ruleId = await addRule();
    fakeMeta((n) => okResponse(`mid-out-${n}`));

    for (let i = 0; i < 3; i += 1) {
      const msg = await addInbound(`ราคา ${i}`);
      await runAutoReply(input(msg, `ราคา ${i}`));
    }

    const rule = await pool.query('select hit_count from keyword_rules where id = $1', [ruleId]);
    expect(rule.rows[0].hit_count).toBe(3);
  });

  it('ตอนที่ถูกบล็อก ต้องไม่บวกตัวนับ', async () => {
    const ruleId = await addRule();
    await pool.query('update conversations set last_customer_message_at = $2 where id = $1', [
      ids.conversation, STALE.toISOString(),
    ]);
    await pool.query('update customers set last_customer_message_at = $2 where id = $1', [
      ids.customer, STALE.toISOString(),
    ]);

    const msg = await addInbound('ราคาเท่าไหร่');
    await runAutoReply(input(msg, 'ราคาเท่าไหร่'));

    const rule = await pool.query('select hit_count from keyword_rules where id = $1', [ruleId]);
    expect(rule.rows[0].hit_count).toBe(0);
  });
});
