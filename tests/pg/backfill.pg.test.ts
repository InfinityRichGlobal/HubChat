/**
 * ชุดทดสอบการดึงแชทเก่าจาก Meta เข้าระบบ กับ PostgreSQL จริง (รอบ 7)
 * ===========================================================================
 * 🔴 เรื่องที่เจ้าของร้านเจอ : เปิดระบบมาแล้วเห็นแต่แชททดสอบ
 *    เพราะ webhook ส่งให้เฉพาะข้อความที่เกิด "หลังจาก" เชื่อมเพจเท่านั้น
 *    ชุดนี้พิสูจน์ว่าการดึงย้อนหลังทำงานจริง และปลอดภัยพอที่จะกดซ้ำได้
 *
 * พิสูจน์ว่า :
 *   1. ⭐ ดึงมาแล้วได้ทั้งข้อความลูกค้าและข้อความที่เพจเคยตอบ แยกทิศทางถูก
 *   2. ⭐ กดซ้ำแล้วไม่เกิดข้อความซ้ำ (idempotent ด้วย meta_message_id)
 *   3. เรียงเก่า→ใหม่ก่อนบันทึก ตัวอย่างข้อความล่าสุดจึงไม่เพี้ยน
 *   4. ⭐ ห้องที่ Meta บอกว่าอ่านหมดแล้ว ต้องไม่เด้งเป็น "ยังไม่ตอบ"
 *   5. ⭐ สิทธิ์ไม่พอ → คืนคำอธิบายที่ทำตามได้ ไม่ใช่ "ทำรายการไม่สำเร็จ"
 *   6. ไล่หน้าต่อไปด้วย cursor ได้ และหยุดเองเมื่อไม่มี paging.next
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

const { backfillPageConversations, syncPageConversations } = await import('@/server/ingest/backfill');
const { __setFetcherForTests } = await import('@/server/meta/client');
const { encryptSecret } = await import('@/lib/crypto');

let pool: Pool;
let rest: RestServer;

const ids = { page: randomUUID() };
const PAGE_META_ID = '102938475610293';
const PSID = '7239084751029384';

/** เพจตามรูปแบบที่ชั้น Meta ต้องการ (token เข้ารหัสไว้เหมือนของจริง) */
function metaPage() {
  return {
    id: ids.page,
    platform: 'facebook' as const,
    page_id: PAGE_META_ID,
    access_token: encryptSecret('TOKEN-ปลอม'),
  };
}

type Reply = { status: number; body: unknown };

/** สวม fetch ปลอม แล้วเก็บ URL ที่ถูกเรียกไว้ตรวจ */
function fakeMeta(replies: Reply[]): { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  __setFetcherForTests((async (input: RequestInfo | URL) => {
    calls.push(typeof input === 'string' ? input : String(input));
    const reply = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch);
  return { calls };
}

function conversationBody(
  messages: Array<{ id: string; from: string; text: string; at: string }>,
  opts: { unread?: number; next?: boolean; after?: string } = {},
) {
  return {
    data: [
      {
        id: 't_1',
        updated_time: '2026-01-01T00:00:00+0000',
        unread_count: opts.unread ?? 1,
        participants: { data: [{ id: PAGE_META_ID, name: 'เพจ' }, { id: PSID, name: 'คุณลูกค้า' }] },
        messages: {
          data: messages.map((m) => ({
            id: m.id,
            created_time: m.at,
            from: { id: m.from },
            message: m.text,
          })),
        },
      },
    ],
    paging: opts.next
      ? { cursors: { after: opts.after ?? 'CURSOR_2' }, next: 'https://graph.facebook.com/next' }
      : { cursors: { after: 'CURSOR_LAST' } },
  };
}

/* ================================================================== */
describe.skipIf(!available)('PostgreSQL จริง — ดึงแชทเก่าจาก Meta', () => {
  beforeAll(async () => {
    await resetDatabase();
    pool = testPool();
    rest = await startRestServer(pool);
  }, 120_000);

  afterAll(async () => {
    __setFetcherForTests(null);
    await rest?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    __setFetcherForTests(null);
    await pool.query('delete from messages');
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');

    await pool.query(
      `insert into pages (id, platform, page_id, page_name, access_token)
       values ($1,'facebook',$2,'เพจทดสอบ',$3)`,
      [ids.page, PAGE_META_ID, encryptSecret('TOKEN-ปลอม')],
    );
  });

  /* -------------------------------------------------------------- */
  it('⭐ ดึงแชทเก่าเข้ามาได้ แยกข้อความลูกค้ากับข้อความเพจถูกทิศทาง', async () => {
    const { calls } = fakeMeta([
      {
        status: 200,
        body: conversationBody([
          // ⚠️ Meta คืนใหม่ก่อน — ตัวดึงต้องเรียงเองก่อนบันทึก
          { id: 'm_3', from: PAGE_META_ID, text: 'ส่งฟรีค่ะ', at: '2026-01-01T03:00:00+0000' },
          { id: 'm_2', from: PSID, text: 'ส่งฟรีไหมคะ', at: '2026-01-01T02:00:00+0000' },
          { id: 'm_1', from: PSID, text: 'สวัสดีค่ะ', at: '2026-01-01T01:00:00+0000' },
        ]),
      },
    ]);

    const summary = await backfillPageConversations(metaPage());

    /**
     * 🔴 ข้อนี้เคยพลาดจริง : ตัวยิงเข้ารหัส path ทั้งเส้นด้วย encodeURIComponent
     *    ทำให้ '<page>/conversations' กลายเป็น '<page>%2Fconversations'
     *    Meta ตอบ error 100 กลับมา แล้วระบบไปแปลว่า "สิทธิ์ไม่พอ"
     *    เจ้าของร้านจะไล่สร้าง token ใหม่ไม่จบ ทั้งที่ token ไม่ได้ผิดเลย
     */
    expect(calls[0]).toContain(`/${PAGE_META_ID}/conversations?`);
    expect(calls[0]).not.toContain('%2F');

    expect(summary.error_th).toBeNull();
    expect(summary.conversations_seen).toBe(1);
    expect(summary.messages_saved).toBe(3);
    expect(summary.has_more).toBe(false);

    const rows = await pool.query(
      `select text, direction, sender_type, meta_message_id
         from messages order by created_at asc`,
    );
    expect(rows.rows.map((r) => r.text)).toEqual(['สวัสดีค่ะ', 'ส่งฟรีไหมคะ', 'ส่งฟรีค่ะ']);
    expect(rows.rows.map((r) => r.direction)).toEqual(['in', 'in', 'out']);

    // ⭐ ตัวอย่างข้อความล่าสุดต้องเป็นข้อความ "ใหม่ที่สุด" ไม่ใช่ตัวที่บันทึกท้ายสุด
    const conv = await pool.query('select last_message_preview from conversations');
    expect(conv.rows[0].last_message_preview).toBe('ส่งฟรีค่ะ');
  });

  /* -------------------------------------------------------------- */
  it('⭐ กดซ้ำแล้วต้องไม่เกิดข้อความซ้ำ (กดกี่ครั้งก็ปลอดภัย)', async () => {
    const body = conversationBody([
      { id: 'm_1', from: PSID, text: 'สวัสดีค่ะ', at: '2026-01-01T01:00:00+0000' },
      { id: 'm_2', from: PAGE_META_ID, text: 'สวัสดีครับ', at: '2026-01-01T02:00:00+0000' },
    ]);

    fakeMeta([{ status: 200, body }]);
    const first = await backfillPageConversations(metaPage());
    expect(first.messages_saved).toBe(2);

    fakeMeta([{ status: 200, body }]);
    const second = await backfillPageConversations(metaPage());
    expect(second.messages_saved).toBe(0);
    expect(second.duplicates).toBe(2);

    const count = await pool.query('select count(*)::int as n from messages');
    expect(count.rows[0].n).toBe(2);
  });

  /* -------------------------------------------------------------- */
  it('⭐ ห้องที่ Meta บอกว่าอ่านหมดแล้ว ต้องไม่เด้งเป็น "ยังไม่ตอบ"', async () => {
    fakeMeta([
      {
        status: 200,
        body: conversationBody(
          [{ id: 'm_1', from: PSID, text: 'ตอบไปแล้วใน Business Suite', at: '2026-01-01T01:00:00+0000' }],
          { unread: 0 },
        ),
      },
    ]);

    await backfillPageConversations(metaPage());

    const conv = await pool.query('select is_read from conversations');
    expect(conv.rows[0].is_read).toBe(true);
  });

  /* -------------------------------------------------------------- */
  it('ห้องที่ยังค้างตอบ ต้องยังเป็น "ยังไม่ตอบ" ตามเดิม', async () => {
    fakeMeta([
      {
        status: 200,
        body: conversationBody(
          [{ id: 'm_1', from: PSID, text: 'ยังไม่มีใครตอบ', at: '2026-01-01T01:00:00+0000' }],
          { unread: 3 },
        ),
      },
    ]);

    await backfillPageConversations(metaPage());
    const conv = await pool.query('select is_read from conversations');
    expect(conv.rows[0].is_read).toBe(false);
  });

  /* -------------------------------------------------------------- */
  it('🔴 ลูกค้าทักเข้ามาใหม่ระหว่างซิงก์ ต้องไม่ถูกกลบเป็น "อ่านแล้ว"', async () => {
    /**
     * unread_count ที่ Meta ส่งมาเป็นภาพ ณ วินาทีที่ตอบกลับ
     * การซิงก์หนึ่งครั้งกินเวลาเป็นนาที ระหว่างนั้น webhook อาจเพิ่งบันทึกข้อความใหม่
     * ถ้าเผลอทับเป็นอ่านแล้ว จะไม่มีใครรู้ว่ามีลูกค้าทักมา — เสียลูกค้าจริง ๆ
     */
    // แชทเก่าถูกดึงเข้ามาแล้วรอบหนึ่ง
    fakeMeta([
      {
        status: 200,
        body: conversationBody(
          [{ id: 'm_old', from: PSID, text: 'ของเก่า', at: '2026-01-01T01:00:00+0000' }],
          { unread: 0 },
        ),
      },
    ]);
    await backfillPageConversations(metaPage());
    expect((await pool.query('select is_read from conversations')).rows[0].is_read).toBe(true);

    // จำลองว่าลูกค้าทักเข้ามาใหม่ "หลัง" จากที่ Meta ตอบภาพ unread_count = 0 มาแล้ว
    await pool.query(
      `update conversations set last_message_at = now(), is_read = false`,
    );

    // ซิงก์รอบถัดไปยังได้ภาพเดิม (unread_count = 0) กลับมา
    fakeMeta([
      {
        status: 200,
        body: conversationBody(
          [{ id: 'm_old', from: PSID, text: 'ของเก่า', at: '2026-01-01T01:00:00+0000' }],
          { unread: 0 },
        ),
      },
    ]);
    await backfillPageConversations(metaPage());

    const after = await pool.query('select is_read from conversations');
    expect(after.rows[0].is_read).toBe(false);
  });

  /* -------------------------------------------------------------- */
  it('⭐ สิทธิ์ไม่พอ → บอกให้ไปแก้ตรงไหน ไม่ใช่ "ทำรายการไม่สำเร็จ"', async () => {
    fakeMeta([
      {
        status: 403,
        body: { error: { code: 200, message: 'Permissions error', type: 'OAuthException' } },
      },
    ]);

    const summary = await backfillPageConversations(metaPage());
    expect(summary.error_th).toContain('pages_messaging');
    expect(summary.messages_saved).toBe(0);
  });

  /* -------------------------------------------------------------- */
  it('token หมดอายุ → บอกให้สร้าง token ใหม่', async () => {
    fakeMeta([
      { status: 401, body: { error: { code: 190, message: 'Invalid OAuth token', type: 'OAuthException' } } },
    ]);

    const summary = await backfillPageConversations(metaPage());
    expect(summary.error_th).toContain('token');
  });

  /* -------------------------------------------------------------- */
  it('⭐ มีหน้าต่อไป → ไล่ต่อด้วย cursor แล้วหยุดเองเมื่อ Meta ไม่ส่ง next มา', async () => {
    const { calls } = fakeMeta([
      {
        status: 200,
        body: conversationBody(
          [{ id: 'm_1', from: PSID, text: 'หน้าแรก', at: '2026-01-01T01:00:00+0000' }],
          { next: true, after: 'CURSOR_2' },
        ),
      },
      {
        status: 200,
        body: conversationBody([
          { id: 'm_2', from: PSID, text: 'หน้าที่สอง', at: '2026-01-02T01:00:00+0000' },
        ]),
      },
    ]);

    const summary = await backfillPageConversations(metaPage());

    expect(summary.pages_fetched).toBe(2);
    expect(summary.messages_saved).toBe(2);
    expect(summary.has_more).toBe(false);
    // หน้าที่สองต้องส่ง cursor ที่ได้จากหน้าแรกไปด้วย
    expect(calls[1]).toContain('after=CURSOR_2');
  });

  /* -------------------------------------------------------------- */
  it('ไม่พบเพจ → บอกตรง ๆ ไม่ใช่ระเบิดกลางทาง', async () => {
    const outcome = await syncPageConversations(randomUUID());
    expect(outcome.kind).toBe('not_found');
  });

  /* -------------------------------------------------------------- */
  it('⭐ เพจที่ยังไม่ได้ใส่ token → บอกให้ไปเชื่อมเพจก่อน ไม่ใช่ error ดิบ', async () => {
    const noTokenPage = randomUUID();
    await pool.query(
      `insert into pages (id, platform, page_id, page_name, access_token)
       values ($1,'facebook','999','เพจยังไม่เชื่อม',null)`,
      [noTokenPage],
    );

    const outcome = await syncPageConversations(noTokenPage);
    expect(outcome.kind).toBe('not_configured');
  });
});
