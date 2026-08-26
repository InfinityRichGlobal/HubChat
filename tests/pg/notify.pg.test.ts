/**
 * ชุดทดสอบระบบแจ้งเตือนกับ PostgreSQL จริง (รอบ 10 — สเปกหัวข้อ 6.7)
 * ===========================================================================
 * ชุดนี้พิสูจน์เรื่องที่ฐานข้อมูลปลอมพิสูจน์ไม่ได้ :
 *
 *   1. 🔴 เหตุการณ์เดียว คนเดียว ช่องทางเดียว = แถวเดียวตลอดกาล (unique index)
 *   2. 🔴 ลูกค้าเก่ากลับมาทักอีก ต้องได้แจ้งเตือนใหม่
 *      (ห้องแชทหนึ่งห้องต่อลูกค้าหนึ่งคนตลอดชีวิต — กุญแจกันซ้ำที่ผูกกับห้องเฉย ๆ จะเงียบตลอดกาล)
 *   3. ⭐ สอง worker หยิบคิวพร้อมกัน → ไม่มีงานไหนถูกหยิบซ้ำ
 *   4. ผู้ดู (viewer) ไม่ได้รับแจ้งเตือนเรื่องแชท
 *   5. สิทธิ์รายเพจ — คนที่ไม่มีสิทธิ์ดูเพจ ต้องไม่รู้ว่ามีลูกค้าทักเพจนั้น
 *   6. ⭐ เดินตรวจแชทเงียบ : ตอบไปแล้วต้องไม่เตือน / ยังไม่ตอบต้องเตือน
 *   7. ⭐ "เปิดอ่านแล้ว" ไม่เท่ากับ "ตอบแล้ว" — อ่านแล้วเฉย ๆ ยังต้องเตือน
 *   8. ตั้งค่าเพจของตัวเองได้เฉพาะเพจที่มีสิทธิ์จริง
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
// ⭐ ต้องตั้งก่อน import — dispatch จะไม่เข้าคิวอะไรเลยถ้าไม่มีช่องทางไหนเปิดอยู่
process.env.VAPID_PUBLIC_KEY = 'x'.repeat(80);
process.env.VAPID_PRIVATE_KEY = 'y'.repeat(40);
process.env.VAPID_SUBJECT = 'mailto:test@hubchat.local';

const { dispatchNotification, unreadBadgeCount } = await import('@/server/notify/dispatch');
const { scanIdleAndClosing } = await import('@/server/notify/scan');
const { getPrefs, savePrefs } = await import('@/server/notify/prefs');
const { encryptSecret } = await import('@/lib/crypto');

let pool: Pool;
let rest: RestServer;

const ids = {
  page: randomUUID(),
  otherPage: randomUUID(),
  owner: randomUUID(),
  admin: randomUUID(),
  viewer: randomUUID(),
  customer: randomUUID(),
  conversation: randomUUID(),
};

type Who = Parameters<typeof getPrefs>[0];

function who(id: string, role: 'owner' | 'admin' | 'viewer', allowed: string[] = []): Who {
  return {
    id,
    name: role,
    email: `${id}@test.local`,
    role,
    allowed_page_ids: allowed,
    must_change_password: false,
    is_active: true,
    last_seen_at: null,
    last_login_ip: null,
    session_version: 1,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function jobs(where = '') {
  const { rows } = await pool.query(
    `select admin_id, channel, event, dedupe_key, status, title from notification_jobs ${where} order by created_at`,
  );
  return rows as Array<{
    admin_id: string; channel: string; event: string;
    dedupe_key: string; status: string; title: string;
  }>;
}

/** ใส่ข้อความหนึ่งข้อความลงห้องแชท */
async function addMessage(direction: 'in' | 'out', at: Date) {
  const id = randomUUID();
  await pool.query(
    `insert into messages (id, conversation_id, direction, sender_type, text, created_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [id, ids.conversation, direction, direction === 'in' ? 'customer' : 'admin', 'ข้อความ', at.toISOString()],
  );
  return id;
}

/* ================================================================== */
describe.skipIf(!available)('PostgreSQL จริง — ระบบแจ้งเตือน', () => {
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
    await pool.query('delete from notification_jobs');
    await pool.query('delete from notification_prefs');
    await pool.query('delete from push_subscriptions');
    await pool.query('delete from messages');
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');
    await pool.query('delete from admins');

    await pool.query(
      `insert into admins (id, name, email, password_hash, role, allowed_page_ids)
       values ($1,'เจ้าของ','owner@test.local','x','owner','{}'),
              ($2,'แอดมิน','admin@test.local','x','admin',$4),
              ($3,'ผู้ดู','viewer@test.local','x','viewer',$4)`,
      [ids.owner, ids.admin, ids.viewer, [ids.page]],
    );

    await pool.query(
      `insert into pages (id, platform, page_id, page_name, access_token, is_active)
       values ($1,'facebook','111111','เพจทดสอบ',$2,true),
              ($3,'facebook','222222','เพจที่สอง',$2,true)`,
      [ids.page, encryptSecret('EAA-fake'), ids.otherPage],
    );

    await pool.query(
      `insert into customers (id, page_id, platform, psid, name)
       values ($1,$2,'facebook','psid_1','คุณสมชาย')`,
      [ids.customer, ids.page],
    );
  });

  async function makeConversation(over: {
    last_customer_message_at?: Date;
    assigned?: string | null;
    is_read?: boolean;
  } = {}) {
    const at = over.last_customer_message_at ?? new Date();
    await pool.query(
      `insert into conversations
         (id, customer_id, page_id, last_message_at, last_customer_message_at,
          last_message_preview, assigned_admin_id, is_read)
       values ($1,$2,$3,$4,$4,'ราคาเท่าไหร่คะ',$5,$6)`,
      [ids.conversation, ids.customer, ids.page, at.toISOString(), over.assigned ?? null, over.is_read ?? false],
    );
  }

  /* ============================================================== */
  describe('กันแจ้งซ้ำ', () => {
    it('🔴 เหตุการณ์เดิมยิงสามครั้ง → เข้าคิวแถวเดียว', async () => {
      const input = {
        event: 'new_chat' as const,
        page_id: ids.page,
        subject_id: 'conv:msg_1',
        conversation_id: null,
        title: 'ลูกค้าทัก',
        body: 'สวัสดี',
      };

      const a = await dispatchNotification(input);
      const b = await dispatchNotification(input);
      const c = await dispatchNotification(input);

      expect(a.queued).toBeGreaterThan(0);
      expect(b.queued).toBe(0);
      expect(c.queued).toBe(0);

      const rows = await jobs();
      // เจ้าของ + แอดมิน (ผู้ดูไม่ได้) × ช่องทาง push (Telegram ยังไม่ได้ตั้งค่า)
      expect(rows.filter((r) => r.event === 'new_chat')).toHaveLength(2);
      expect(new Set(rows.map((r) => r.dedupe_key)).size).toBe(rows.length);
    });

    it('🔴 ลูกค้าเก่ากลับมาทักอีก ต้องได้แจ้งเตือนใหม่', async () => {
      /**
       * ห้องแชทมี unique index บน customer_id
       * = ลูกค้าคนเดิมใช้ห้องเดิมตลอดชีวิต
       * ถ้ากุญแจกันซ้ำผูกกับ "ห้อง" เฉย ๆ ครั้งที่สองจะเงียบสนิท
       * นี่คือความพังที่ไม่มี error ไม่มี log มีแต่ลูกค้าที่ไม่มีใครตอบ
       */
      const base = { event: 'new_chat' as const, page_id: ids.page, conversation_id: null, title: 'ทัก', body: 'x' };

      const first = await dispatchNotification({ ...base, subject_id: 'conv_1:msg_1' });
      const later = await dispatchNotification({ ...base, subject_id: 'conv_1:msg_999' });

      expect(first.queued).toBeGreaterThan(0);
      expect(later.queued).toBeGreaterThan(0);
      expect(await jobs()).toHaveLength(4);
    });
  });

  /* ============================================================== */
  describe('ใครควรได้รับ', () => {
    it('ผู้ดูไม่ได้รับแจ้งเตือนเรื่องแชท — กดเข้ามาก็ตอบไม่ได้อยู่ดี', async () => {
      await dispatchNotification({
        event: 'new_chat', page_id: ids.page, subject_id: 's1',
        conversation_id: null, title: 't', body: 'b',
      });
      const rows = await jobs();
      expect(rows.some((r) => r.admin_id === ids.viewer)).toBe(false);
    });

    it('🔴 คนที่ไม่มีสิทธิ์ดูเพจ ต้องไม่รู้ว่ามีลูกค้าทักเพจนั้น', async () => {
      await dispatchNotification({
        event: 'new_chat', page_id: ids.otherPage, subject_id: 's2',
        conversation_id: null, title: 't', body: 'b',
      });
      const rows = await jobs();
      // แอดมินมีสิทธิ์แค่เพจแรก → ต้องได้แต่เจ้าของเท่านั้น
      expect(rows.map((r) => r.admin_id)).toEqual([ids.owner]);
    });

    it('"ลูกค้าตอบ" ส่งเฉพาะคนที่รับแชทไว้', async () => {
      await dispatchNotification({
        event: 'reply', page_id: ids.page, subject_id: 's3',
        conversation_id: null, assigned_admin_id: ids.admin, title: 't', body: 'b',
      });
      const rows = await jobs();
      expect(rows.map((r) => r.admin_id)).toEqual([ids.admin]);
    });

    it('ปิดเหตุการณ์ไว้เอง = ไม่ได้รับ', async () => {
      await savePrefs(who(ids.admin, 'admin', [ids.page]), {
        enabled_events: ['new_comment'],
        page_ids: [],
        quiet_hours_start: null,
        quiet_hours_end: null,
        sound_enabled: true,
      });

      await dispatchNotification({
        event: 'new_chat', page_id: ids.page, subject_id: 's4',
        conversation_id: null, title: 't', body: 'b',
      });
      const rows = await jobs();
      expect(rows.some((r) => r.admin_id === ids.admin)).toBe(false);
      expect(rows.some((r) => r.admin_id === ids.owner)).toBe(true);
    });
  });

  /* ============================================================== */
  describe('หยิบงานจากคิว', () => {
    it('⭐ สอง worker หยิบพร้อมกัน → ไม่มีงานไหนถูกหยิบซ้ำ', async () => {
      for (let i = 0; i < 10; i += 1) {
        await dispatchNotification({
          event: 'new_chat', page_id: ids.page, subject_id: `bulk_${i}`,
          conversation_id: null, title: `t${i}`, body: 'b',
        });
      }
      const before = await jobs();
      expect(before.length).toBe(20); // 10 เหตุการณ์ × 2 คน

      const [a, b] = await Promise.all([
        pool.query(`select * from claim_notifications('push', 50)`),
        pool.query(`select * from claim_notifications('push', 50)`),
      ]);

      const gotA = a.rows.map((r) => r.id as string);
      const gotB = b.rows.map((r) => r.id as string);
      expect(gotA.length + gotB.length).toBe(20);
      expect(new Set([...gotA, ...gotB]).size).toBe(20);

      const { rows: left } = await pool.query(`select count(*)::int as n from notification_jobs where status='queued'`);
      expect(left[0].n).toBe(0);
    });

    it('🔴 ส่งไม่สำเร็จ ต้องกลับเข้าคิว ไม่ใช่หายตลอดกาล', async () => {
      /**
       * กุญแจกันซ้ำบล็อกการเข้าคิวใหม่ตลอดกาล
       * ถ้าครั้งแรกส่งพลาดแล้วตีเป็น failed ทันที = เน็ตสะดุด 10 วินาที
       * แล้วลูกค้าคนนั้นไม่มีใครรู้ว่ารออยู่เลย
       */
      await dispatchNotification({
        event: 'new_chat', page_id: ids.page, subject_id: 'retry_me',
        conversation_id: null, title: 't', body: 'b',
      });

      const claimed = await pool.query(`select * from claim_notifications('push', 50)`);
      const jobId = claimed.rows[0].id as string;

      const first = await pool.query(`select * from fail_notification($1, 'เน็ตสะดุด')`, [jobId]);
      expect(first.rows[0].requeued).toBe(true);

      const { rows } = await pool.query(`select status, attempt_count from notification_jobs where id = $1`, [jobId]);
      expect(rows[0].status).toBe('queued');
      // หยิบใหม่ได้จริง
      const again = await pool.query(`select * from claim_notifications('push', 50)`);
      expect(again.rows.map((r) => r.id)).toContain(jobId);
    });

    it('🔴 ลองครบ 3 ครั้งแล้วต้องยอมแพ้ ไม่วนไม่รู้จบ', async () => {
      await dispatchNotification({
        event: 'new_chat', page_id: ids.page, subject_id: 'give_up',
        conversation_id: null, title: 't', body: 'b',
      });
      const first = await pool.query(`select * from claim_notifications('push', 50)`);
      const jobId = first.rows[0].id as string;

      let requeued = true;
      let loops = 0;
      while (requeued && loops < 10) {
        const r = await pool.query(`select * from fail_notification($1, 'พังอีกแล้ว')`, [jobId]);
        requeued = r.rows[0].requeued as boolean;
        if (requeued) await pool.query(`select * from claim_notifications('push', 50)`);
        loops += 1;
      }

      expect(loops).toBeLessThanOrEqual(4);
      const { rows } = await pool.query(`select status from notification_jobs where id = $1`, [jobId]);
      expect(rows[0].status).toBe('failed');
    });

    it('⭐ ของที่ล้นข้อความ Telegram ต้องคืนเข้าคิวโดยไม่นับเป็นความล้มเหลว', async () => {
      await dispatchNotification({
        event: 'new_chat', page_id: ids.page, subject_id: 'overflow',
        conversation_id: null, title: 't', body: 'b',
      });
      const claimed = await pool.query(`select * from claim_notifications('push', 50)`);
      const jobId = claimed.rows[0].id as string;
      const before = claimed.rows[0].attempt_count as number;

      await pool.query(`select requeue_notification($1)`, [jobId]);

      const { rows } = await pool.query(
        `select status, attempt_count from notification_jobs where id = $1`, [jobId],
      );
      expect(rows[0].status).toBe('queued');
      // ⭐ ต้องลดจำนวนครั้งกลับ ไม่งั้นวันที่งานเยอะจริง งานท้าย ๆ จะโดนทิ้งทั้งที่ยังไม่เคยถูกส่ง
      expect(rows[0].attempt_count).toBe(before - 1);
    });

    it('หยิบไปแล้วรอบถัดไปต้องไม่ได้อะไรอีก', async () => {
      await dispatchNotification({
        event: 'new_chat', page_id: ids.page, subject_id: 'once',
        conversation_id: null, title: 't', body: 'b',
      });
      const first = await pool.query(`select * from claim_notifications('push', 50)`);
      const second = await pool.query(`select * from claim_notifications('push', 50)`);
      expect(first.rows.length).toBeGreaterThan(0);
      expect(second.rows).toHaveLength(0);
    });
  });

  /* ============================================================== */
  describe('เดินตรวจแชทที่ลูกค้ารออยู่', () => {
    it('⭐ ลูกค้าทักแล้วเงียบ 20 นาที ยังไม่มีใครตอบ → เตือน', async () => {
      const at = new Date(Date.now() - 20 * 60_000);
      await makeConversation({ last_customer_message_at: at });
      await addMessage('in', at);

      const summary = await scanIdleAndClosing();
      expect(summary.scanned).toBe(1);
      expect(summary.idle_queued).toBeGreaterThan(0);

      const rows = await jobs(`where event = 'idle_15min'`);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].title).toContain('คุณสมชาย');
    });

    it('🔴 ตอบไปแล้ว → ต้องไม่เตือน', async () => {
      const at = new Date(Date.now() - 20 * 60_000);
      await makeConversation({ last_customer_message_at: at });
      await addMessage('in', at);
      await addMessage('out', new Date(at.getTime() + 60_000)); // แอดมินตอบหลังจากนั้น 1 นาที

      const summary = await scanIdleAndClosing();
      expect(summary.idle_queued).toBe(0);
      expect(await jobs(`where event = 'idle_15min'`)).toHaveLength(0);
    });

    it('🔴 "เปิดอ่านแล้ว" ไม่เท่ากับ "ตอบแล้ว" — อ่านแล้วเฉย ๆ ยังต้องเตือน', async () => {
      /**
       * เคยเกือบเขียนเป็น is_read = false ซึ่งผิด
       * แอดมินเปิดดูแล้ววางมือถือลง ลูกค้าก็ยังรออยู่ดี
       * แล้วจะไม่มีใครมาเตือนอีกเลยเพราะห้องนี้ "อ่านแล้ว"
       */
      const at = new Date(Date.now() - 20 * 60_000);
      await makeConversation({ last_customer_message_at: at, is_read: true });
      await addMessage('in', at);

      const summary = await scanIdleAndClosing();
      expect(summary.idle_queued).toBeGreaterThan(0);
    });

    it('ตอบก่อนที่ลูกค้าจะทักรอบใหม่ ไม่นับว่าตอบแล้ว', async () => {
      const old = new Date(Date.now() - 60 * 60_000);
      const at = new Date(Date.now() - 20 * 60_000);
      await makeConversation({ last_customer_message_at: at });
      await addMessage('out', old);   // ตอบไว้เมื่อชั่วโมงที่แล้ว
      await addMessage('in', at);     // ลูกค้าทักใหม่หลังจากนั้น

      const summary = await scanIdleAndClosing();
      expect(summary.idle_queued).toBeGreaterThan(0);
    });

    it('🔴 บอทตอบคีย์เวิร์ดไป ไม่นับว่า "มีคนตอบ"', async () => {
      /**
       * ห้องที่บอททักไป "สวัสดีค่ะ" แล้วไม่มีคนมาต่อ คือห้องที่ต้องเตือนที่สุด
       * เพราะลูกค้าเข้าใจว่ามีคนคุยอยู่ แล้วรอนานกว่าเดิม
       * ถ้าเช็คแค่ direction = 'out' ห้องแบบนี้จะเงียบสนิทตลอดกาล
       */
      const at = new Date(Date.now() - 20 * 60_000);
      await makeConversation({ last_customer_message_at: at });
      await addMessage('in', at);
      await pool.query(
        `insert into messages (id, conversation_id, direction, sender_type, text, created_at)
         values ($1,$2,'out','bot','สวัสดีค่ะ',$3)`,
        [randomUUID(), ids.conversation, new Date(at.getTime() + 5_000).toISOString()],
      );

      const summary = await scanIdleAndClosing();
      expect(summary.idle_queued).toBeGreaterThan(0);
    });

    it('เพิ่งทักเมื่อ 5 นาทีที่แล้ว → ยังไม่ต้องเตือน', async () => {
      const at = new Date(Date.now() - 5 * 60_000);
      await makeConversation({ last_customer_message_at: at });
      await addMessage('in', at);

      const summary = await scanIdleAndClosing();
      expect(summary.scanned).toBe(0);
      expect(summary.idle_queued).toBe(0);
    });

    it('⭐ เดินตรวจสองรอบติดกัน → ไม่แจ้งซ้ำ', async () => {
      const at = new Date(Date.now() - 20 * 60_000);
      await makeConversation({ last_customer_message_at: at });
      await addMessage('in', at);

      const first = await scanIdleAndClosing();
      const second = await scanIdleAndClosing();
      expect(first.idle_queued).toBeGreaterThan(0);
      expect(second.idle_queued).toBe(0);
    });

    it('⭐ ใกล้หมดกรอบ 24 ชม. → เตือนเฉพาะคนที่รับแชทไว้', async () => {
      const at = new Date(Date.now() - 23 * 3_600_000); // เหลืออีกชั่วโมงเดียว
      await makeConversation({ last_customer_message_at: at, assigned: ids.admin });
      await addMessage('in', at);

      const summary = await scanIdleAndClosing();
      expect(summary.window_queued).toBeGreaterThan(0);

      const rows = await jobs(`where event = 'window_closing'`);
      expect(rows.map((r) => r.admin_id)).toEqual([ids.admin]);
    });

    it('ยังไม่มีใครรับแชท → ไม่มีใครได้ "ใกล้หมดกรอบ"', async () => {
      const at = new Date(Date.now() - 23 * 3_600_000);
      await makeConversation({ last_customer_message_at: at, assigned: null });
      await addMessage('in', at);

      const summary = await scanIdleAndClosing();
      expect(summary.window_queued).toBe(0);
      expect(await jobs(`where event = 'window_closing'`)).toHaveLength(0);
    });

    it('พ้นกรอบ 24 ชม. ไปแล้ว → ไม่ต้องตรวจอีก เตือนไปก็ทำอะไรไม่ได้', async () => {
      const at = new Date(Date.now() - 30 * 3_600_000);
      await makeConversation({ last_customer_message_at: at, assigned: ids.admin });
      await addMessage('in', at);

      const summary = await scanIdleAndClosing();
      expect(summary.scanned).toBe(0);
    });
  });

  /* ============================================================== */
  describe('เลขแดงบนไอคอนแอป', () => {
    it('🔴 ต้องนับเฉพาะเพจที่คนนั้นมีสิทธิ์เห็น', async () => {
      /**
       * ถ้านับทุกเพจ แอดมินจะเห็นเลข 2 บนไอคอน กดเข้ามาแล้วเจอแชทเดียว แล้วงง
       * และเป็นการบอกใบ้ว่ามีงานในเพจที่เขาไม่ควรรู้ว่ามีอยู่ด้วย
       */
      await makeConversation();                       // เพจแรก (แอดมินเห็น)
      const other = randomUUID();
      const otherCustomer = randomUUID();
      await pool.query(
        `insert into customers (id, page_id, platform, psid, name)
         values ($1,$2,'facebook','psid_2','ลูกค้าเพจสอง')`,
        [otherCustomer, ids.otherPage],
      );
      await pool.query(
        `insert into conversations (id, customer_id, page_id, last_message_at, is_read)
         values ($1,$2,$3,now(),false)`,
        [other, otherCustomer, ids.otherPage],
      );

      expect(await unreadBadgeCount(ids.owner, 'owner', [])).toBe(2);
      expect(await unreadBadgeCount(ids.admin, 'admin', [ids.page])).toBe(1);
      // ไม่มีสิทธิ์เพจไหนเลย = ไม่ต้องขึ้นเลข
      expect(await unreadBadgeCount(ids.admin, 'admin', [])).toBe(0);
    });

    it('อ่านหมดแล้ว = 0', async () => {
      await makeConversation({ is_read: true });
      expect(await unreadBadgeCount(ids.owner, 'owner', [])).toBe(0);
    });
  });

  /* ============================================================== */
  describe('ค่าตั้งส่วนตัว', () => {
    it('ยังไม่เคยตั้งค่า = เปิดทุกเหตุการณ์', async () => {
      const view = await getPrefs(who(ids.admin, 'admin', [ids.page]));
      expect(view.enabled_events).toHaveLength(5);
      expect(view.quiet_hours_start).toBe('22:00');
    });

    it('🔴 ยัด id ของเพจที่ไม่มีสิทธิ์มา → ต้องถูกตัดทิ้ง', async () => {
      const saved = await savePrefs(who(ids.admin, 'admin', [ids.page]), {
        enabled_events: ['new_chat'],
        page_ids: [ids.page, ids.otherPage],
        quiet_hours_start: '23:00',
        quiet_hours_end: '07:00',
        sound_enabled: false,
      });
      expect(saved.page_ids).toEqual([ids.page]);
      expect(saved.enabled_events).toEqual(['new_chat']);
      expect(saved.quiet_hours_start).toBe('23:00');
    });

    it('ชื่อเหตุการณ์แปลกปลอมต้องไม่หลุดลงฐานข้อมูล', async () => {
      const saved = await savePrefs(who(ids.owner, 'owner'), {
        enabled_events: ['new_chat', 'drop table', 'reply'],
        page_ids: [],
        quiet_hours_start: null,
        quiet_hours_end: null,
        sound_enabled: true,
      });
      expect(saved.enabled_events).toEqual(['new_chat', 'reply']);
    });

    it('เจ้าของเห็นทุกเพจ แอดมินเห็นเฉพาะที่ได้รับสิทธิ์', async () => {
      expect((await getPrefs(who(ids.owner, 'owner'))).pages).toHaveLength(2);
      expect((await getPrefs(who(ids.admin, 'admin', [ids.page]))).pages).toHaveLength(1);
    });
  });
});
