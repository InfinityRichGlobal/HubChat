/**
 * ชุดทดสอบออเดอร์กับ PostgreSQL จริง (รอบ 5)
 * ===========================================================================
 * ชุดนี้พิสูจน์เรื่องที่ฐานข้อมูลปลอมพิสูจน์ไม่ได้ :
 *
 *   1. ⭐ แอดมินหลายคนกดสร้างออเดอร์พร้อมกัน → เลขออเดอร์ต้องไม่ซ้ำและไม่ข้าม
 *   2. ⭐ "ที่มาจากแอดไหน" ถูกคัดลอกจากห้องแชท ไม่ใช่จากผู้เรียก (ปลอมไม่ได้)
 *   3. ⭐ แก้ออเดอร์แล้วต้องมีประวัติทุกครั้ง ไม่มีทางแก้เงียบ ๆ ได้
 *   4. เวลาที่จ่ายเงิน / ปิดการขาย ถูกจดให้เองครั้งเดียว ไม่ทับของเดิม
 *   5. ⭐ สิทธิ์รายเพจถูกบังคับที่ชั้นข้อมูล ไม่ใช่ที่หน้าเว็บ
 *
 * รัน : npm run test:pg
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { postgresAvailable, resetDatabase, startRestServer, testPool, type RestServer } from './harness';

const available = await postgresAvailable();

// ⚠️ ต้องเป็นพอร์ตเดียวกับที่ harness เปิดฟัง ไม่งั้นยิงไปที่ที่ไม่มีใครรับ
//    แล้วจะเห็นเป็น "ไม่พบห้องแชท" ทั้งที่ข้อมูลอยู่ครบ
const REST_PORT = Number(process.env.HUBCHAT_TEST_REST_PORT ?? 54399);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${REST_PORT}`;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'a'.repeat(40);
process.env.SUPABASE_SERVICE_ROLE_KEY = 'b'.repeat(40);
process.env.SESSION_SECRET = 'c'.repeat(40);
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');

const { createOrder, updateOrder, listOrders, getOrder, listOrderLogs, OrderAccessError } = await import(
  '@/server/orders/service'
);

let pool: Pool;
let rest: RestServer;

const ids = {
  pageA: randomUUID(),
  pageB: randomUUID(),
  owner: randomUUID(),
  adminA: randomUUID(),
  customerA: randomUUID(),
  customerB: randomUUID(),
  convA: randomUUID(),
  convB: randomUUID(),
};

/** ลูกค้าคนนี้ทักมาครั้งแรกเมื่อ 3 วันก่อน — ใช้วัดว่าปิดการขายกี่ชั่วโมง */
const FIRST_CONTACT = new Date(Date.now() - 3 * 86_400_000);
const AD_ID = '23851234567890123';

type Who = Parameters<typeof createOrder>[0];

function who(id: string, role: 'owner' | 'admin', allowed: string[] = []): Who {
  return {
    id,
    name: role === 'owner' ? 'เจ้าของ' : 'แอดมิน เอ',
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

const OWNER = who(ids.owner, 'owner');
const ADMIN_A = who(ids.adminA, 'admin', [ids.pageA]); // เห็นเฉพาะเพจ A

const ITEMS = [
  { product_id: randomUUID(), name: 'กระเป๋า', variant: 'แดงอิฐ', qty: 1, unit_price: 290, total: 290 },
];

/* ================================================================== */
describe.skipIf(!available)('PostgreSQL จริง — ออเดอร์', () => {
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
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');
    await pool.query('delete from admins');

    await pool.query(
      `insert into admins (id, name, email, password_hash, role)
       values ($1,'เจ้าของ','owner@test.local','x','owner'),
              ($2,'แอดมิน เอ','a@test.local','x','admin')`,
      [ids.owner, ids.adminA],
    );

    await pool.query(
      `insert into pages (id, platform, page_id, page_name)
       values ($1,'facebook','1001','เพจ A'), ($2,'facebook','1002','เพจ B')`,
      [ids.pageA, ids.pageB],
    );

    await pool.query(
      `insert into customers (id, page_id, psid, platform, name, first_contact_at)
       values ($1,$2,'PSID_A','facebook','คุณเอ',$5),
              ($3,$4,'PSID_B','facebook','คุณบี',$5)`,
      [ids.customerA, ids.pageA, ids.customerB, ids.pageB, FIRST_CONTACT],
    );

    // ห้องแชท A มาจากแอด — ค่านี้ต้องถูกคัดลอกลงออเดอร์เอง
    await pool.query(
      `insert into conversations (id, customer_id, page_id, referral_source, referral_ad_id, last_message_at)
       values ($1,$2,$3,'ADS',$4, now())`,
      [ids.convA, ids.customerA, ids.pageA, AD_ID],
    );
    await pool.query(
      `insert into conversations (id, customer_id, page_id, last_message_at)
       values ($1,$2,$3, now())`,
      [ids.convB, ids.customerB, ids.pageB],
    );
  });

  function draft(conversationId = ids.convA) {
    return {
      conversation_id: conversationId,
      recipient_name: 'คุณเอ',
      phone: '0812345678',
      address: '99/1 ถ.สุขุมวิท',
      postcode: '10110',
      items: ITEMS,
      subtotal: 290,
      shipping_fee: 40,
      discount: 0,
      total: 330,
      payment_method: 'cod' as const,
      internal_note: null,
    };
  }

  /* -------------------------------------------------------------- */
  it('⭐ สร้างพร้อมกัน 5 ออเดอร์ → เลขไม่ซ้ำและไม่ข้าม', async () => {
    const created = await Promise.all(
      Array.from({ length: 5 }, () => createOrder(OWNER, draft())),
    );

    const numbers = created.map((o) => o.order_no);
    expect(new Set(numbers).size).toBe(5); // ไม่ซ้ำ

    // เลขท้ายต้องเรียง 1..5 ครบ ไม่มีตัวไหนหายไป
    const tails = numbers.map((n) => Number(n.split('-').at(-1))).sort((a, b) => a - b);
    expect(tails).toEqual([1, 2, 3, 4, 5]);
  });

  /* -------------------------------------------------------------- */
  it('⭐ ที่มาจากแอด/เวลาทักครั้งแรก ถูกคัดลอกจากห้องแชท ปลอมจากผู้เรียกไม่ได้', async () => {
    const order = await createOrder(OWNER, draft());

    const row = await pool.query(
      'select referral_ad_id, first_contact_at, page_id, customer_id from orders where id = $1',
      [order.id],
    );

    expect(row.rows[0].referral_ad_id).toBe(AD_ID);
    expect(new Date(row.rows[0].first_contact_at).getTime()).toBe(FIRST_CONTACT.getTime());
    // เพจกับลูกค้าก็มาจากห้องแชท ไม่ได้รับมาจากหน้าเว็บเช่นกัน
    expect(row.rows[0].page_id).toBe(ids.pageA);
    expect(row.rows[0].customer_id).toBe(ids.customerA);
  });

  /* -------------------------------------------------------------- */
  it('สร้างออเดอร์แล้วต้องมีประวัติ "created" ทันที', async () => {
    const order = await createOrder(OWNER, draft());
    const logs = await listOrderLogs(OWNER, order.id);

    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('created');
    expect(logs[0].admin_name).toBe('เจ้าของ');
  });

  /* -------------------------------------------------------------- */
  it('⭐ แก้ออเดอร์ทุกครั้งต้องมีประวัติ พร้อมค่าก่อน/หลัง', async () => {
    const order = await createOrder(OWNER, draft());
    await updateOrder(OWNER, order.id, { tracking_no: 'TH123', shipping_carrier: 'Flash' });

    const logs = await listOrderLogs(OWNER, order.id);
    expect(logs).toHaveLength(2);
    expect(logs[0].action).toBe('updated'); // เรียงใหม่สุดก่อน

    const raw = await pool.query(
      `select before, after from order_logs where order_id = $1 and action = 'updated'`,
      [order.id],
    );
    expect(raw.rows[0].before.tracking_no).toBeNull();
    expect(raw.rows[0].after.tracking_no).toBe('TH123');
  });

  /* -------------------------------------------------------------- */
  it('เปลี่ยนเป็นจ่ายแล้ว → จดเวลาให้เอง และไม่ทับเวลาเดิมเมื่อแก้ซ้ำ', async () => {
    const order = await createOrder(OWNER, draft());

    const paid = await updateOrder(OWNER, order.id, { payment_status: 'paid' });
    expect(paid.payment_status).toBe('paid');

    const first = await pool.query('select paid_at, closed_at from orders where id = $1', [order.id]);
    expect(first.rows[0].paid_at).not.toBeNull();

    // แก้อย่างอื่นอีกครั้ง — เวลาจ่ายเงินต้องเป็นเวลาเดิม
    await updateOrder(OWNER, order.id, { internal_note: 'ลูกค้าขอห่อของขวัญ' });
    const second = await pool.query('select paid_at from orders where id = $1', [order.id]);
    expect(new Date(second.rows[0].paid_at).getTime()).toBe(new Date(first.rows[0].paid_at).getTime());
  });

  /* -------------------------------------------------------------- */
  it('เปลี่ยนสถานะเป็นยืนยันแล้ว → จดเวลาปิดการขายให้เอง (ใช้วัดผลตามสเปก 5.4)', async () => {
    const order = await createOrder(OWNER, draft());
    expect((await pool.query('select closed_at from orders where id = $1', [order.id])).rows[0].closed_at)
      .toBeNull();

    await updateOrder(OWNER, order.id, { status: 'confirmed' });
    const row = await pool.query('select closed_at from orders where id = $1', [order.id]);
    expect(row.rows[0].closed_at).not.toBeNull();
  });

  /* -------------------------------------------------------------- */
  it('ยกเลิกออเดอร์ไม่ถือเป็นการปิดการขาย', async () => {
    const order = await createOrder(OWNER, draft());
    await updateOrder(OWNER, order.id, { status: 'cancelled' });

    const row = await pool.query('select closed_at, status from orders where id = $1', [order.id]);
    expect(row.rows[0].status).toBe('cancelled');
    expect(row.rows[0].closed_at).toBeNull();
  });

  /* -------------------------------------------------------------- */
  it('คีย์ที่ไม่ได้ส่งใน patch ต้องคงค่าเดิม ไม่กลายเป็นค่าว่าง', async () => {
    const order = await createOrder(OWNER, draft());
    const after = await updateOrder(OWNER, order.id, { status: 'confirmed' });

    expect(after.recipient_name).toBe('คุณเอ');
    expect(after.phone).toBe('0812345678');
    expect(after.total).toBe(330);
    expect(after.items).toHaveLength(1);
  });

  /* -------------------------------------------------------------- */
  it('⭐ แอดมินเห็นเฉพาะออเดอร์ของเพจที่มีสิทธิ์', async () => {
    await createOrder(OWNER, draft(ids.convA)); // เพจ A
    await createOrder(OWNER, draft(ids.convB)); // เพจ B

    const forOwner = await listOrders(OWNER);
    expect(forOwner).toHaveLength(2);

    const forAdmin = await listOrders(ADMIN_A);
    expect(forAdmin).toHaveLength(1);
    expect(forAdmin[0].page_id).toBe(ids.pageA);
  });

  /* -------------------------------------------------------------- */
  it('⭐ เปิดออเดอร์ของเพจที่ไม่มีสิทธิ์ไม่ได้ แม้จะรู้ id', async () => {
    const orderB = await createOrder(OWNER, draft(ids.convB));

    await expect(getOrder(ADMIN_A, orderB.id)).rejects.toThrow(OrderAccessError);
    await expect(updateOrder(ADMIN_A, orderB.id, { status: 'cancelled' })).rejects.toThrow(OrderAccessError);
    await expect(listOrderLogs(ADMIN_A, orderB.id)).rejects.toThrow(OrderAccessError);
  });

  /* -------------------------------------------------------------- */
  it('⭐ สร้างออเดอร์จากห้องแชทของเพจที่ไม่มีสิทธิ์ไม่ได้', async () => {
    await expect(createOrder(ADMIN_A, draft(ids.convB))).rejects.toThrow(OrderAccessError);

    const count = await pool.query('select count(*)::int as n from orders');
    expect(count.rows[0].n).toBe(0); // ต้องไม่มีแถวหลุดเข้าไปเลย
  });

  /* -------------------------------------------------------------- */
  it('สร้างจากห้องแชทที่ไม่มีอยู่จริงไม่ได้', async () => {
    await expect(createOrder(OWNER, draft(randomUUID()))).rejects.toThrow(/ไม่พบห้องแชท/);
  });

  /* -------------------------------------------------------------- */
  it('ค้นหาด้วยเลขออเดอร์ / ชื่อ / เลขพัสดุ ได้', async () => {
    const order = await createOrder(OWNER, draft());
    await updateOrder(OWNER, order.id, { tracking_no: 'TH999888' });

    expect((await listOrders(OWNER, { search: order.order_no })).map((o) => o.id)).toEqual([order.id]);
    expect((await listOrders(OWNER, { search: 'คุณเอ' })).map((o) => o.id)).toEqual([order.id]);
    expect((await listOrders(OWNER, { search: 'TH999' })).map((o) => o.id)).toEqual([order.id]);
    expect(await listOrders(OWNER, { search: 'ไม่มีคำนี้แน่นอน' })).toEqual([]);
  });

  /* -------------------------------------------------------------- */
  it('กรองตามสถานะได้', async () => {
    const a = await createOrder(OWNER, draft());
    await createOrder(OWNER, draft());
    await updateOrder(OWNER, a.id, { status: 'shipped' });

    const shipped = await listOrders(OWNER, { status: 'shipped' });
    expect(shipped.map((o) => o.id)).toEqual([a.id]);

    const drafts = await listOrders(OWNER, { status: 'draft' });
    expect(drafts).toHaveLength(1);
  });

  /* -------------------------------------------------------------- */
  it('ตัวเลขเงินที่อ่านกลับมาต้องเป็นตัวเลข ไม่ใช่สตริง', async () => {
    // ⚠️ numeric ของ PostgreSQL เดินทางมาเป็นสตริง ถ้าไม่แปลง
    //    "290" + "40" จะได้ "29040" ซึ่งเป็นบั๊กเงินที่หายากมาก
    const order = await createOrder(OWNER, draft());
    const fetched = await getOrder(OWNER, order.id);

    expect(typeof fetched.total).toBe('number');
    expect(typeof fetched.subtotal).toBe('number');
    expect(typeof fetched.shipping_fee).toBe('number');
    expect(fetched.subtotal + fetched.shipping_fee).toBe(330);
  });
});
