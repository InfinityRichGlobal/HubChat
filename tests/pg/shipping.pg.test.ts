/**
 * ชุดทดสอบวิธีจัดส่ง + เก็บเงินปลายทาง กับ PostgreSQL จริง (รอบ 6)
 * ===========================================================================
 * พิสูจน์เรื่องที่ "ผิดแล้วเสียเงินจริง" :
 *   1. ⭐ ออเดอร์เก็บสำเนาค่าส่ง — แก้ค่าส่งทีหลังต้องไม่กระทบออเดอร์เก่า
 *   2. ⭐ COD + ขนส่งที่ไม่รับปลายทาง = ฐานข้อมูลต้องปฏิเสธ ไม่ใช่แค่ซ่อนปุ่ม
 *   3. กฎเดียวกันต้องบังคับตอน "แก้" ด้วย ไม่ใช่แค่ตอนสร้าง
 *   4. ชื่อวิธีจัดส่งซ้ำไม่ได้
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

const { createOrder, updateOrder, getOrder } = await import('@/server/orders/service');
const {
  createShippingMethod, listShippingMethods, updateShippingMethod, ShippingError,
} = await import('@/server/orders/shipping');

let pool: Pool;
let rest: RestServer;

const ids = {
  page: randomUUID(),
  owner: randomUUID(),
  customer: randomUUID(),
  conversation: randomUUID(),
};

type Who = Parameters<typeof createOrder>[0];
const OWNER: Who = {
  id: ids.owner,
  name: 'เจ้าของ',
  email: 'o@test.local',
  role: 'owner',
  allowed_page_ids: [],
  must_change_password: false,
  is_active: true,
  last_seen_at: null,
  last_login_ip: null,
  session_version: 1,
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe.skipIf(!available)('PostgreSQL จริง — วิธีจัดส่ง + เก็บเงินปลายทาง', () => {
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
    await pool.query('delete from order_logs');
    await pool.query('delete from orders');
    await pool.query('delete from shipping_methods');
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');
    await pool.query('delete from admins');

    await pool.query(
      `insert into admins (id, name, email, password_hash, role) values ($1,'เจ้าของ','o@test.local','x','owner')`,
      [ids.owner],
    );
    await pool.query(
      `insert into pages (id, platform, page_id, page_name) values ($1,'facebook','1001','เพจ A')`,
      [ids.page],
    );
    await pool.query(
      `insert into customers (id, page_id, psid, platform, name) values ($1,$2,'PSID_A','facebook','คุณเอ')`,
      [ids.customer, ids.page],
    );
    await pool.query(
      `insert into conversations (id, customer_id, page_id, last_message_at) values ($1,$2,$3, now())`,
      [ids.conversation, ids.customer, ids.page],
    );
  });

  function draft(over: Record<string, unknown> = {}) {
    return {
      conversation_id: ids.conversation,
      recipient_name: 'คุณเอ',
      phone: '0812345678',
      address: '99/1',
      postcode: '10110',
      items: [{ product_id: randomUUID(), name: 'กระเป๋า', variant: 'แดง', qty: 1, unit_price: 290, total: 290 }],
      subtotal: 290,
      shipping_fee: 40,
      discount: 0,
      total: 330,
      payment_method: 'cod' as const,
      internal_note: null,
      ...over,
    };
  }

  /* -------------------------------------------------------------- */
  it('เพิ่ม / แก้ / เก็บเข้ากรุ วิธีจัดส่งได้', async () => {
    const m = await createShippingMethod({ name: 'Flash', fee: 40, cod_supported: true });
    expect(m.fee).toBe(40);
    expect(typeof m.fee).toBe('number'); // numeric ต้องไม่กลับมาเป็นสตริง

    const updated = await updateShippingMethod(m.id, { fee: 45 });
    expect(updated?.fee).toBe(45);

    await updateShippingMethod(m.id, { archive: true });
    const live = await listShippingMethods();
    expect(live.map((x) => x.id)).not.toContain(m.id);
  });

  it('⭐ ชื่อวิธีจัดส่งซ้ำไม่ได้ (ในกลุ่มที่ยังไม่เก็บเข้ากรุ)', async () => {
    await createShippingMethod({ name: 'Flash', fee: 40 });
    await expect(createShippingMethod({ name: 'flash', fee: 50 })).rejects.toThrow(ShippingError);

    // แต่พอเก็บเข้ากรุแล้ว เอาชื่อเดิมมาใช้ใหม่ได้
    const all = await listShippingMethods();
    await updateShippingMethod(all[0].id, { archive: true });
    const again = await createShippingMethod({ name: 'Flash', fee: 60 });
    expect(again.name).toBe('Flash');
  });

  it('ค่าจัดส่งติดลบไม่ได้', async () => {
    await expect(createShippingMethod({ name: 'พิลึก', fee: -10 })).rejects.toThrow(ShippingError);
  });

  /* -------------------------------------------------------------- */
  it('⭐ ออเดอร์เก็บสำเนาค่าส่ง — แก้ค่าส่งทีหลังไม่กระทบออเดอร์เก่า', async () => {
    const m = await createShippingMethod({ name: 'Flash', fee: 40, cod_supported: true });
    const order = await createOrder(OWNER, draft({ shipping_method_id: m.id }));

    expect(order.shipping_snapshot?.name).toBe('Flash');
    expect(Number(order.shipping_snapshot?.fee)).toBe(40);

    // เจ้าของร้านขึ้นค่าส่งเป็น 60
    await updateShippingMethod(m.id, { fee: 60 });

    // 🔴 ออเดอร์เก่าต้องยังเป็น 40 เหมือนเดิม
    const after = await getOrder(OWNER, order.id);
    expect(Number(after.shipping_snapshot?.fee)).toBe(40);
    expect(after.total).toBe(330);
  });

  /* -------------------------------------------------------------- */
  it('⭐ COD + ขนส่งที่ไม่รับปลายทาง → ฐานข้อมูลปฏิเสธตอนสร้าง', async () => {
    const m = await createShippingMethod({ name: 'ส่งแบบโอนก่อน', fee: 30, cod_supported: false });

    await expect(
      createOrder(OWNER, draft({ shipping_method_id: m.id, payment_method: 'cod' })),
    ).rejects.toThrow(/ไม่รองรับเก็บเงินปลายทาง/);

    // ต้องไม่มีแถวหลุดเข้าไปเลย
    const count = await pool.query('select count(*)::int as n from orders');
    expect(count.rows[0].n).toBe(0);
  });

  it('โอนเงิน + ขนส่งที่ไม่รับปลายทาง → สร้างได้ตามปกติ', async () => {
    const m = await createShippingMethod({ name: 'ส่งแบบโอนก่อน', fee: 30, cod_supported: false });
    const order = await createOrder(OWNER, draft({ shipping_method_id: m.id, payment_method: 'transfer' }));
    expect(order.payment_method).toBe('transfer');
  });

  /* -------------------------------------------------------------- */
  it('⭐ เปลี่ยนเป็น COD ทีหลัง กับขนส่งที่ไม่รับปลายทาง → ต้องถูกปฏิเสธด้วย', async () => {
    const m = await createShippingMethod({ name: 'ส่งแบบโอนก่อน', fee: 30, cod_supported: false });
    const order = await createOrder(OWNER, draft({ shipping_method_id: m.id, payment_method: 'transfer' }));

    // ถ้ากันแค่ตอนสร้าง ช่องนี้จะเป็นทางลัดให้เลี่ยงกฎได้ทั้งหมด
    await expect(updateOrder(OWNER, order.id, { payment_method: 'cod' })).rejects.toThrow(
      /ไม่รองรับเก็บเงินปลายทาง/,
    );

    const still = await getOrder(OWNER, order.id);
    expect(still.payment_method).toBe('transfer');
  });

  it('⭐ เปลี่ยนวิธีจัดส่งทีหลัง → สำเนาชุดใหม่ถูกหยิบมาให้เอง', async () => {
    const flash = await createShippingMethod({ name: 'Flash', fee: 40, cod_supported: true });
    const kerry = await createShippingMethod({ name: 'Kerry', fee: 55, cod_supported: true });

    const order = await createOrder(OWNER, draft({ shipping_method_id: flash.id }));
    expect(order.shipping_snapshot?.name).toBe('Flash');

    const moved = await updateOrder(OWNER, order.id, { shipping_method_id: kerry.id });
    expect(moved.shipping_snapshot?.name).toBe('Kerry');
    expect(Number(moved.shipping_snapshot?.fee)).toBe(55);
  });

  it('ไม่เลือกวิธีจัดส่งก็สร้างออเดอร์ได้ (ค่อยเลือกทีหลัง)', async () => {
    const order = await createOrder(OWNER, draft({ shipping_method_id: null, payment_method: 'cod' }));
    expect(order.shipping_method_id).toBeNull();
    expect(order.shipping_snapshot).toBeNull();
  });

  it('อ้างวิธีจัดส่งที่ไม่มีอยู่จริง → ปฏิเสธ', async () => {
    await expect(
      createOrder(OWNER, draft({ shipping_method_id: randomUUID() })),
    ).rejects.toThrow(/ไม่พบวิธีจัดส่ง/);
  });

  it('การแก้ออเดอร์ยังจดประวัติครบเหมือนเดิม (ไม่ทำของเก่าพัง)', async () => {
    const m = await createShippingMethod({ name: 'Flash', fee: 40 });
    const order = await createOrder(OWNER, draft({ shipping_method_id: m.id }));
    await updateOrder(OWNER, order.id, { internal_note: 'แก้หมายเหตุ' });

    const logs = await pool.query('select action from order_logs where order_id = $1 order by created_at', [order.id]);
    expect(logs.rows.map((r) => r.action)).toEqual(['created', 'updated']);
  });
});
