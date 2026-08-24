/**
 * ชุดทดสอบการเก็บสื่อถาวรกับ PostgreSQL จริง (D-17)
 * ===========================================================================
 * พิสูจน์ว่า :
 *   1. ⭐ webhook ซ้ำ / worker พร้อมกัน → โหลดไฟล์ครั้งเดียว
 *   2. เก็บสำเร็จแล้ว attachments ของข้อความชี้มาที่ไฟล์ของเรา
 *   3. ⭐ ลิงก์หมดอายุ → จดเป็น 'expired' (กู้ไม่ได้) แยกจาก 'failed' (ลองใหม่ได้)
 *   4. ยังไม่ตั้งค่า R2 → ข้ามอย่างสุภาพ ไม่พัง และจดไว้ว่าข้าม
 *   5. ข้อความเดียวแนบหลายไฟล์ → เก็บครบทุกไฟล์ ไม่ทับกัน
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

// ⭐ ตั้งค่า R2 ปลอมไว้ เพื่อให้ isStorageConfigured() เป็น true
//    ส่วนการยิงจริงถูกสวมด้วย fetch ปลอม จึงไม่ได้ต่อเน็ตออกไปไหน
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_BUCKET = 'test-bucket';

const { captureInboundMedia } = await import('@/server/storage/media');
const { __setStorageFetcherForTests } = await import('@/server/storage/r2');

let pool: Pool;
let rest: RestServer;

const ids = {
  page: randomUUID(),
  customer: randomUUID(),
  conversation: randomUUID(),
};

describe.skipIf(!available)('PostgreSQL จริง — เก็บสื่อถาวร (D-17)', () => {
  beforeAll(async () => {
    await resetDatabase();
    pool = testPool();
    rest = await startRestServer(pool);
  }, 120_000);

  afterAll(async () => {
    await rest?.close();
    await pool?.end();
    __setStorageFetcherForTests(null);
  });

  beforeEach(async () => {
    __setStorageFetcherForTests(null);
    await pool.query('truncate media_assets cascade');
    await pool.query('delete from messages');
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');

    await pool.query(
      `insert into pages (id, platform, page_id, page_name) values ($1,'facebook','1001','เพจ A')`,
      [ids.page],
    );
    await pool.query(
      `insert into customers (id, page_id, psid, platform) values ($1,$2,'PSID_A','facebook')`,
      [ids.customer, ids.page],
    );
    await pool.query(
      `insert into conversations (id, customer_id, page_id, last_message_at) values ($1,$2,$3, now())`,
      [ids.conversation, ids.customer, ids.page],
    );
  });

  /* ---------------- ตัวช่วย ---------------- */

  /**
   * โลกภายนอกปลอม : นับจำนวนครั้งที่ถูกยิงจริง แยกเป็นดาวน์โหลด/อัปโหลด
   *
   * ⚠️ ต้องอ่าน url จาก Request object ให้ถูก
   *    ชั้น R2 เซ็นคำขอแล้วส่ง Request เข้ามา ไม่ใช่สตริง
   *    ถ้าใช้ String(input) จะได้ '[object Request]' แล้วแยกไม่ออกว่าอันไหนอัปโหลด
   *    (เคยเขียนผิดแบบนั้นแล้วเทสต์ผ่านทั้งที่การอัปโหลดล้มเหลว)
   */
  function fakeWorld(opts: { downloadStatus?: number; uploadStatus?: number } = {}) {
    const state = { downloads: 0, uploads: 0 };
    __setStorageFetcherForTests((async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input
        : input instanceof URL ? input.href
        : (input as Request).url;
      if (url.includes('r2.cloudflarestorage.com')) {
        state.uploads += 1;
        return new Response('', { status: opts.uploadStatus ?? 200 });
      }
      state.downloads += 1;
      const status = opts.downloadStatus ?? 200;
      if (status !== 200) return new Response('gone', { status });
      return new Response(new TextEncoder().encode('เนื้อไฟล์ทดสอบ'), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }) as typeof fetch);
    return state;
  }

  async function addMessage(attachments: Array<{ type: string; url?: string }>): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `insert into messages (id, conversation_id, direction, sender_type, attachments, meta_message_id)
       values ($1,$2,'in','customer',$3::jsonb,$4)`,
      [id, ids.conversation, JSON.stringify(attachments), `mid-${id}`],
    );
    return id;
  }

  function input(messageId: string, attachments: Array<{ type: string; url?: string }>) {
    return {
      message_id: messageId,
      conversation_id: ids.conversation,
      page_id: ids.page,
      attachments,
    };
  }

  /* ================================================================ */

  it('⭐ เก็บไฟล์สำเร็จ → จดสถานะ stored พร้อมลายนิ้วมือ', async () => {
    const world = fakeWorld();
    const atts = [{ type: 'image', url: 'https://meta.example/x.jpg' }];
    const msg = await addMessage(atts);

    const result = await captureInboundMedia(input(msg, atts));
    expect(result.stored).toBe(1);
    expect(world.downloads).toBe(1);
    expect(world.uploads).toBe(1);

    const row = await pool.query('select * from media_assets where message_id = $1', [msg]);
    expect(row.rows[0].status).toBe('stored');
    expect(row.rows[0].storage_key).toMatch(/^inbound\/\d{4}\/\d{2}\/[0-9a-f]{64}\.jpg$/);
    expect(row.rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.rows[0].bytes).toBeGreaterThan(0);
  });

  it('⭐ เก็บสำเร็จแล้ว attachments ของข้อความต้องชี้มาที่ไฟล์ของเรา', async () => {
    fakeWorld();
    const atts = [{ type: 'image', url: 'https://meta.example/x.jpg' }];
    const msg = await addMessage(atts);
    await captureInboundMedia(input(msg, atts));

    const media = await pool.query('select id from media_assets where message_id = $1', [msg]);
    const message = await pool.query('select attachments from messages where id = $1', [msg]);

    // 🔴 ถ้าไม่ผูก หน้าแชทจะยังใช้ลิงก์ที่หมดอายุอยู่ดี
    expect(message.rows[0].attachments[0].media_id).toBe(media.rows[0].id);
    // ลิงก์เดิมยังอยู่ ไว้ไล่ปัญหาย้อนหลัง
    expect(message.rows[0].attachments[0].url).toBe('https://meta.example/x.jpg');
  });

  it('⭐ ประมวลผลซ้ำ → โหลดครั้งเดียวเท่านั้น', async () => {
    const world = fakeWorld();
    const atts = [{ type: 'image', url: 'https://meta.example/x.jpg' }];
    const msg = await addMessage(atts);

    await captureInboundMedia(input(msg, atts));
    await captureInboundMedia(input(msg, atts));
    await captureInboundMedia(input(msg, atts));

    expect(world.downloads).toBe(1);
    const count = await pool.query('select count(*)::int as n from media_assets where message_id = $1', [msg]);
    expect(count.rows[0].n).toBe(1);
  });

  it('⭐ worker หลายตัวพร้อมกัน → โหลดครั้งเดียว (ฐานข้อมูลเป็นคนกัน)', async () => {
    const world = fakeWorld();
    const atts = [{ type: 'image', url: 'https://meta.example/x.jpg' }];
    const msg = await addMessage(atts);

    await Promise.all([
      captureInboundMedia(input(msg, atts)),
      captureInboundMedia(input(msg, atts)),
      captureInboundMedia(input(msg, atts)),
      captureInboundMedia(input(msg, atts)),
    ]);

    expect(world.downloads).toBe(1);
    const count = await pool.query('select count(*)::int as n from media_assets where message_id = $1', [msg]);
    expect(count.rows[0].n).toBe(1);
  });

  it('⭐ ข้อความเดียวแนบหลายไฟล์ → เก็บครบทุกไฟล์ ไม่ทับกัน', async () => {
    const world = fakeWorld();
    const atts = [
      { type: 'image', url: 'https://meta.example/a.jpg' },
      { type: 'image', url: 'https://meta.example/b.jpg' },
      { type: 'file', url: 'https://meta.example/c.pdf' },
    ];
    const msg = await addMessage(atts);

    const result = await captureInboundMedia(input(msg, atts));
    expect(result.stored).toBe(3);
    expect(world.downloads).toBe(3);

    const rows = await pool.query(
      'select attachment_index from media_assets where message_id = $1 order by attachment_index',
      [msg],
    );
    expect(rows.rows.map((r) => r.attachment_index)).toEqual([0, 1, 2]);
  });

  it('⭐ ลิงก์หมดอายุ (410) → จดเป็น expired ไม่ใช่ failed', async () => {
    // 🔴 ต้องแยกให้ชัด : expired = กู้ไม่ได้แล้ว / failed = ลองใหม่ได้
    fakeWorld({ downloadStatus: 410 });
    const atts = [{ type: 'image', url: 'https://meta.example/gone.jpg' }];
    const msg = await addMessage(atts);

    const result = await captureInboundMedia(input(msg, atts));
    expect(result.failed).toBe(1);

    const row = await pool.query('select status, error_text from media_assets where message_id = $1', [msg]);
    expect(row.rows[0].status).toBe('expired');
    expect(row.rows[0].error_text).toBeTruthy();
  });

  it('ลิงก์ตอบ 403 (หมดสิทธิ์/หมดอายุ) ก็ถือว่า expired เช่นกัน', async () => {
    fakeWorld({ downloadStatus: 403 });
    const atts = [{ type: 'image', url: 'https://meta.example/x.jpg' }];
    const msg = await addMessage(atts);
    await captureInboundMedia(input(msg, atts));

    const row = await pool.query('select status from media_assets where message_id = $1', [msg]);
    expect(row.rows[0].status).toBe('expired');
  });

  it('เซิร์ฟเวอร์ต้นทางล่ม (500) → failed (ยังลองใหม่ได้ในอนาคต)', async () => {
    fakeWorld({ downloadStatus: 500 });
    const atts = [{ type: 'image', url: 'https://meta.example/x.jpg' }];
    const msg = await addMessage(atts);
    await captureInboundMedia(input(msg, atts));

    const row = await pool.query('select status from media_assets where message_id = $1', [msg]);
    expect(row.rows[0].status).toBe('failed');
  });

  it('อัปโหลดขึ้นถังไม่สำเร็จ → failed และไม่มี storage_key ค้าง', async () => {
    fakeWorld({ uploadStatus: 500 });
    const atts = [{ type: 'image', url: 'https://meta.example/x.jpg' }];
    const msg = await addMessage(atts);
    await captureInboundMedia(input(msg, atts));

    const row = await pool.query('select status, storage_key from media_assets where message_id = $1', [msg]);
    expect(row.rows[0].status).toBe('failed');
    expect(row.rows[0].storage_key).toBeNull();
  });

  it('ไฟล์แนบที่ไม่มีลิงก์ (สติกเกอร์) → ไม่ต้องเก็บ ไม่ยิงเน็ต', async () => {
    const world = fakeWorld();
    const atts = [{ type: 'sticker' }];
    const msg = await addMessage(atts);

    const result = await captureInboundMedia(input(msg, atts));
    expect(result.stored).toBe(0);
    expect(world.downloads).toBe(0);

    const count = await pool.query('select count(*)::int as n from media_assets');
    expect(count.rows[0].n).toBe(0);
  });

  it('ข้อความที่ไม่มีไฟล์แนบเลย → ไม่ทำอะไร', async () => {
    const world = fakeWorld();
    const msg = await addMessage([]);
    const result = await captureInboundMedia(input(msg, []));
    expect(result).toEqual({ stored: 0, skipped: 0, failed: 0 });
    expect(world.downloads).toBe(0);
  });

  it('⭐ สลิปที่เก็บแล้ว ผูกกับออเดอร์ได้และประวัติไม่ขาด', async () => {
    fakeWorld();
    const atts = [{ type: 'image', url: 'https://meta.example/slip.jpg' }];
    const msg = await addMessage(atts);
    await captureInboundMedia(input(msg, atts));

    const media = await pool.query('select id from media_assets where message_id = $1', [msg]);
    const mediaId = media.rows[0].id;

    // ผูกกับออเดอร์ตรง ๆ เพื่อยืนยันว่า foreign key ใช้ได้จริง
    await pool.query(
      `insert into orders (order_no, conversation_id, customer_id, page_id, slip_media_id, total)
       values ('ORD-TEST-001', $1, $2, $3, $4, 100)`,
      [ids.conversation, ids.customer, ids.page, mediaId],
    );

    const order = await pool.query('select slip_media_id from orders where order_no = $1', ['ORD-TEST-001']);
    expect(order.rows[0].slip_media_id).toBe(mediaId);
  });
});
