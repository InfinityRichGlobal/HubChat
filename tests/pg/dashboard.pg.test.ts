/**
 * ชุดทดสอบสรุปยอดกับ PostgreSQL จริง (รอบ 9 — สเปกหัวข้อ 5.4)
 * ===========================================================================
 * 🔴 ชุดนี้เกิดขึ้นเพราะบั๊กจริงที่หลุดไปถึงเครื่องผู้ใช้ (D-87)
 *
 *    โค้ดขอคอลัมน์ `customers.referral_ad_id` ซึ่งไม่เคยมีอยู่จริงเลยสักไฟล์
 *    แล้วไม่มีอะไรจับได้ :
 *      • TypeScript จับไม่ได้ — ชื่อคอลัมน์เป็นสตริง
 *      • ชุดทดสอบเดิมจับไม่ได้ — ทดสอบแต่ฟังก์ชันคำนวณ ซึ่งรับข้อมูลที่ป้อนให้
 *      • ฐานข้อมูลปลอมจับไม่ได้ — ไม่มี schema จริงให้ชน
 *    → เปิดหน้าสรุปยอดบนเครื่องจริงแล้วขึ้น error 500
 *
 *    ชุดนี้จึงรันบนฐานข้อมูลที่ "รัน migration ครบทุกไฟล์ตั้งแต่ 0001" แล้ว
 *    และไล่ตรวจ **ทุกคอลัมน์ที่หน้าสรุปยอดขอ** ว่ามีอยู่จริง
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

const { loadDashboard, DASHBOARD_SELECTS } = await import('@/server/dashboard/service');
const { encryptSecret } = await import('@/lib/crypto');

let pool: Pool;
let rest: RestServer;

const ids = {
  page: randomUUID(),
  otherPage: randomUUID(),
  owner: randomUUID(),
  admin: randomUUID(),
};

type Who = Parameters<typeof loadDashboard>[0];

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

/** สร้างลูกค้า + ห้องแชท (ห้องแชทคือที่เก็บ "แอดที่พาเข้ามา") */
async function makeCustomer(over: { ad?: string | null; at?: Date; page?: string } = {}) {
  const customerId = randomUUID();
  const conversationId = randomUUID();
  const at = (over.at ?? new Date()).toISOString();
  const page = over.page ?? ids.page;

  await pool.query(
    `insert into customers (id, page_id, platform, psid, name, first_contact_at)
     values ($1,$2,'facebook',$3,'ลูกค้าทดสอบ',$4)`,
    [customerId, page, `psid_${customerId.slice(0, 8)}`, at],
  );
  await pool.query(
    `insert into conversations (id, customer_id, page_id, last_message_at, referral_ad_id, created_at)
     values ($1,$2,$3,$4,$5,$4)`,
    [conversationId, customerId, page, at, over.ad ?? null],
  );
  return { customerId, conversationId };
}

async function makeOrder(over: {
  customerId: string; conversationId: string;
  ad?: string | null; total?: number; status?: string;
  by?: string; at?: Date; closedAt?: Date | null; page?: string;
}) {
  const id = randomUUID();
  const at = (over.at ?? new Date()).toISOString();
  await pool.query(
    `insert into orders
       (id, order_no, conversation_id, customer_id, page_id, items, total,
        status, referral_ad_id, first_contact_at, closed_at, created_by_admin_id, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$10)`,
    [
      id, `ORD-${id.slice(0, 8)}`, over.conversationId, over.customerId, over.page ?? ids.page,
      JSON.stringify([{ product_id: null, name: 'เสื้อยืด', variant: 'ดำ', qty: 1, unit_price: over.total ?? 500, total: over.total ?? 500 }]),
      over.total ?? 500, over.status ?? 'confirmed', over.ad ?? null, at,
      over.closedAt ? over.closedAt.toISOString() : null, over.by ?? ids.owner,
    ],
  );
  return id;
}

/* ================================================================== */
describe.skipIf(!available)('PostgreSQL จริง — สรุปยอด', () => {
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
    await pool.query('delete from orders');
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');
    await pool.query('delete from admins');

    await pool.query(
      `insert into admins (id, name, email, password_hash, role, allowed_page_ids)
       values ($1,'เจ้าของ','owner@test.local','x','owner','{}'),
              ($2,'แอดมิน','admin@test.local','x','admin',$3)`,
      [ids.owner, ids.admin, [ids.page]],
    );
    await pool.query(
      `insert into pages (id, platform, page_id, page_name, access_token, is_active)
       values ($1,'facebook','111111','เพจทดสอบ',$2,true),
              ($3,'facebook','222222','เพจที่สอง',$2,true)`,
      [ids.page, encryptSecret('EAA-fake'), ids.otherPage],
    );
  });

  /* ============================================================== */
  describe('🔴 ทุกคอลัมน์ที่หน้านี้ขอ ต้องมีอยู่จริงในฐานข้อมูล', () => {
    it('ไล่ตรวจทีละชื่อกับ information_schema (นี่คือด่านที่ D-87 หลุดมาได้)', async () => {
      expect(DASHBOARD_SELECTS.length).toBeGreaterThan(0);

      const missing: string[] = [];

      for (const { table, fields } of DASHBOARD_SELECTS) {
        const { rows } = await pool.query(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = $1`,
          [table],
        );
        const real = new Set(rows.map((r) => r.column_name as string));

        // ตารางต้องมีอยู่จริงด้วย ไม่ใช่แค่คอลัมน์
        expect(real.size, `ไม่พบตาราง ${table}`).toBeGreaterThan(0);

        for (const col of fields.split(',').map((c) => c.trim()).filter(Boolean)) {
          if (!real.has(col)) missing.push(`${table}.${col}`);
        }
      }

      expect(missing, `คอลัมน์ที่โค้ดขอแต่ฐานข้อมูลไม่มี: ${missing.join(', ')}`).toEqual([]);
    });

    it('🔴 customers ต้องไม่มี referral_ad_id — แอดเป็นของ "ห้องแชท" ไม่ใช่ของ "คน"', async () => {
      /**
       * ถ้าวันหนึ่งมีคนเพิ่มคอลัมน์นี้เข้าไปที่ customers เทสต์นี้จะแดง
       * เพื่อบังคับให้คุยกันก่อนว่าจะมีความจริงสองแหล่งจริงหรือ (บทเรียนเดียวกับ D-5)
       */
      const { rows } = await pool.query(
        `select column_name from information_schema.columns
          where table_schema='public' and table_name='customers' and column_name='referral_ad_id'`,
      );
      expect(rows).toHaveLength(0);

      // และห้องแชทต้องมี เพราะเป็นแหล่งความจริงตัวจริง
      const { rows: conv } = await pool.query(
        `select column_name from information_schema.columns
          where table_schema='public' and table_name='conversations' and column_name='referral_ad_id'`,
      );
      expect(conv).toHaveLength(1);
    });
  });

  /* ============================================================== */
  describe('เปิดหน้าได้จริงบน migration ครบชุด', () => {
    it('⭐ ร้านที่ยังไม่มีข้อมูลเลย ต้องเปิดได้ ไม่ใช่ 500', async () => {
      const data = await loadDashboard(who(ids.owner, 'owner'), '7d');
      expect(data.headline.sales).toBe(0);
      expect(data.headline.order_count).toBe(0);
      expect(data.by_ad).toEqual([]);
      expect(data.by_hour).toHaveLength(24);
    });

    it('⭐ มีออเดอร์จริง → ยอดถูกต้อง', async () => {
      const c1 = await makeCustomer();
      await makeOrder({ ...c1, total: 500 });
      const c2 = await makeCustomer();
      await makeOrder({ ...c2, total: 1500 });

      const data = await loadDashboard(who(ids.owner, 'owner'), '7d');
      expect(data.headline.sales).toBe(2000);
      expect(data.headline.order_count).toBe(2);
      expect(data.headline.average_order).toBe(1000);
      expect(data.headline.new_chats).toBe(2);
    });

    it('ออเดอร์ที่ยกเลิกไม่นับเป็นยอดขาย', async () => {
      const c1 = await makeCustomer();
      await makeOrder({ ...c1, total: 500 });
      const c2 = await makeCustomer();
      await makeOrder({ ...c2, total: 9999, status: 'cancelled' });

      const data = await loadDashboard(who(ids.owner, 'owner'), '7d');
      expect(data.headline.sales).toBe(500);
      expect(data.headline.order_count).toBe(1);
    });
  });

  /* ============================================================== */
  describe('⭐ ที่มาของแอด — เดินจากห้องแชท ไม่ใช่จากตัวลูกค้า', () => {
    it('นับแชทเข้าและออเดอร์ปิดได้ของแอดเดียวกัน', async () => {
      const c1 = await makeCustomer({ ad: 'AD_123' });
      await makeOrder({ ...c1, ad: 'AD_123', total: 800 });

      // ทักจากแอดเดียวกันแต่ยังไม่ซื้อ
      await makeCustomer({ ad: 'AD_123' });

      // ทักเองไม่ผ่านแอด
      const c3 = await makeCustomer({ ad: null });
      await makeOrder({ ...c3, ad: null, total: 300 });

      const data = await loadDashboard(who(ids.owner, 'owner'), '7d');

      const row = data.by_ad.find((r) => r.ad_id === 'AD_123');
      expect(row, 'ไม่พบแถวของ AD_123 — แปลว่าอ่าน referral_ad_id จากห้องแชทไม่สำเร็จ').toBeDefined();
      expect(row!.chats).toBe(2);
      expect(row!.closed).toBe(1);
      expect(row!.sales).toBe(800);
      expect(row!.close_rate).toBe(50);

      // ลูกค้าที่ไม่ได้มาจากแอด ต้องไม่ถูกยัดเข้าแถวไหน
      expect(data.by_ad.some((r) => !r.ad_id || r.ad_id === 'null')).toBe(false);
    });

    it('ลูกค้าเยอะกว่าขนาดก้อนที่แบ่งยิง ก็ต้องได้ที่มาครบทุกคน', async () => {
      /**
       * โค้ดแบ่งยิง .in() เป็นก้อนละ 200 เพื่อกัน URL ยาวเกิน
       * ถ้าแบ่งผิด ลูกค้าก้อนหลัง ๆ จะไม่มีแอดติดมา แล้วตัวเลขจะขาดแบบเงียบ ๆ
       */
      for (let i = 0; i < 205; i += 1) await makeCustomer({ ad: 'AD_BULK' });

      const data = await loadDashboard(who(ids.owner, 'owner'), '7d');
      const row = data.by_ad.find((r) => r.ad_id === 'AD_BULK');
      expect(row?.chats, 'ได้ไม่ครบ = แบ่งก้อนยิง .in() ผิด ลูกค้าก้อนหลังไม่มีแอดติดมา').toBe(205);
    });
  });

  /* ============================================================== */
  describe('สิทธิ์', () => {
    it('🔴 แอดมินทั่วไปเห็นเฉพาะออเดอร์ที่ตัวเองสร้าง', async () => {
      const c1 = await makeCustomer();
      await makeOrder({ ...c1, total: 1000, by: ids.owner });
      const c2 = await makeCustomer();
      await makeOrder({ ...c2, total: 200, by: ids.admin });

      const data = await loadDashboard(who(ids.admin, 'admin', [ids.page]), '7d');
      expect(data.scope).toBe('self');
      expect(data.headline.sales).toBe(200);
    });

    it('⭐ ขอบเขต "ของตัวเอง" ต้องซ่อนอัตราปิดการขาย ไม่ใช่แสดงค่าที่คำนวณจากฐานผิด', async () => {
      const c1 = await makeCustomer();
      await makeOrder({ ...c1, total: 200, by: ids.admin });
      await makeCustomer();

      const data = await loadDashboard(who(ids.admin, 'admin', [ids.page]), '7d');
      expect(data.headline.new_chats).toBe(0);
      expect(data.headline.close_rate).toBe(0);
    });

    it('🔴 ไม่มีสิทธิ์เพจไหนเลย → ไม่เห็นยอดของใครทั้งสิ้น', async () => {
      const c1 = await makeCustomer();
      await makeOrder({ ...c1, total: 5000 });

      const data = await loadDashboard(who(ids.admin, 'admin', []), '7d');
      expect(data.headline.sales).toBe(0);
      expect(data.headline.order_count).toBe(0);
    });

    it('ออเดอร์ของเพจที่ไม่มีสิทธิ์ ต้องไม่ถูกนับ', async () => {
      const mine = await makeCustomer({ page: ids.page });
      await makeOrder({ ...mine, total: 100, page: ids.page, by: ids.admin });
      const theirs = await makeCustomer({ page: ids.otherPage });
      await makeOrder({ ...theirs, total: 7000, page: ids.otherPage, by: ids.admin });

      const data = await loadDashboard(who(ids.admin, 'admin', [ids.page]), '7d');
      expect(data.headline.sales).toBe(100);
    });
  });
});
