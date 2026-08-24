/**
 * ชุดทดสอบทางเข้าข้อมูลกับ PostgreSQL จริง (รอบ 3A)
 * ===========================================================================
 * ชุดนี้พิสูจน์เรื่องที่ฐานข้อมูลปลอมพิสูจน์ไม่ได้ :
 *
 *   1. Meta ยิง webhook ก้อนเดิมซ้ำ → ต้องได้ข้อความเดียว ไม่ใช่สองแถว
 *   2. webhook ซ้ำต้องไม่ทำให้ห้องแชทที่อ่านแล้วกลับมาเป็น "ยังไม่อ่าน"
 *   3. worker หลายตัวหยิบคิวพร้อมกัน → งานหนึ่งชิ้นถูกทำครั้งเดียว
 *   4. ข้อความจาก Messenger กับ Instagram แยกกันคนละลูกค้า
 *   5. echo จาก Business Suite เข้ามาเป็นข้อความขาออก และไม่แตะประวัติฝั่งลูกค้า
 *   6. เพจที่ยังไม่ได้เชื่อม → ข้ามอย่างปลอดภัย ไม่ทำให้คิวค้าง
 *
 * รัน : npm run test:pg     (ถ้าไม่มี Postgres จะข้ามให้เอง)
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

const { enqueueWebhook } = await import('@/server/ingest/queue');
const { processWebhookBatch, drainWebhookQueue } = await import('@/server/ingest/processor');

let pool: Pool;
let rest: RestServer;

const FB_PAGE_META_ID = '102938475610293';
const IG_PAGE_META_ID = '178414000000000';
const PSID = '7239084751029384';
const T = Date.now() - 10 * 60 * 1000;

const ids = { fbPage: randomUUID(), igPage: randomUUID() };

/* ---------------------------------------------------------------- */
/* payload ตัวอย่าง — หน้าตาเหมือนของจริงจาก Meta                      */
/* ---------------------------------------------------------------- */

function inbound(mid: string, text: string, at = T, pageMetaId = FB_PAGE_META_ID, object = 'page') {
  return {
    object,
    entry: [
      {
        id: pageMetaId,
        time: at,
        messaging: [
          {
            sender: { id: PSID },
            recipient: { id: pageMetaId },
            timestamp: at,
            message: { mid, text },
          },
        ],
      },
    ],
  };
}

function echo(mid: string, text: string, at = T) {
  return {
    object: 'page',
    entry: [
      {
        id: FB_PAGE_META_ID,
        time: at,
        messaging: [
          {
            sender: { id: FB_PAGE_META_ID },
            recipient: { id: PSID },
            timestamp: at,
            message: { mid, text, is_echo: true, app_id: 123456 },
          },
        ],
      },
    ],
  };
}

async function count(table: string, where = ''): Promise<number> {
  const r = await pool.query(`select count(*)::int as n from ${table} ${where}`);
  return r.rows[0].n as number;
}

/* ================================================================== */
describe.skipIf(!available)('PostgreSQL จริง — ทางเข้าข้อมูลจาก webhook', () => {
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
    await pool.query('truncate webhook_queue');
    await pool.query('delete from messages');
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');

    await pool.query(
      `insert into pages (id, platform, page_id, page_name, access_token)
       values ($1,'facebook',$2,'เพจทดสอบ', null), ($3,'instagram',$4,'ไอจีทดสอบ', null)`,
      [ids.fbPage, FB_PAGE_META_ID, ids.igPage, IG_PAGE_META_ID],
    );
  });

  /* -------------------------------------------------------------- */
  it('ข้อความแรกเข้ามา → สร้างลูกค้า ห้องแชท และข้อความครบ', async () => {
    await enqueueWebhook(inbound('mid.001', 'สนใจโปร 2 ชิ้นค่ะ'));
    const summary = await processWebhookBatch();

    expect(summary.jobs).toBe(1);
    expect(summary.inbound_saved).toBe(1);
    expect(summary.failed_jobs).toBe(0);

    expect(await count('customers')).toBe(1);
    expect(await count('conversations')).toBe(1);
    expect(await count('messages')).toBe(1);

    const conv = await pool.query('select * from conversations limit 1');
    expect(conv.rows[0].last_message_preview).toBe('สนใจโปร 2 ชิ้นค่ะ');
    expect(conv.rows[0].is_read).toBe(false);
    expect(conv.rows[0].last_customer_message_at).not.toBeNull();

    const job = await pool.query('select status from webhook_queue');
    expect(job.rows[0].status).toBe('done');
  });

  /* -------------------------------------------------------------- */
  it('⭐ Meta ยิงก้อนเดิมซ้ำ 5 ครั้ง → ได้ข้อความเดียว', async () => {
    const payload = inbound('mid.dup', 'ข้อความเดียวกัน');
    for (let i = 0; i < 5; i += 1) await enqueueWebhook(payload);

    const summary = await drainWebhookQueue();

    expect(summary.jobs).toBe(5);
    expect(summary.inbound_saved).toBe(1);
    expect(summary.duplicates).toBe(4);
    expect(await count('messages')).toBe(1);
    expect(await count('customers')).toBe(1);
    expect(await count('conversations')).toBe(1);
  });

  /* -------------------------------------------------------------- */
  it('⭐ webhook ซ้ำ ต้องไม่ทำให้ห้องแชทที่อ่านแล้วกลับมาเป็นยังไม่อ่าน', async () => {
    const payload = inbound('mid.read', 'ทักมาครั้งเดียว');
    await enqueueWebhook(payload);
    await drainWebhookQueue();

    // แอดมินเปิดอ่านแล้ว
    await pool.query('update conversations set is_read = true');

    // Meta ยิงซ้ำ (เกิดขึ้นจริงเมื่อเราตอบช้า)
    await enqueueWebhook(payload);
    const summary = await drainWebhookQueue();

    expect(summary.duplicates).toBe(1);
    const conv = await pool.query('select is_read from conversations');
    expect(conv.rows[0].is_read).toBe(true);
  });

  /* -------------------------------------------------------------- */
  it('⭐ worker หลายตัวหยิบคิวพร้อมกัน → งานหนึ่งชิ้นถูกทำครั้งเดียว', async () => {
    for (let i = 0; i < 10; i += 1) {
      await enqueueWebhook(inbound(`mid.par.${i}`, `ข้อความที่ ${i}`, T + i * 1000));
    }

    // จำลอง worker 4 ตัวแย่งกันหยิบพร้อมกัน
    const results = await Promise.all([
      processWebhookBatch(10),
      processWebhookBatch(10),
      processWebhookBatch(10),
      processWebhookBatch(10),
    ]);

    const totalJobs = results.reduce((s, r) => s + r.jobs, 0);
    const totalSaved = results.reduce((s, r) => s + r.inbound_saved, 0);

    expect(totalJobs).toBe(10); // ไม่มีงานไหนถูกหยิบซ้ำ
    expect(totalSaved).toBe(10);
    expect(await count('messages')).toBe(10);
    expect(await count('webhook_queue', "where status = 'done'")).toBe(10);
  });

  /* -------------------------------------------------------------- */
  it('Messenger กับ Instagram เป็นคนละลูกค้า แม้ id จะบังเอิญเหมือนกัน', async () => {
    await enqueueWebhook(inbound('mid.fb', 'ทักจาก Facebook'));
    await enqueueWebhook(inbound('mid.ig', 'ทักจาก Instagram', T, IG_PAGE_META_ID, 'instagram'));
    await drainWebhookQueue();

    expect(await count('customers')).toBe(2);
    expect(await count('conversations')).toBe(2);

    const platforms = await pool.query('select platform::text from customers order by platform');
    expect(platforms.rows.map((r) => r.platform)).toEqual(['facebook', 'instagram']);
  });

  /* -------------------------------------------------------------- */
  it('⭐ echo จาก Business Suite เข้ามาเป็นข้อความขาออก และไม่แตะประวัติฝั่งลูกค้า', async () => {
    await enqueueWebhook(inbound('mid.in', 'ลูกค้าทักมา', T));
    await drainWebhookQueue();

    const before = await pool.query('select last_customer_message_at from customers');
    const lastCustomerAt = before.rows[0].last_customer_message_at;

    await enqueueWebhook(echo('mid.out', 'แอดมินตอบจาก Business Suite', T + 60_000));
    const summary = await drainWebhookQueue();

    expect(summary.echo_saved).toBe(1);

    const msgs = await pool.query('select direction::text, sender_type::text from messages order by created_at');
    expect(msgs.rows.map((r) => `${r.direction}/${r.sender_type}`)).toEqual(['in/customer', 'out/admin']);

    const after = await pool.query('select last_customer_message_at, last_admin_message_at from customers');
    // ⭐ ประวัติจริงที่ Policy Engine ใช้ ต้องไม่ถูกขยับโดยข้อความขาออก
    expect(after.rows[0].last_customer_message_at).toEqual(lastCustomerAt);
    expect(after.rows[0].last_admin_message_at).not.toBeNull();
  });

  /* -------------------------------------------------------------- */
  it('echo ที่มาซ้ำ ต้องไม่กลายเป็นสองแถว', async () => {
    const payload = echo('mid.echo.dup', 'ตอบไปแล้ว');
    await enqueueWebhook(payload);
    await enqueueWebhook(payload);
    const summary = await drainWebhookQueue();

    expect(summary.echo_saved).toBe(1);
    expect(summary.duplicates).toBe(1);
    expect(await count('messages')).toBe(1);
  });

  /* -------------------------------------------------------------- */
  it('เพจที่ยังไม่ได้เชื่อม → ข้ามอย่างปลอดภัย งานไม่ค้างในคิว', async () => {
    await enqueueWebhook(inbound('mid.unknown', 'ทักมาจากเพจแปลก', T, '999999999999'));
    const summary = await drainWebhookQueue();

    expect(summary.unknown_page).toBe(1);
    expect(summary.inbound_saved).toBe(0);
    expect(summary.failed_jobs).toBe(0);
    expect(await count('messages')).toBe(0);
    expect(await count('webhook_queue', "where status = 'done'")).toBe(1);
  });

  /* -------------------------------------------------------------- */
  it('เพจที่ถูกปิดใช้งาน → ไม่รับข้อความเข้า', async () => {
    await pool.query('update pages set is_active = false');
    await enqueueWebhook(inbound('mid.inactive', 'ทักมาตอนปิดเพจ'));
    const summary = await drainWebhookQueue();

    expect(summary.inbound_saved).toBe(0);
    expect(summary.ignored).toBe(1);
    expect(await count('messages')).toBe(0);
  });

  /* -------------------------------------------------------------- */
  it('payload ที่ไม่รู้จัก → ข้ามเงียบ ๆ ไม่ทำให้คิวพัง', async () => {
    await enqueueWebhook({ object: 'whatsapp_business_account', entry: [] });
    await enqueueWebhook({ ไม่รู้จัก: true });
    const summary = await drainWebhookQueue();

    expect(summary.failed_jobs).toBe(0);
    expect(summary.ignored).toBe(2);
    expect(await count('webhook_queue', "where status = 'failed'")).toBe(0);
  });

  /* -------------------------------------------------------------- */
  it('ที่มาจากแอดถูกบันทึก และไม่ถูกลบทิ้งเมื่อลูกค้าทักมาอีกโดยไม่มีที่มา', async () => {
    await enqueueWebhook({
      object: 'page',
      entry: [
        {
          id: FB_PAGE_META_ID,
          time: T,
          messaging: [
            {
              sender: { id: PSID },
              recipient: { id: FB_PAGE_META_ID },
              timestamp: T,
              message: {
                mid: 'mid.ad',
                text: 'สนใจค่ะ',
                referral: { source: 'ADS', ad_id: '120210000000', ref: 'lip9-aug' },
              },
            },
          ],
        },
      ],
    });
    await drainWebhookQueue();

    let conv = await pool.query('select referral_source::text, referral_ad_id, referral_ref from conversations');
    expect(conv.rows[0]).toMatchObject({
      referral_source: 'ADS',
      referral_ad_id: '120210000000',
      referral_ref: 'lip9-aug',
    });

    // ทักมาอีกทีแบบไม่มีข้อมูลที่มา — ของเดิมต้องอยู่ครบ
    await enqueueWebhook(inbound('mid.ad2', 'ยังสนใจอยู่ค่ะ', T + 120_000));
    await drainWebhookQueue();

    conv = await pool.query('select referral_source::text, referral_ad_id from conversations');
    expect(conv.rows[0].referral_source).toBe('ADS');
    expect(conv.rows[0].referral_ad_id).toBe('120210000000');
  });

  /* -------------------------------------------------------------- */
  it('ข้อความเก่าที่มาถึงช้า ต้องไม่ทับตัวอย่างข้อความล่าสุด', async () => {
    await enqueueWebhook(inbound('mid.new', 'ข้อความล่าสุด', T + 600_000));
    await drainWebhookQueue();
    await enqueueWebhook(inbound('mid.old', 'ข้อความเก่ามาช้า', T));
    await drainWebhookQueue();

    const conv = await pool.query('select last_message_preview from conversations');
    expect(conv.rows[0].last_message_preview).toBe('ข้อความล่าสุด');
    expect(await count('messages')).toBe(2);
  });

  /* -------------------------------------------------------------- */
  it('รูปภาพถูกเก็บไว้ในช่องไฟล์แนบ และตัวอย่างข้อความบอกว่ามีไฟล์', async () => {
    await enqueueWebhook({
      object: 'page',
      entry: [
        {
          id: FB_PAGE_META_ID,
          time: T,
          messaging: [
            {
              sender: { id: PSID },
              recipient: { id: FB_PAGE_META_ID },
              timestamp: T,
              message: {
                mid: 'mid.slip',
                attachments: [{ type: 'image', payload: { url: 'https://example.test/slip.jpg' } }],
              },
            },
          ],
        },
      ],
    });
    await drainWebhookQueue();

    const msg = await pool.query('select text, attachments from messages');
    expect(msg.rows[0].text).toBeNull();
    expect(msg.rows[0].attachments).toEqual([{ type: 'image', url: 'https://example.test/slip.jpg' }]);

    const conv = await pool.query('select last_message_preview from conversations');
    expect(conv.rows[0].last_message_preview).toBe('[ไฟล์แนบ]');
  });
});
