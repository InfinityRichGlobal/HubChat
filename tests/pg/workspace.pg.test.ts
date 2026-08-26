/**
 * ชุดทดสอบพื้นที่ทำงานลูกค้า + ปุ่มลัดในห้องแชท (ก้อน 2 ข้อ 1.5–1.11)
 * ===========================================================================
 * 🔴 สิ่งที่ชุดนี้ต้องพิสูจน์ :
 *   1. ทุกคอลัมน์ที่โค้ดขอ มีอยู่จริงในฐานข้อมูล (กัน D-87 ซ้ำ)
 *   2. สิทธิ์รายเพจ — แอดมินที่ไม่มีสิทธิ์เข้าห้องไม่ได้เลย
 *   3. บันทึกภายในของลูกค้าคนอื่น ลบข้ามกันไม่ได้
 *   4. ⭐ ราคา/ยอด/เลขพัสดุ มาจากฐานข้อมูลเสมอ ไม่ใช่จากเบราว์เซอร์
 *   5. ⭐ ออเดอร์ที่ยกเลิกแล้ว ห้ามถูกหยิบมาเป็น "ออเดอร์ล่าสุด"
 *   6. ข้อความที่ยังไม่สมบูรณ์ ต้องถูกตีว่า "ยังไม่พร้อมส่ง"
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

const { loadWorkspace, addNote, deleteNote } = await import('@/server/customers/workspace');
const { composeShippingInfo, composeOrderSummary, composeProducts, resolveCannedText, QUICK_ACTION_SELECTS } =
  await import('@/server/chat/quick-actions');
const { updateCustomerContact, InboxAccessError } = await import('@/server/inbox/service');
const { encryptSecret } = await import('@/lib/crypto');

let pool: Pool;
let rest: RestServer;

const ids = {
  page: randomUUID(), otherPage: randomUUID(),
  owner: randomUUID(), admin: randomUUID(),
  custA: randomUUID(), convA: randomUUID(),
  custB: randomUUID(), convB: randomUUID(),
};

type Who = Parameters<typeof loadWorkspace>[0];
function who(id: string, role: 'owner' | 'admin', allowed: string[] = []): Who {
  return {
    id, name: role, email: `${id}@t.local`, role, allowed_page_ids: allowed,
    must_change_password: false, is_active: true, last_seen_at: null, last_login_ip: null,
    session_version: 1, created_by: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}
const OWNER = who(ids.owner, 'owner');

async function makeOrder(customerId: string, over: {
  status?: string; total?: number; tracking?: string | null; carrier?: string | null; at?: Date;
} = {}) {
  const id = randomUUID();
  await pool.query(
    `insert into orders (id, order_no, customer_id, page_id, items, subtotal, shipping_fee, discount,
                         total, status, shipping_carrier, tracking_no, payment_method, created_at)
     values ($1,$2,$3,$4,$5,1000,50,100,$6,$7,$8,$9,'cod',$10)`,
    [
      id, `ORD-${id.slice(0, 6)}`, customerId, ids.page,
      JSON.stringify([{ name: 'เสื้อยืด', variant: 'ดำ', qty: 2, total: 1000 }]),
      over.total ?? 950, over.status ?? 'confirmed',
      over.carrier ?? 'Flash', over.tracking ?? 'TH999',
      (over.at ?? new Date()).toISOString(),
    ],
  );
  return id;
}

/* ================================================================== */
describe.skipIf(!available)('PostgreSQL จริง — พื้นที่ทำงานลูกค้า + ปุ่มลัด', () => {
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
    for (const t of ['customer_notes', 'orders', 'messages', 'conversations', 'customers', 'products', 'promotions', 'pages', 'admins']) {
      await pool.query(`delete from ${t}`);
    }
    await pool.query(
      `insert into admins (id,name,email,password_hash,role,allowed_page_ids) values
        ($1,'เจ้าของ','o@t.local','x','owner','{}'),
        ($2,'แอดมิน','a@t.local','x','admin',$3)`,
      [ids.owner, ids.admin, [ids.page]],
    );
    await pool.query(
      `insert into pages (id,platform,page_id,page_name,access_token,is_active) values
        ($1,'facebook','111','เพจ A',$3,true), ($2,'facebook','222','เพจ B',$3,true)`,
      [ids.page, ids.otherPage, encryptSecret('EAA')],
    );
    await pool.query(
      `insert into customers (id,page_id,platform,psid,name,recipient_name,phone,address,postcode) values
        ($1,$3,'facebook','psid_a','คุณเอ','สมชาย ใจดี','0812345678','123 ถ.สุขุมวิท','10110'),
        ($2,$4,'facebook','psid_b','คุณบี',null,null,null,null)`,
      [ids.custA, ids.custB, ids.page, ids.otherPage],
    );
    await pool.query(
      `insert into conversations (id,customer_id,page_id,last_message_at) values
        ($1,$3,$5,now()), ($2,$4,$6,now())`,
      [ids.convA, ids.convB, ids.custA, ids.custB, ids.page, ids.otherPage],
    );
  });

  /* ============================================================== */
  describe('🔴 ทุกคอลัมน์ที่โค้ดขอ ต้องมีอยู่จริง (กัน D-87 ซ้ำ)', () => {
    it('ไล่ตรวจ QUICK_ACTION_SELECTS กับ information_schema', async () => {
      /**
       * ตอนเขียนไฟล์ quick-actions เผลอเขียน `variants` / `base_price`
       * ซึ่งไม่มีอยู่จริง (ของจริงคือ `variant` / `price`)
       * เทสต์นี้คือด่านที่จับได้ก่อนหลุดไปเครื่องจริง
       */
      const missing: string[] = [];
      for (const { table, fields } of QUICK_ACTION_SELECTS) {
        const { rows } = await pool.query(
          `select column_name from information_schema.columns
            where table_schema='public' and table_name=$1`, [table],
        );
        const real = new Set(rows.map((r) => r.column_name as string));
        expect(real.size, `ไม่พบตาราง ${table}`).toBeGreaterThan(0);
        for (const col of fields.split(',').map((c) => c.trim()).filter(Boolean)) {
          if (!real.has(col)) missing.push(`${table}.${col}`);
        }
      }
      expect(missing, `คอลัมน์ที่โค้ดขอแต่ไม่มีจริง: ${missing.join(', ')}`).toEqual([]);
    });
  });

  /* ============================================================== */
  describe('พื้นที่ทำงานลูกค้า', () => {
    it('รวมข้อมูลลูกค้า + ออเดอร์ + บันทึก ไว้ที่เดียว', async () => {
      await makeOrder(ids.custA);
      await addNote(OWNER, ids.convA, 'ลูกค้ารายนี้ขอใบกำกับภาษี');

      const ws = await loadWorkspace(OWNER, ids.convA);
      expect(ws.customer.recipient_name).toBe('สมชาย ใจดี');
      expect(ws.orders).toHaveLength(1);
      expect(ws.notes).toHaveLength(1);
      expect(ws.notes[0].admin_name).toBe('เจ้าของ');
      expect(ws.page.name).toBe('เพจ A');
    });

    it('🔴 แอดมินที่ไม่มีสิทธิ์ดูเพจ เข้าห้องนั้นไม่ได้', async () => {
      await expect(loadWorkspace(who(ids.admin, 'admin', [ids.page]), ids.convB))
        .rejects.toBeInstanceOf(InboxAccessError);
    });

    it('ออเดอร์ที่แสดงต้องเป็นของลูกค้าคนนี้เท่านั้น', async () => {
      await makeOrder(ids.custA);
      await makeOrder(ids.custB);
      const ws = await loadWorkspace(OWNER, ids.convA);
      expect(ws.orders).toHaveLength(1);
    });
  });

  /* ============================================================== */
  describe('บันทึกภายใน', () => {
    it('🔴 ลบบันทึกข้ามลูกค้าไม่ได้', async () => {
      await addNote(OWNER, ids.convB, 'บันทึกของลูกค้า B');
      const wsB = await loadWorkspace(OWNER, ids.convB);
      const noteOfB = wsB.notes[0].id;

      // พยายามลบจากห้อง A
      await deleteNote(OWNER, ids.convA, noteOfB);

      // ต้องยังอยู่ครบ
      expect((await loadWorkspace(OWNER, ids.convB)).notes).toHaveLength(1);
    });

    it('บันทึกว่างเปล่า → ปฏิเสธ', async () => {
      await expect(addNote(OWNER, ids.convA, '   ')).rejects.toThrow();
    });
  });

  /* ============================================================== */
  describe('⭐ ข้อมูลจัดส่ง — ค่าจริงจากฐานข้อมูล', () => {
    it('ข้อมูลครบ → ประกอบข้อความได้ และไม่มีอะไรขาด', async () => {
      await makeOrder(ids.custA, { carrier: 'Kerry', tracking: 'KE555' });
      const r = await composeShippingInfo(OWNER, ids.convA);

      expect(r.missing_th).toEqual([]);
      expect(r.text).toContain('สมชาย ใจดี');
      expect(r.text).toContain('0812345678');
      expect(r.text).toContain('KE555');
      expect(r.text).toContain('Kerry');
    });

    it('🔴 ลูกค้าที่ยังไม่มีที่อยู่ → ต้องบอกว่าขาด ไม่ประกอบข้อความครึ่ง ๆ กลาง ๆ', async () => {
      const r = await composeShippingInfo(OWNER, ids.convB);
      expect(r.missing_th).toContain('ที่อยู่');
      expect(r.missing_th).toContain('เบอร์โทร');
    });
  });

  /* ============================================================== */
  describe('⭐ สรุปออเดอร์', () => {
    it('ยอดทุกตัวมาจากออเดอร์จริง', async () => {
      await makeOrder(ids.custA, { total: 950 });
      const r = await composeOrderSummary(OWNER, ids.convA);
      expect(r.text).toContain('950 บาท');
      expect(r.text).toContain('เก็บเงินปลายทาง');
      expect(r.missing_th).toEqual([]);
    });

    it('🔴 ระบุ id ออเดอร์ของลูกค้าคนอื่น → ต้องไม่ได้ข้อมูล', async () => {
      /**
       * ถ้าไม่ตรวจ หน้าเว็บจะยัด id ออเดอร์ของลูกค้าคนอื่นมา
       * แล้วยอดเงินของคนอื่นจะถูกวางลงช่องพิมพ์ของห้องนี้
       */
      const orderOfB = await makeOrder(ids.custB, { total: 99999 });
      const r = await composeOrderSummary(OWNER, ids.convA, orderOfB);
      expect(r.text).toBe('');
      expect(r.missing_th).toContain('ออเดอร์');
    });

    it('🔴 ออเดอร์ที่ยกเลิกแล้ว ห้ามถูกหยิบมาเป็น "ล่าสุด"', async () => {
      /**
       * ไม่งั้นแอดมินจะส่งเลขพัสดุของออเดอร์ที่ถูกยกเลิกไปให้ลูกค้า
       */
      await makeOrder(ids.custA, { total: 500, at: new Date(Date.now() - 60_000) });
      await makeOrder(ids.custA, { total: 77777, status: 'cancelled', tracking: 'TH-ยกเลิก' });

      const r = await composeOrderSummary(OWNER, ids.convA);
      expect(r.text).toContain('500 บาท');
      expect(r.text).not.toContain('77,777');
    });

    it('ยังไม่มีออเดอร์เลย → บอกว่าขาด', async () => {
      const r = await composeOrderSummary(OWNER, ids.convA);
      expect(r.missing_th).toContain('ออเดอร์');
    });
  });

  /* ============================================================== */
  describe('⭐ แทรกสินค้า — ราคามาจากฐานข้อมูล', () => {
    it('ใช้ราคาจริง ไม่ใช่ราคาที่เบราว์เซอร์ส่งมา', async () => {
      const pid = randomUUID();
      await pool.query(
        `insert into products (id,name,variant,price,is_active) values ($1,'เสื้อยืด','ดำ',590,true)`,
        [pid],
      );
      const r = await composeProducts(OWNER, ids.convA, [pid]);
      expect(r.text).toContain('เสื้อยืด (ดำ)');
      expect(r.text).toContain('590 บาท');
    });

    it('สินค้าที่ปิดใช้งานแล้ว → ไม่ถูกหยิบมา', async () => {
      const pid = randomUUID();
      await pool.query(
        `insert into products (id,name,variant,price,is_active) values ($1,'ของเลิกขาย',null,100,false)`,
        [pid],
      );
      const r = await composeProducts(OWNER, ids.convA, [pid]);
      expect(r.missing_th).toContain('สินค้า');
    });
  });

  /* ============================================================== */
  describe('⭐ ชุดคำตอบ + ตัวแปร', () => {
    it('แทนค่าจากข้อมูลจริงได้ครบ', async () => {
      await makeOrder(ids.custA, { total: 950, tracking: 'TH777', carrier: 'Flash' });
      const r = await resolveCannedText(
        OWNER, ids.convA,
        'สวัสดีคุณ {{customer_name}} ออเดอร์ {{order_number}} ยอด {{order_total}} ส่งโดย {{carrier}} เลข {{tracking_number}}',
      );
      expect(r.text).toContain('คุณเอ');
      expect(r.text).toContain('950 บาท');
      expect(r.text).toContain('TH777');
      expect(r.text).toContain('Flash');
      expect(r.missing).toEqual([]);
    });

    it('🔴 ยังไม่มีออเดอร์ → ตัวแปรต้องคง {{...}} ไว้ และแจ้งว่าขาด', async () => {
      const r = await resolveCannedText(OWNER, ids.convA, 'เลขพัสดุ {{tracking_number}}');
      expect(r.text).toContain('{{tracking_number}}');
      expect(r.missing).toContain('tracking_number');
    });
  });

  /* ============================================================== */
  describe('ข้อ 1.5 — ร่องรอยว่าข้อมูลมาจากข้อความไหน', () => {
    it('บันทึกข้อมูลลูกค้าพร้อม id ข้อความต้นทาง', async () => {
      const msgId = randomUUID();
      await pool.query(
        `insert into messages (id,conversation_id,direction,sender_type,text)
         values ($1,$2,'in','customer','สมหญิง 0899999999 กรุงเทพ 10200')`,
        [msgId, ids.convA],
      );

      await updateCustomerContact(OWNER, ids.convA, { phone: '0899999999' }, msgId);

      const ws = await loadWorkspace(OWNER, ids.convA);
      expect(ws.customer.phone).toBe('0899999999');
      expect(ws.customer.contact_source_message_id).toBe(msgId);
      expect(ws.customer.contact_updated_at).not.toBeNull();
    });

    it('🔴 ยัด id ข้อความของห้องอื่นมา → ต้องไม่ถูกเก็บเป็นร่องรอย', async () => {
      const msgInB = randomUUID();
      await pool.query(
        `insert into messages (id,conversation_id,direction,sender_type,text)
         values ($1,$2,'in','customer','ข้อความห้อง B')`,
        [msgInB, ids.convB],
      );

      await updateCustomerContact(OWNER, ids.convA, { phone: '0811111111' }, msgInB);

      const ws = await loadWorkspace(OWNER, ids.convA);
      expect(ws.customer.phone).toBe('0811111111');
      expect(ws.customer.contact_source_message_id, 'ผูกข้อความข้ามห้องได้').toBeNull();
    });
  });
});
