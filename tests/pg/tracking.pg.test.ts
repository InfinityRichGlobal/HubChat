/**
 * ชุดทดสอบการนำเข้าเลขพัสดุกับ PostgreSQL จริง (รอบ 8)
 * ===========================================================================
 * ชุดนี้พิสูจน์สิ่งที่ฐานข้อมูลปลอมพิสูจน์ไม่ได้ และเป็นสิ่งที่ "ผิดแล้วแก้ไม่ได้" :
 *
 *   1. ⭐ นำเข้าไฟล์เดิมซ้ำ → ไม่เปลี่ยนอะไรซ้ำ ไม่แจ้งลูกค้าซ้ำ
 *   2. ⭐ กดยืนยันสองครั้งพร้อมกัน → ลงเลขพัสดุครั้งเดียว
 *   3. ⭐ ทับเลขพัสดุเดิมได้ แต่ต้องมีร่องรอยเสมอ
 *   4. ⭐ หนึ่งออเดอร์ต่อหนึ่งเหตุการณ์ แจ้งลูกค้าได้ครั้งเดียวตลอดกาล
 *   5. ⭐ Policy Engine ห้าม → ไม่ส่ง และจดว่า "ยังไม่ได้แจ้ง" ไม่ใช่ปลอมว่าสำเร็จ
 *   6. ⭐ งานอัตโนมัติใช้ HUMAN_AGENT ไม่ได้
 *   7. ⭐ ไม่ทราบผล → ไม่ลองใหม่ และถือว่าแจ้งแล้ว (ยอมส่งขาด ดีกว่าส่งซ้ำ)
 *   8. ⭐ normalize เบอร์ฝั่ง TypeScript ต้องคิดตรงกับฝั่งฐานข้อมูลเป๊ะ
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

const {
  createImport, applyImport, getImport, listImports, listImportRows, resolveRow, cancelImport,
  remapImport, DuplicateFileError, TrackingError,
} = await import('@/server/tracking/service');
const {
  runNotificationQueue, requestOrderNotification, runSingleNotification,
  getOrderNotifications, NotifyRefusedError, isQuietHours,
} = await import('@/server/tracking/notify');
const { setOrderTracking } = await import('@/server/orders/service');
const { normalizePhone } = await import('@/server/tracking/normalize');
const { __setFetcherForTests } = await import('@/server/meta/client');
const { encryptSecret } = await import('@/lib/crypto');
const { resetPolicyConfigCache } = await import('@/server/policy/config');

let pool: Pool;
let rest: RestServer;

const ids = {
  page: randomUUID(),
  owner: randomUUID(),
  admin: randomUUID(),
  customerA: randomUUID(),
  customerB: randomUUID(),
  convA: randomUUID(),
  convB: randomUUID(),
  orderA: randomUUID(),
  orderB: randomUUID(),
};

/** ลูกค้าทักมา 2 ชั่วโมงที่แล้ว = ยังอยู่ในกรอบ 24 ชม. จึงส่งได้ */
const RECENT = new Date(Date.now() - 2 * 3_600_000);
/** ลูกค้าเงียบไป 3 วัน = พ้นกรอบ Policy Engine ต้องปฏิเสธ */
const STALE = new Date(Date.now() - 72 * 3_600_000);

type Who = Parameters<typeof createImport>[0];

function who(id: string, role: 'owner' | 'admin'): Who {
  return {
    id,
    name: role === 'owner' ? 'เจ้าของ' : 'แอดมิน',
    email: `${id}@test.local`,
    role,
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
}

const OWNER = who(ids.owner, 'owner');
const ADMIN = who(ids.admin, 'admin');

const HEADER = 'เลขออเดอร์,เลขพัสดุ,ขนส่ง,ชื่อผู้รับ,เบอร์ผู้รับ,รหัสไปรษณีย์';

/** ไฟล์แต่ละครั้งต้องมีลายนิ้วมือต่างกัน ไม่งั้นจะชนกฎ "ไฟล์ซ้ำ" โดยไม่ตั้งใจ */
function csv(...lines: string[]): string {
  return [HEADER, ...lines].join('\n') + '\n';
}

/** Meta ปลอม — นับจำนวนครั้งที่ถูกยิงจริง */
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

/** ตัวเลือกที่ทำให้การส่งในเทสต์เร็วและไม่ติดกฎเวลาห้ามรบกวน */
const FAST = { ratePerMinute: 60_000, sleep: async () => {}, ignoreQuietHours: true };

/* ================================================================== */
describe.skipIf(!available)('PostgreSQL จริง — นำเข้าเลขพัสดุ + แจ้งลูกค้า', () => {
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
    resetPolicyConfigCache();
    __setFetcherForTests(null);

    await pool.query('truncate fulfillment_notifications, tracking_import_rows cascade');
    await pool.query('delete from tracking_imports');
    await pool.query('truncate send_attempts, message_sends, conversation_policy_state cascade');
    await pool.query('delete from order_logs');
    await pool.query('delete from orders');
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');
    await pool.query('delete from admins');

    await pool.query(
      `insert into admins (id, name, email, password_hash, role)
       values ($1,'เจ้าของ','owner@test.local','x','owner'),
              ($2,'แอดมิน','admin@test.local','x','admin')`,
      [ids.owner, ids.admin],
    );

    await pool.query(
      `insert into pages (id, platform, page_id, page_name, access_token, is_active)
       values ($1,'facebook','111111','เพจทดสอบ',$2,true)`,
      [ids.page, encryptSecret('EAA-fake-token')],
    );

    await pool.query(
      `insert into customers (id, page_id, psid, platform, name, phone, last_customer_message_at)
       values ($1,$2,'psid-a','facebook','คุณสมชาย','0812345678',$4),
              ($3,$2,'psid-b','facebook','คุณมาลี','0898765432',$4)`,
      [ids.customerA, ids.page, ids.customerB, RECENT.toISOString()],
    );

    await pool.query(
      `insert into conversations (id, customer_id, page_id, last_message_at, last_customer_message_at)
       values ($1,$2,$4, now(), $5), ($3,$6,$4, now(), $5)`,
      [ids.convA, ids.customerA, ids.convB, ids.page, RECENT.toISOString(), ids.customerB],
    );

    await pool.query(
      `insert into orders (id, order_no, conversation_id, customer_id, page_id,
                           recipient_name, phone, postcode, status, total)
       values ($1,'ORD-260823-001',$2,$3,$4,'คุณสมชาย','081-234-5678','10230','confirmed',500),
              ($5,'ORD-260823-002',$6,$7,$4,'คุณมาลี','0898765432','50000','confirmed',700)`,
      [ids.orderA, ids.convA, ids.customerA, ids.page, ids.orderB, ids.convB, ids.customerB],
    );
  });

  /* ============================================================== */
  /* A) normalize ต้องคิดตรงกันสองฝั่ง                                */
  /* ============================================================== */
  it('⭐ normalize เบอร์ฝั่ง TypeScript กับฝั่งฐานข้อมูล ต้องได้ผลเดียวกันทุกค่า', async () => {
    /**
     * 🔴 ถ้าสองที่คิดไม่ตรงกัน จะเกิดอาการที่หาสาเหตุยากที่สุด :
     *    "preview บอกจับคู่ได้ แต่พอกดลงจริงกลับไม่เจอออเดอร์"
     */
    const samples = [
      '0812345678', '081-234-5678', '081 234 5678', '(081) 234-5678',
      '66812345678', '+66812345678', '812345678', '912345678', '612345678',
      '021234567', '02-123-4567', 'abc', '', '123', '081234567890123',
    ];

    for (const v of samples) {
      const { rows } = await pool.query('select normalize_phone_th($1) as out', [v]);
      const fromSql: string | null = rows[0].out;
      expect(normalizePhone(v), `ค่าที่ไม่ตรงกัน: "${v}"`).toBe(fromSql);
    }
  });

  it('trigger เติม phone_normalized ให้ออเดอร์เองทุกครั้งที่เบอร์เปลี่ยน', async () => {
    const before = await pool.query('select phone_normalized from orders where id=$1', [ids.orderA]);
    expect(before.rows[0].phone_normalized).toBe('0812345678');

    await pool.query('update orders set phone = $2 where id = $1', [ids.orderA, '+66 89 876 5432']);
    const after = await pool.query('select phone_normalized from orders where id=$1', [ids.orderA]);
    expect(after.rows[0].phone_normalized).toBe('0898765432');
  });

  /* ============================================================== */
  /* B) นำเข้า + จับคู่                                              */
  /* ============================================================== */
  it('⭐ จับคู่ด้วยเลขออเดอร์และเบอร์ได้ และ preview บอกทุกหมวดชัดเจน', async () => {
    const result = await createImport(OWNER, {
      filename: 'flash.csv',
      content: csv(
        'ORD-260823-001,TH1111111111,flash,คุณสมชาย,081-234-5678,10230',
        ',TH2222222222,flash,คุณมาลี,0898765432,50000',
        ',TH3333333333,flash,ไม่รู้จัก,0700000000,99999',
      ),
    });

    expect(result.summary.total).toBe(3);
    expect(result.summary.auto).toBe(2);
    expect(result.summary.unmatched).toBe(1);

    const rows = await listImportRows(result.import_id);
    expect(rows[0].match_method).toBe('order_ref');
    expect(rows[1].match_method).toBe('phone');
    expect(rows[2].match_status).toBe('unmatched');
  });

  it('🔴 ออเดอร์ไม่พบ = รายงานชัด ไม่ใช่เงียบ ๆ', async () => {
    const result = await createImport(OWNER, {
      filename: 'x.csv',
      content: csv('ORD-999999-999,TH9999999999,flash,ใคร,0700000000,99999'),
    });
    const rows = await listImportRows(result.import_id);
    expect(rows[0].match_status).toBe('unmatched');
    expect(rows[0].note_th).toContain('ไม่เจอ');
  });

  it('🔴 ไฟล์ที่ไม่มีคอลัมน์ที่จำเป็น = ปฏิเสธทั้งไฟล์ ไม่ใช่รับไปแล้วพังทีหลัง', async () => {
    await expect(
      createImport(OWNER, { filename: 'bad.csv', content: 'ชื่อผู้รับ,ที่อยู่\nสมชาย,กรุงเทพ\n' }),
    ).rejects.toThrow(TrackingError);
  });

  it('🔴 ไฟล์พัง = TrackingError ที่อ่านรู้เรื่อง ไม่ใช่ระบบล้ม', async () => {
    await expect(createImport(OWNER, { filename: 'e.csv', content: '' })).rejects.toThrow(TrackingError);
    await expect(
      createImport(OWNER, { filename: 'e.csv', content: csv('"เปิดไม่ปิด,TH1,flash,ก,0812345678,10230') }),
    ).rejects.toThrow(TrackingError);
  });

  it('แถวซ้ำในไฟล์เดียวกัน = ตัวแรกชนะ ตัวหลังถูกข้าม (ผลเหมือนเดิมทุกครั้ง)', async () => {
    const line = 'ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230';
    const result = await createImport(OWNER, { filename: 'dup.csv', content: csv(line, line) });

    const rows = await listImportRows(result.import_id);
    expect(rows[0].match_status).toBe('auto');
    expect(rows[1].match_status).toBe('skipped');
    expect(rows[1].note_th).toContain('ซ้ำกับแถวที่ 1');
  });

  it('🔴 ไฟล์เดิมอัปโหลดซ้ำ = บอกว่าเคยทำแล้ว พร้อมชี้ไปที่รอบเดิม', async () => {
    const content = csv('ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230');
    const first = await createImport(OWNER, { filename: 'a.csv', content });

    // เปลี่ยนชื่อไฟล์ก็ยังจับได้ เพราะคิดจากเนื้อไฟล์
    await expect(createImport(OWNER, { filename: 'ชื่ออื่น.csv', content })).rejects.toThrow(
      DuplicateFileError,
    );

    try {
      await createImport(OWNER, { filename: 'b.csv', content });
    } catch (err) {
      expect((err as InstanceType<typeof DuplicateFileError>).import_id).toBe(first.import_id);
    }
  });

  it('ยกเลิกรอบแล้ว อัปโหลดไฟล์เดิมใหม่ได้ (ลายนิ้วมือถูกปล่อยคืน)', async () => {
    const content = csv('ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230');
    const first = await createImport(OWNER, { filename: 'a.csv', content });
    await cancelImport(OWNER, first.import_id);

    const again = await createImport(OWNER, { filename: 'a.csv', content });
    expect(again.import_id).not.toBe(first.import_id);
  });

  /* ============================================================== */
  /* C) ลงเลขพัสดุจริง                                               */
  /* ============================================================== */
  it('⭐ ลงเลขพัสดุแล้วออเดอร์เปลี่ยนสถานะเป็น "ส่งแล้ว" พร้อมร่องรอยครบ', async () => {
    const result = await createImport(OWNER, {
      filename: 'apply.csv',
      content: csv('ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230'),
    });
    const applied = await applyImport(OWNER, result.import_id, { notify_mode: 'none' });

    expect(applied.applied_count).toBe(1);

    const { rows } = await pool.query(
      `select tracking_no, shipping_carrier, status, shipped_at,
              tracking_source, tracking_updated_by, tracking_import_id
         from orders where id = $1`,
      [ids.orderA],
    );
    expect(rows[0].tracking_no).toBe('TH1111111111');
    expect(rows[0].shipping_carrier).toBe('flash');
    expect(rows[0].status).toBe('shipped');
    expect(rows[0].shipped_at).not.toBeNull();
    expect(rows[0].tracking_source).toBe('import');
    expect(rows[0].tracking_updated_by).toBe(ids.owner);
    expect(rows[0].tracking_import_id).toBe(result.import_id);

    // ⭐ ประวัติต้องมีเสมอ
    const logs = await pool.query(
      `select action, before, after from order_logs where order_id = $1 order by created_at`,
      [ids.orderA],
    );
    expect(logs.rows.some((l) => l.action === 'tracking_import')).toBe(true);
  });

  it('⭐ เลขพัสดุเดิมเหมือนกันเป๊ะ = ไม่แตะอะไรเลย (noop)', async () => {
    const content = csv('ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230');
    const first = await createImport(OWNER, { filename: 'a.csv', content });
    await applyImport(OWNER, first.import_id, { notify_mode: 'none' });

    const beforeLogs = await pool.query('select count(*)::int n from order_logs where order_id=$1', [ids.orderA]);

    // ไฟล์คนละไฟล์ แต่ข้อมูลเดิม
    const second = await createImport(OWNER, {
      filename: 'b.csv',
      content: content + '\n',
    });
    const applied = await applyImport(OWNER, second.import_id, { notify_mode: 'none' });

    expect(applied.noop_count).toBe(1);
    expect(applied.applied_count).toBe(0);

    const afterLogs = await pool.query('select count(*)::int n from order_logs where order_id=$1', [ids.orderA]);
    expect(afterLogs.rows[0].n).toBe(beforeLogs.rows[0].n);
  });

  it('🔴 เลขพัสดุใหม่ต่างจากเดิม = ทับได้ แต่ต้องเก็บค่าเดิมไว้ตรวจย้อนหลัง', async () => {
    const first = await createImport(OWNER, {
      filename: 'a.csv',
      content: csv('ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230'),
    });
    await applyImport(OWNER, first.import_id, { notify_mode: 'none' });

    const second = await createImport(OWNER, {
      filename: 'b.csv',
      content: csv('ORD-260823-001,TH2222222222,flash,คุณสมชาย,0812345678,10230'),
    });
    const applied = await applyImport(OWNER, second.import_id, { notify_mode: 'none' });
    expect(applied.applied_count).toBe(1);

    const rows = await listImportRows(second.import_id);
    expect(rows[0].prev_tracking_no).toBe('TH1111111111');
    expect(rows[0].note_th).toContain('TH1111111111');
    expect(rows[0].note_th).toContain('TH2222222222');

    const order = await pool.query('select tracking_no from orders where id=$1', [ids.orderA]);
    expect(order.rows[0].tracking_no).toBe('TH2222222222');

    // ⭐ ประวัติเดิมต้องไม่หาย — ต้องมีทั้งสองครั้ง
    const logs = await pool.query(
      `select before->>'tracking_no' as prev, after->>'tracking_no' as next
         from order_logs where order_id=$1 and action='tracking_import' order by created_at`,
      [ids.orderA],
    );
    expect(logs.rows).toHaveLength(2);
    expect(logs.rows[0].next).toBe('TH1111111111');
    expect(logs.rows[1].prev).toBe('TH1111111111');
    expect(logs.rows[1].next).toBe('TH2222222222');
  });

  it('🔴 ออเดอร์ที่ถูกยกเลิก = ข้าม พร้อมเหตุผล ไม่ใส่เลขพัสดุให้', async () => {
    await pool.query(`update orders set status='cancelled' where id=$1`, [ids.orderA]);

    const result = await createImport(OWNER, {
      filename: 'c.csv',
      content: csv('ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230'),
    });
    const applied = await applyImport(OWNER, result.import_id, { notify_mode: 'none' });

    expect(applied.skipped_count).toBe(1);
    const order = await pool.query('select tracking_no from orders where id=$1', [ids.orderA]);
    expect(order.rows[0].tracking_no).toBeNull();
  });

  it('⭐ partial failure : แถวดีสำเร็จ แถวเสียรายงานชัด', async () => {
    const result = await createImport(OWNER, {
      filename: 'mixed.csv',
      content: csv(
        'ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230',
        'ORD-999999-999,TH2222222222,flash,ไม่มีใบนี้,0700000000,99999',
        'ORD-260823-002,,flash,คุณมาลี,0898765432,50000',
      ),
    });
    const applied = await applyImport(OWNER, result.import_id, { notify_mode: 'none' });

    expect(applied.applied_count).toBe(1);
    expect(applied.skipped_count).toBe(2);
    expect(applied.failed_count).toBe(0);

    const a = await pool.query('select tracking_no from orders where id=$1', [ids.orderA]);
    expect(a.rows[0].tracking_no).toBe('TH1111111111');
    const b = await pool.query('select tracking_no from orders where id=$1', [ids.orderB]);
    expect(b.rows[0].tracking_no).toBeNull();
  });

  it('⭐ 100 แถว ประมวลผลได้เสถียร และตัวเลขสรุปตรงกับของจริง', async () => {
    // สร้างออเดอร์เพิ่มอีก 100 ใบ
    const orderIds: string[] = [];
    const lines: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      const oid = randomUUID();
      orderIds.push(oid);
      const no = `ORD-260824-${String(i).padStart(3, '0')}`;
      await pool.query(
        `insert into orders (id, order_no, conversation_id, customer_id, page_id,
                             recipient_name, phone, postcode, status, total)
         values ($1,$2,$3,$4,$5,'ลูกค้า','0812345678','10230','confirmed',100)`,
        [oid, no, ids.convA, ids.customerA, ids.page],
      );
      lines.push(`${no},TH${String(i).padStart(10, '0')},flash,ลูกค้า,,10230`);
    }

    const result = await createImport(OWNER, { filename: 'bulk.csv', content: csv(...lines) });
    expect(result.summary.total).toBe(100);
    expect(result.summary.auto).toBe(100);

    const applied = await applyImport(OWNER, result.import_id, { notify_mode: 'none' });
    expect(applied.applied_count).toBe(100);

    const { rows } = await pool.query(
      `select count(*)::int n from orders where tracking_no is not null and id = any($1::uuid[])`,
      [orderIds],
    );
    expect(rows[0].n).toBe(100);
  }, 60_000);

  /* ============================================================== */
  /* D) กันกดซ้ำ / นำเข้าซ้ำ                                          */
  /* ============================================================== */
  it('🔴 กดยืนยันสองครั้งพร้อมกัน → ลงเลขพัสดุครั้งเดียว', async () => {
    const result = await createImport(OWNER, {
      filename: 'race.csv',
      content: csv('ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230'),
    });

    const [a, b] = await Promise.allSettled([
      applyImport(OWNER, result.import_id, { notify_mode: 'none' }),
      applyImport(OWNER, result.import_id, { notify_mode: 'none' }),
    ]);

    const wins = [a, b].filter((r) => r.status === 'fulfilled');
    expect(wins).toHaveLength(1);

    const logs = await pool.query(
      `select count(*)::int n from order_logs where order_id=$1 and action='tracking_import'`,
      [ids.orderA],
    );
    expect(logs.rows[0].n).toBe(1);
  });

  it('🔴 กดยืนยันซ้ำหลังลงไปแล้ว = ปฏิเสธ ไม่ใช่ลงซ้ำ', async () => {
    const result = await createImport(OWNER, {
      filename: 'twice.csv',
      content: csv('ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230'),
    });
    await applyImport(OWNER, result.import_id, { notify_mode: 'none' });
    await expect(applyImport(OWNER, result.import_id, { notify_mode: 'none' })).rejects.toThrow(
      /ลงเลขพัสดุไปแล้ว/,
    );
  });

  it('แถวที่ลงไปแล้ว แก้การจับคู่ย้อนหลังไม่ได้ (ตัวเลขสรุปต้องตรงกับของจริงเสมอ)', async () => {
    const result = await createImport(OWNER, {
      filename: 'lock.csv',
      content: csv('ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230'),
    });
    await applyImport(OWNER, result.import_id, { notify_mode: 'none' });

    const rows = await listImportRows(result.import_id);
    await expect(
      resolveRow(OWNER, result.import_id, rows[0].id, { action: 'choose', order_id: ids.orderB }),
    ).rejects.toThrow(/ลงเลขพัสดุไปแล้ว/);
  });

  it('แอดมินเลือกออเดอร์ให้แถวที่จับคู่ไม่ได้ แล้วลงได้ปกติ', async () => {
    const result = await createImport(OWNER, {
      filename: 'manual.csv',
      content: csv(',TH1111111111,flash,ไม่รู้จัก,0700000000,99999'),
    });
    const rows = await listImportRows(result.import_id);
    expect(rows[0].match_status).toBe('unmatched');

    const fixed = await resolveRow(OWNER, result.import_id, rows[0].id, {
      action: 'choose',
      order_id: ids.orderA,
    });
    expect(fixed.match_status).toBe('manual');

    const applied = await applyImport(OWNER, result.import_id, { notify_mode: 'none' });
    expect(applied.applied_count).toBe(1);
  });

  it('แอดมินสั่งข้ามแถว = ไม่แตะออเดอร์', async () => {
    const result = await createImport(OWNER, {
      filename: 'skip.csv',
      content: csv('ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230'),
    });
    const rows = await listImportRows(result.import_id);
    await resolveRow(OWNER, result.import_id, rows[0].id, { action: 'skip' });

    const applied = await applyImport(OWNER, result.import_id, { notify_mode: 'none' });
    expect(applied.skipped_count).toBe(1);
    const order = await pool.query('select tracking_no from orders where id=$1', [ids.orderA]);
    expect(order.rows[0].tracking_no).toBeNull();
  });

  /* ============================================================== */
  /* E) แจ้งลูกค้า                                                    */
  /* ============================================================== */
  async function importAndApply(trackingNo = 'TH1111111111') {
    const result = await createImport(OWNER, {
      filename: `n-${trackingNo}.csv`,
      content: csv(`ORD-260823-001,${trackingNo},flash,คุณสมชาย,0812345678,10230`),
    });
    await applyImport(OWNER, result.import_id, { notify_mode: 'prepare' });
    return result.import_id;
  }

  it('⭐ แจ้งลูกค้าสำเร็จ → จดครบ และออเดอร์รู้ว่าแจ้งแล้ว', async () => {
    const meta = fakeMeta(() => okResponse('mid.1'));
    const importId = await importAndApply();

    const summary = await runNotificationQueue(ids.owner, importId, FAST);

    expect(summary.sent).toBe(1);
    expect(meta.calls).toBe(1);

    const notifications = await getOrderNotifications(ids.orderA);
    expect(notifications[0].status).toBe('sent');
    expect(notifications[0].message_text).toContain('TH1111111111');
    expect(notifications[0].message_text).toContain('ORD-260823-001');

    const order = await pool.query(
      'select tracking_notified_at, tracking_notify_status from orders where id=$1',
      [ids.orderA],
    );
    expect(order.rows[0].tracking_notified_at).not.toBeNull();
    expect(order.rows[0].tracking_notify_status).toBe('sent');
  });

  it('🔴 หนึ่งออเดอร์ต่อหนึ่งเหตุการณ์ ส่งได้ครั้งเดียว — รันคิวซ้ำต้องไม่ยิงเพิ่ม', async () => {
    const meta = fakeMeta(() => okResponse('mid.1'));
    const importId = await importAndApply();

    await runNotificationQueue(ids.owner, importId, FAST);
    const second = await runNotificationQueue(ids.owner, importId, FAST);

    expect(meta.calls).toBe(1);
    expect(second.sent).toBe(0);
    expect(second.attempted).toBe(0);
  });

  it('🔴 นำเข้าไฟล์ใหม่ที่ชี้ออเดอร์เดิม ต้องไม่แจ้งลูกค้าซ้ำ', async () => {
    const meta = fakeMeta(() => okResponse('mid.1'));
    const first = await importAndApply('TH1111111111');
    await runNotificationQueue(ids.owner, first, FAST);
    expect(meta.calls).toBe(1);

    // ไฟล์ใหม่ เลขพัสดุใหม่ ออเดอร์เดิม
    const second = await importAndApply('TH2222222222');
    const summary = await runNotificationQueue(ids.owner, second, FAST);

    // ⭐ unique (order_id,event) กันไว้ — ไม่มีงานใหม่เข้าคิวเลย
    expect(summary.attempted).toBe(0);
    expect(meta.calls).toBe(1);
  });

  it('🔴 คิวสองตัวรันพร้อมกัน ต้องยิง Meta ครั้งเดียว', async () => {
    const meta = fakeMeta(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return okResponse('mid.1');
    });
    const importId = await importAndApply();

    await Promise.all([
      runNotificationQueue(ids.owner, importId, FAST),
      runNotificationQueue(ids.owner, importId, FAST),
    ]);

    expect(meta.calls).toBe(1);
  });

  it('🔴 Policy Engine ไม่อนุญาต → ไม่ส่ง และจดว่ายังไม่ได้แจ้ง ไม่ใช่ปลอมว่าสำเร็จ', async () => {
    // ลูกค้าเงียบไป 3 วัน = พ้นกรอบ 24 ชม.
    await pool.query('update conversations set last_customer_message_at = $2 where id = $1', [
      ids.convA, STALE.toISOString(),
    ]);
    await pool.query('update customers set last_customer_message_at = $2 where id = $1', [
      ids.customerA, STALE.toISOString(),
    ]);

    const meta = fakeMeta(() => okResponse('mid.1'));
    const importId = await importAndApply();

    const summary = await runNotificationQueue(ids.owner, importId, FAST);

    expect(summary.blocked).toBe(1);
    expect(summary.sent).toBe(0);
    expect(meta.calls).toBe(0); // ⭐ ไม่ยิงออกไปเลย

    const notifications = await getOrderNotifications(ids.orderA);
    expect(notifications[0].status).toBe('blocked');
    expect(notifications[0].policy_reason_th).toBeTruthy();

    const order = await pool.query(
      'select tracking_notified_at, tracking_notify_status from orders where id=$1',
      [ids.orderA],
    );
    expect(order.rows[0].tracking_notified_at).toBeNull();
    expect(order.rows[0].tracking_notify_status).toBe('blocked');
  });

  it('🔴 งานเป็นชุดต้องไม่มีวันได้ HUMAN_AGENT (ต่อให้พ้นกรอบก็ห้ามใช้)', async () => {
    await pool.query('update conversations set last_customer_message_at = $2 where id = $1', [
      ids.convA, STALE.toISOString(),
    ]);
    await pool.query('update customers set last_customer_message_at = $2 where id = $1', [
      ids.customerA, STALE.toISOString(),
    ]);

    fakeMeta(() => okResponse('mid.1'));
    const importId = await importAndApply();
    await runNotificationQueue(ids.owner, importId, FAST);

    const attempts = await pool.query(
      `select selected_transport, triggered_by from send_attempts order by created_at`,
    );
    for (const a of attempts.rows) {
      expect(a.selected_transport).not.toBe('HUMAN_AGENT');
    }

    const notifications = await getOrderNotifications(ids.orderA);
    expect(notifications[0].selected_transport).not.toBe('HUMAN_AGENT');
  });

  it('🔴 ไม่ทราบผล → ไม่ลองใหม่ และถือว่าแจ้งแล้ว (ยอมส่งขาด ดีกว่าส่งซ้ำ)', async () => {
    const meta = fakeMeta(() => {
      throw new Error('network down');
    });
    const importId = await importAndApply();

    const summary = await runNotificationQueue(ids.owner, importId, FAST);

    expect(summary.unknown).toBe(1);
    expect(meta.calls).toBe(1); // ยิงครั้งเดียว ไม่ retry

    const notifications = await getOrderNotifications(ids.orderA);
    expect(notifications[0].status).toBe('unknown');
    expect(notifications[0].outcome_unknown).toBe(true);

    // ⭐ ต้องถือว่าแจ้งแล้ว ไม่งั้นรอบหน้าจะส่งซ้ำ
    const order = await pool.query(
      'select tracking_notified_at, tracking_notify_status from orders where id=$1',
      [ids.orderA],
    );
    expect(order.rows[0].tracking_notified_at).not.toBeNull();
    expect(order.rows[0].tracking_notify_status).toBe('sent');

    // รันคิวอีกครั้งต้องไม่ยิงเพิ่ม
    await runNotificationQueue(ids.owner, importId, FAST);
    expect(meta.calls).toBe(1);
  });

  it('เพดานต่อการกดหนึ่งครั้ง + คืน remaining ให้กดต่อ', async () => {
    fakeMeta(() => okResponse('mid.x'));

    // สร้าง 3 ออเดอร์ที่พร้อมแจ้ง
    const lines: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const oid = randomUUID();
      const no = `ORD-260825-${String(i).padStart(3, '0')}`;
      await pool.query(
        `insert into orders (id, order_no, conversation_id, customer_id, page_id,
                             recipient_name, phone, postcode, status, total)
         values ($1,$2,$3,$4,$5,'ลูกค้า','0812345678','10230','confirmed',100)`,
        [oid, no, ids.convA, ids.customerA, ids.page],
      );
      lines.push(`${no},TH${String(i).padStart(10, '5')},flash,ลูกค้า,,10230`);
    }
    const result = await createImport(OWNER, { filename: 'many.csv', content: csv(...lines) });
    await applyImport(OWNER, result.import_id, { notify_mode: 'prepare' });

    const first = await runNotificationQueue(ids.owner, result.import_id, { ...FAST, limit: 2 });
    expect(first.sent).toBe(2);
    expect(first.remaining).toBe(1);

    const second = await runNotificationQueue(ids.owner, result.import_id, FAST);
    expect(second.sent).toBe(1);
    expect(second.remaining).toBe(0);
  });

  it('⭐ ช่วงเวลาห้ามรบกวน = ไม่ส่ง แต่คิวยังอยู่ครบ ไม่ใช่ทิ้งงาน', async () => {
    const meta = fakeMeta(() => okResponse('mid.1'));
    const importId = await importAndApply();

    // 23:00 เวลาไทย
    const night = new Date('2026-08-23T16:00:00Z');
    expect(isQuietHours(night)).toBe(true);

    const summary = await runNotificationQueue(ids.owner, importId, {
      ratePerMinute: 60_000,
      sleep: async () => {},
      now: night,
    });

    expect(summary.quiet_hours).toBe(true);
    expect(summary.sent).toBe(0);
    expect(summary.remaining).toBe(1);
    expect(meta.calls).toBe(0);

    // ส่งตอนเช้าได้ปกติ
    const morning = new Date('2026-08-23T03:00:00Z'); // 10:00 ไทย
    expect(isQuietHours(morning)).toBe(false);
    const later = await runNotificationQueue(ids.owner, importId, {
      ratePerMinute: 60_000, sleep: async () => {}, now: morning,
    });
    expect(later.sent).toBe(1);
  });

  it('ออเดอร์ที่ไม่มีห้องแชท = ข้าม พร้อมเหตุผล ไม่ใช่ล้ม', async () => {
    await pool.query('update orders set conversation_id = null where id = $1', [ids.orderA]);
    const importId = await importAndApply();

    // ไม่มีห้องแชท จึงไม่ควรถูกเข้าคิวตั้งแต่แรก
    const view = await getImport(OWNER, importId);
    expect(view.queued_count).toBe(0);

    const summary = await runNotificationQueue(ids.owner, importId, FAST);
    expect(summary.attempted).toBe(0);
  });

  /* ============================================================== */
  /* F) แจ้งทีละใบจากหน้าออเดอร์                                       */
  /* ============================================================== */
  it('ใส่เลขพัสดุเองทีละใบ แล้วแจ้งลูกค้าได้', async () => {
    const meta = fakeMeta(() => okResponse('mid.manual'));

    const order = await setOrderTracking(OWNER, ids.orderA, {
      tracking_no: 'TH9999999999',
      carrier: 'kerry',
    });
    expect(order.tracking_no).toBe('TH9999999999');
    expect(order.tracking_source).toBe('manual');
    expect(order.status).toBe('shipped');

    const queued = await requestOrderNotification({
      order_id: ids.orderA, admin_id: ids.owner, is_owner: true,
    });
    const summary = await runSingleNotification(queued.notification_id, ids.owner, FAST);

    expect(summary.sent).toBe(1);
    expect(meta.calls).toBe(1);
  });

  it('🔴 ยังไม่มีเลขพัสดุ = แจ้งไม่ได้', async () => {
    await expect(
      requestOrderNotification({ order_id: ids.orderA, admin_id: ids.owner, is_owner: true }),
    ).rejects.toThrow(NotifyRefusedError);
  });

  it('🔴 แจ้งไปแล้ว → แอดมินธรรมดาส่งซ้ำไม่ได้', async () => {
    fakeMeta(() => okResponse('mid.1'));
    await setOrderTracking(OWNER, ids.orderA, { tracking_no: 'TH9999999999', carrier: 'flash' });
    const q = await requestOrderNotification({
      order_id: ids.orderA, admin_id: ids.owner, is_owner: true,
    });
    await runSingleNotification(q.notification_id, ids.owner, FAST);

    await expect(
      requestOrderNotification({ order_id: ids.orderA, admin_id: ids.admin, is_owner: false }),
    ).rejects.toThrow(/เจ้าของร้าน/);
  });

  it('🔴 ครั้งก่อน "ไม่ทราบผล" → ต้องติ๊กยอมรับความเสี่ยงก่อนถึงจะส่งซ้ำได้', async () => {
    fakeMeta(() => {
      throw new Error('network down');
    });
    await setOrderTracking(OWNER, ids.orderA, { tracking_no: 'TH9999999999', carrier: 'flash' });
    const q = await requestOrderNotification({
      order_id: ids.orderA, admin_id: ids.owner, is_owner: true,
    });
    await runSingleNotification(q.notification_id, ids.owner, FAST);

    const notes = await getOrderNotifications(ids.orderA);
    expect(notes[0].status).toBe('unknown');

    // เจ้าของร้านแต่ไม่ได้ติ๊กยอมรับ = ยังส่งซ้ำไม่ได้
    await expect(
      requestOrderNotification({ order_id: ids.orderA, admin_id: ids.owner, is_owner: true }),
    ).rejects.toThrow(/ไม่ทราบผล/);

    // ติ๊กยอมรับแล้ว = ได้เหตุการณ์ใหม่ ประวัติเดิมยังอยู่
    const again = await requestOrderNotification({
      order_id: ids.orderA,
      admin_id: ids.owner,
      is_owner: true,
      acknowledged_duplicate_risk: true,
    });
    expect(again.event).not.toBe('shipping_update');

    const all = await getOrderNotifications(ids.orderA);
    expect(all).toHaveLength(2);
    expect(all.some((n) => n.status === 'unknown')).toBe(true);
  });

  it('ครั้งก่อนถูก Policy บล็อก → ส่งซ้ำได้เลย (รู้แน่ว่าไม่ถึงลูกค้า)', async () => {
    await pool.query('update conversations set last_customer_message_at = $2 where id = $1', [
      ids.convA, STALE.toISOString(),
    ]);
    await pool.query('update customers set last_customer_message_at = $2 where id = $1', [
      ids.customerA, STALE.toISOString(),
    ]);
    fakeMeta(() => okResponse('mid.1'));

    await setOrderTracking(OWNER, ids.orderA, { tracking_no: 'TH9999999999', carrier: 'flash' });
    const q = await requestOrderNotification({
      order_id: ids.orderA, admin_id: ids.owner, is_owner: true,
    });
    await runSingleNotification(q.notification_id, ids.owner, FAST);
    expect((await getOrderNotifications(ids.orderA))[0].status).toBe('blocked');

    // ลูกค้าทักกลับมา → ส่งได้แล้ว และไม่ต้องติ๊กอะไร
    await pool.query('update conversations set last_customer_message_at = now() where id = $1', [ids.convA]);
    await pool.query('update customers set last_customer_message_at = now() where id = $1', [ids.customerA]);

    const retry = await requestOrderNotification({
      order_id: ids.orderA, admin_id: ids.admin, is_owner: false,
    });
    const summary = await runSingleNotification(retry.notification_id, ids.admin, FAST);
    expect(summary.sent).toBe(1);
  });

  /* ============================================================== */
  /* G) ช่องโหว่ที่การตรวจสอบรอบสุดท้ายจับได้ (รอบ 8)                   */
  /* ============================================================== */

  it('🔴 เลขพัสดุเปลี่ยนหลังเข้าคิว → ต้องแจ้ง "ค่าล่าสุด" ไม่ใช่ค่าที่ถ่ายไว้ตอนเข้าคิว', async () => {
    /**
     * นี่คือบั๊กที่อันตรายที่สุดที่การตรวจสอบจับได้ :
     * ถ้าเชื่อสำเนาในคิว ลูกค้าจะได้เลขพัสดุของ "อีกกล่องหนึ่ง" ซึ่งเป็นของจริงที่มีอยู่
     * → ตามพัสดุผิดใบ และเราสืบไม่ได้ว่าเกิดจากอะไร
     */
    let sentText = '';
    __setFetcherForTests((async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentText = String(init?.body ?? '');
      return okResponse('mid.live');
    }) as typeof fetch);

    const importId = await importAndApply('TH1111111111');

    // แอดมินเห็นว่าเลขผิด แล้วแก้เองก่อนกดส่ง
    await setOrderTracking(OWNER, ids.orderA, { tracking_no: 'TH2222222222', carrier: 'kerry' });

    const summary = await runNotificationQueue(ids.owner, importId, FAST);
    expect(summary.sent).toBe(1);

    expect(sentText).toContain('TH2222222222');
    expect(sentText).not.toContain('TH1111111111');

    const notes = await getOrderNotifications(ids.orderA);
    expect(notes[0].message_text).toContain('TH2222222222');
  });

  it('🔴 ไฟล์เดียวมีสองแถวชี้ออเดอร์เดียวกัน → เตือน และแจ้งด้วยเลขล่าสุดใบเดียว', async () => {
    const result = await createImport(OWNER, {
      filename: 'multi.csv',
      content: csv(
        'ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230',
        'ORD-260823-001,TH2222222222,flash,คุณสมชาย,0812345678,10230',
      ),
    });

    const rows = await listImportRows(result.import_id);
    // แถวที่สองต้องมีคำเตือนว่าชี้ออเดอร์เดียวกับแถวแรก
    expect(rows[1].problems.some((p) => p.code === 'same_order_twice')).toBe(true);

    fakeMeta(() => okResponse('mid.multi'));
    await applyImport(OWNER, result.import_id, { notify_mode: 'prepare' });
    const summary = await runNotificationQueue(ids.owner, result.import_id, FAST);

    // ⭐ แจ้งครั้งเดียว และต้องเป็นเลขล่าสุดที่อยู่บนออเดอร์จริง
    expect(summary.sent).toBe(1);
    const order = await pool.query('select tracking_no from orders where id=$1', [ids.orderA]);
    const notes = await getOrderNotifications(ids.orderA);
    expect(notes[0].message_text).toContain(order.rows[0].tracking_no);
  });

  it('🔴 ความกำกวมต้องตัดสินจากออเดอร์ทั้งหมด ไม่ใช่เฉพาะเพจที่แอดมินเห็น', async () => {
    /**
     * เคยเป็นบั๊ก : กรองสิทธิ์ "ก่อน" จับคู่
     * ลูกค้าเบอร์เดียวมีสองออเดอร์คนละเพจ แอดมินที่เห็นเพจเดียวจะเหลือผู้สมัครใบเดียว
     * → ระบบบอก "แน่ใจ" ทั้งที่จริงกำกวม → เลขพัสดุลงผิดใบ
     */
    const otherPage = randomUUID();
    const otherCustomer = randomUUID();
    const otherOrder = randomUUID();

    await pool.query(
      `insert into pages (id, platform, page_id, page_name, access_token, is_active)
       values ($1,'facebook','222222','เพจที่สอง',$2,true)`,
      [otherPage, encryptSecret('EAA-fake-token')],
    );
    await pool.query(
      `insert into customers (id, page_id, psid, platform, name, phone)
       values ($1,$2,'psid-other','facebook','คุณสมชาย','0812345678')`,
      [otherCustomer, otherPage],
    );
    await pool.query(
      `insert into orders (id, order_no, customer_id, page_id, recipient_name, phone, postcode, status, total)
       values ($1,'ORD-260899-001',$2,$3,'คุณสมชาย','0812345678','10230','confirmed',100)`,
      [otherOrder, otherCustomer, otherPage],
    );

    // แอดมินคนนี้เห็นเฉพาะเพจแรก
    const scoped = { ...ADMIN, allowed_page_ids: [ids.page] };

    const result = await createImport(scoped, {
      filename: 'scoped.csv',
      content: csv(',TH1111111111,flash,คุณสมชาย,0812345678,10230'),
    });

    const rows = await listImportRows(result.import_id);
    // ⭐ ต้องไม่ใช่ auto — เพราะจริง ๆ แล้วเบอร์นี้มีสองใบ
    expect(rows[0].match_status).not.toBe('auto');
    expect(rows[0].matched_order_id).toBeNull();

    // และต้องไม่หลุดผู้สมัครของเพจที่ไม่มีสิทธิ์ออกไปให้เลือก
    expect(rows[0].candidate_order_ids).not.toContain(otherOrder);

    // ลงจริงแล้วต้องไม่มีออเดอร์ไหนได้เลขพัสดุไป
    const applied = await applyImport(scoped, result.import_id, { notify_mode: 'none' });
    expect(applied.applied_count).toBe(0);
  });

  it('🔴 แอดมินคนอื่นแตะรอบนำเข้าที่ไม่ใช่ของตัวเองไม่ได้', async () => {
    const result = await createImport(OWNER, {
      filename: 'mine.csv',
      content: csv('ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230'),
    });

    await expect(getImport(ADMIN, result.import_id)).rejects.toThrow(/แอดมินคนอื่น/);
    await expect(applyImport(ADMIN, result.import_id, { notify_mode: 'none' })).rejects.toThrow(
      /แอดมินคนอื่น/,
    );
    await expect(cancelImport(ADMIN, result.import_id)).rejects.toThrow(/แอดมินคนอื่น/);

    // และต้องไม่โผล่ในลิสต์ของเขาด้วย
    const visible = await listImports(ADMIN);
    expect(visible.map((v) => v.id)).not.toContain(result.import_id);

    // เจ้าของร้านยังทำได้ตามปกติ
    expect((await getImport(OWNER, result.import_id)).id).toBe(result.import_id);
  });

  it('⭐ แก้การจับคู่คอลัมน์แล้วแกะไฟล์ใหม่ได้ โดยไม่ต้องอัปโหลดซ้ำ', async () => {
    // ไฟล์ที่มีทั้งเบอร์ผู้ส่งและเบอร์ผู้รับ — ตั้งใจให้ระบบมีโอกาสเดาผิด
    const content =
      'เลขพัสดุ,เบอร์คนส่ง,เบอร์คนรับ\n' +
      'TH1111111111,0999999999,0812345678\n';

    const result = await createImport(OWNER, { filename: 'ambig.csv', content });

    // บังคับให้ใช้คอลัมน์ที่ถูกต้อง
    const remapped = await remapImport(OWNER, result.import_id, {
      tracking_no: 'เลขพัสดุ',
      phone: 'เบอร์คนรับ',
    });
    expect(remapped.summary.auto).toBe(1);

    const rows = await listImportRows(result.import_id);
    expect(rows).toHaveLength(1);
    expect(rows[0].matched_order_id).toBe(ids.orderA);
    expect(rows[0].phone_normalized).toBe('0812345678');

    // ลงได้ปกติหลังแก้
    const applied = await applyImport(OWNER, result.import_id, { notify_mode: 'none' });
    expect(applied.applied_count).toBe(1);
  });

  it('แก้การจับคู่คอลัมน์หลังลงเลขพัสดุไปแล้วไม่ได้', async () => {
    const result = await createImport(OWNER, {
      filename: 'locked.csv',
      content: csv('ORD-260823-001,TH1111111111,flash,คุณสมชาย,0812345678,10230'),
    });
    await applyImport(OWNER, result.import_id, { notify_mode: 'none' });

    await expect(
      remapImport(OWNER, result.import_id, { tracking_no: 'เลขพัสดุ', phone: 'เบอร์ผู้รับ' }),
    ).rejects.toThrow(/ลงเลขพัสดุ|ยกเลิก/);
  });

  it('🔴 งานที่ค้างสถานะ "กำลังส่ง" ต้องมีทางออก ไม่ค้างตลอดกาล', async () => {
    fakeMeta(() => okResponse('mid.x'));
    const importId = await importAndApply();

    // จำลองว่าโปรเซสตายหลังจองสิทธิ์ : ค้างที่ claimed มานานแล้ว
    await pool.query(
      `update fulfillment_notifications
          set status = 'claimed', claimed_at = now() - interval '30 minutes'
        where import_id = $1`,
      [importId],
    );

    // ⭐ รอบถัดไปต้องเก็บกวาดให้เป็น "ไม่ทราบผล" ไม่ใช่ปล่อยค้าง
    await runNotificationQueue(ids.owner, importId, FAST);

    const notes = await getOrderNotifications(ids.orderA);
    expect(notes[0].status).toBe('unknown');

    // และเจ้าของร้านต้องมีทางส่งซ้ำได้หลังตรวจ Messenger แล้ว
    await expect(
      requestOrderNotification({ order_id: ids.orderA, admin_id: ids.owner, is_owner: true }),
    ).rejects.toThrow(/ไม่ทราบผล/);

    const again = await requestOrderNotification({
      order_id: ids.orderA,
      admin_id: ids.owner,
      is_owner: true,
      acknowledged_duplicate_risk: true,
    });
    expect(again.created).toBe(true);
  });

  it('⭐ เพดานเวลาต่อรอบต้องพอดีกับเวลาที่ route มีให้', async () => {
    /**
     * เดิม MAX_PER_RUN = 60 → 59 ช่อง × 6 วินาที = 354 วินาที
     * แต่ route ตั้ง maxDuration = 300 → ถูกตัดกลางทางทุกครั้ง
     */
    const { MAX_PER_RUN, DEFAULT_RATE_PER_MINUTE, RUN_BUDGET_MS } = await import(
      '@/server/tracking/notify'
    );
    const gapMs = Math.ceil(60_000 / DEFAULT_RATE_PER_MINUTE);
    const worstCase = (MAX_PER_RUN - 1) * gapMs;
    expect(worstCase).toBeLessThanOrEqual(RUN_BUDGET_MS);
    expect(RUN_BUDGET_MS).toBeLessThan(300_000);
  });

  it('🔴 ออเดอร์ที่ยกเลิกแล้ว = ใส่เลขพัสดุเองไม่ได้ และแจ้งไม่ได้', async () => {
    await pool.query(`update orders set status='cancelled' where id=$1`, [ids.orderA]);
    await expect(
      setOrderTracking(OWNER, ids.orderA, { tracking_no: 'TH1', carrier: 'flash' }),
    ).rejects.toThrow(/ยกเลิก/);
  });
});
