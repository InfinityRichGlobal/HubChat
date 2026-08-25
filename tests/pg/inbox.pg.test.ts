/**
 * ชุดทดสอบหน้าอินบ็อกซ์กับ PostgreSQL จริง (รอบ 3B)
 * ===========================================================================
 * ชุดนี้พิสูจน์เรื่องที่ฐานข้อมูลปลอมพิสูจน์ไม่ได้ :
 *
 *   1. ⭐ แอดมิน 2 คนกดเข้าห้องเดียวกันพร้อมกัน → ได้ล็อกคนเดียวเท่านั้น
 *   2. ล็อกที่เงียบเกิน 3 นาที ถูกยึดต่อได้เอง ไม่ค้างถาวร
 *   3. ปล่อยล็อกของคนอื่นไม่ได้
 *   4. ⭐ สิทธิ์รายเพจถูกบังคับที่ชั้นข้อมูล ไม่ใช่ที่หน้าเว็บ
 *   5. ทำเครื่องหมายอ่านแล้ว ต้องไม่แตะ last_customer_message_at
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

const { acquireLock, releaseLock, listConversations, listMessages, markRead } = await import(
  '@/server/inbox/service'
);

let pool: Pool;
let rest: RestServer;

const ids = {
  pageA: randomUUID(),
  pageB: randomUUID(),
  owner: randomUUID(),
  adminA: randomUUID(),
  adminB: randomUUID(),
  customerA: randomUUID(),
  customerB: randomUUID(),
  convA: randomUUID(),
  convB: randomUUID(),
};

/** ลูกค้าทักมาเมื่อ 2 ชั่วโมงที่แล้ว — ค่านี้ห้ามถูกแก้โดยการกดอ่าน */
const CUSTOMER_MESSAGED_AT = new Date(Date.now() - 2 * 3_600_000);

type Who = Parameters<typeof acquireLock>[0];

function who(id: string, role: 'owner' | 'admin', allowed: string[] = []): Who {
  return {
    id,
    name: role === 'owner' ? 'เจ้าของ' : `แอดมิน ${id.slice(0, 4)}`,
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
const ADMIN_B = who(ids.adminB, 'admin', [ids.pageA]);

/* ================================================================== */
describe.skipIf(!available)('PostgreSQL จริง — หน้าอินบ็อกซ์', () => {
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
    await pool.query('delete from messages');
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');
    await pool.query('delete from admins');

    await pool.query(
      `insert into admins (id, name, email, password_hash, role)
       values ($1,'เจ้าของ','owner@test.local','x','owner'),
              ($2,'แอดมิน เอ','a@test.local','x','admin'),
              ($3,'แอดมิน บี','b@test.local','x','admin')`,
      [ids.owner, ids.adminA, ids.adminB],
    );

    await pool.query(
      `insert into pages (id, platform, page_id, page_name, display_name)
       values ($1,'facebook','1001','เพจ A','เพจหลัก'), ($2,'facebook','1002','เพจ B','เพจสำรอง')`,
      [ids.pageA, ids.pageB],
    );

    await pool.query(
      `insert into customers (id, page_id, psid, platform, name, phone, last_customer_message_at)
       values ($1,$2,'PSID_A','facebook','คุณเอ','0812345678',$5),
              ($3,$4,'PSID_B','facebook','คุณบี','0898765432',$5)`,
      [ids.customerA, ids.pageA, ids.customerB, ids.pageB, CUSTOMER_MESSAGED_AT],
    );

    await pool.query(
      `insert into conversations (id, customer_id, page_id, last_message_at, last_message_preview, last_customer_message_at, is_read)
       values ($1,$2,$3,$7,'สนใจโปรค่ะ',$7,false),
              ($4,$5,$6,$7,'ราคาเท่าไหร่',$7,false)`,
      [ids.convA, ids.customerA, ids.pageA, ids.convB, ids.customerB, ids.pageB, CUSTOMER_MESSAGED_AT],
    );
  });

  /* -------------------------------------------------------------- */
  it('⭐ แอดมิน 2 คนขอล็อกห้องเดียวกันพร้อมกัน → ได้คนเดียว', async () => {
    const [a, b] = await Promise.all([acquireLock(ADMIN_A, ids.convA), acquireLock(ADMIN_B, ids.convA)]);

    const winners = [a, b].filter((r) => r.won);
    expect(winners).toHaveLength(1);

    // คนที่แพ้ต้องรู้ว่าใครถืออยู่ จะได้เตือนบนหน้าจอได้
    const loser = [a, b].find((r) => !r.won)!;
    expect(loser.locked_by_admin_id).toBe(winners[0].locked_by_admin_id);
    expect(loser.locked_by_name).toBeTruthy();
  });

  /* -------------------------------------------------------------- */
  it('คนที่ถือล็อกอยู่ ขอซ้ำได้เรื่อย ๆ (ต่ออายุ)', async () => {
    const first = await acquireLock(ADMIN_A, ids.convA);
    const again = await acquireLock(ADMIN_A, ids.convA);

    expect(first.won).toBe(true);
    expect(again.won).toBe(true);
    expect(again.locked_by_admin_id).toBe(ids.adminA);
  });

  /* -------------------------------------------------------------- */
  it('⭐ ล็อกที่เงียบเกิน 3 นาที ถูกยึดต่อได้ ไม่ค้างถาวร', async () => {
    await acquireLock(ADMIN_A, ids.convA);

    // จำลองว่าแอดมิน A ปิดโน้ตบุ๊กหนีไปเมื่อ 5 นาทีที่แล้ว
    await pool.query(`update conversations set locked_at = now() - interval '5 minutes' where id = $1`, [
      ids.convA,
    ]);

    const b = await acquireLock(ADMIN_B, ids.convA);
    expect(b.won).toBe(true);
    expect(b.locked_by_admin_id).toBe(ids.adminB);
  });

  /* -------------------------------------------------------------- */
  it('ปล่อยล็อกของคนอื่นไม่ได้', async () => {
    await acquireLock(ADMIN_A, ids.convA);
    await releaseLock(ADMIN_B, ids.convA); // B พยายามปลดของ A

    const row = await pool.query('select locked_by_admin_id from conversations where id = $1', [ids.convA]);
    expect(row.rows[0].locked_by_admin_id).toBe(ids.adminA);

    // เจ้าของล็อกเองปล่อยได้
    await releaseLock(ADMIN_A, ids.convA);
    const after = await pool.query('select locked_by_admin_id from conversations where id = $1', [ids.convA]);
    expect(after.rows[0].locked_by_admin_id).toBeNull();
  });

  /* -------------------------------------------------------------- */
  it('⭐ แอดมินเห็นเฉพาะเพจที่ได้รับสิทธิ์ / เจ้าของเห็นทุกเพจ', async () => {
    const forAdmin = await listConversations(ADMIN_A);
    expect(forAdmin.conversations.map((c) => c.id)).toEqual([ids.convA]);
    expect(forAdmin.pages.map((p) => p.id)).toEqual([ids.pageA]);

    const forOwner = await listConversations(OWNER);
    expect(forOwner.conversations).toHaveLength(2);
    expect(forOwner.pages).toHaveLength(2);
  });

  /* -------------------------------------------------------------- */
  it('⭐ ขอกรองเพจที่ไม่มีสิทธิ์ ต้องไม่ได้ข้อมูลของเพจนั้น', async () => {
    // แอดมิน A ยัด page_ids ของเพจ B มาเอง (จำลองการแก้ค่าจากเบราว์เซอร์)
    const result = await listConversations(ADMIN_A, { page_ids: [ids.pageB] });

    // ต้องไม่หลุดข้อมูลเพจ B ออกไป — ตกกลับไปใช้เฉพาะเพจที่มีสิทธิ์
    expect(result.conversations.every((c) => c.page.id === ids.pageA)).toBe(true);
  });

  /* -------------------------------------------------------------- */
  it('ห้ามอ่านข้อความของห้องที่ไม่มีสิทธิ์', async () => {
    await expect(listMessages(ADMIN_A, ids.convB)).rejects.toThrow(/ไม่มีสิทธิ์/);
  });

  /* -------------------------------------------------------------- */
  it('ค้นหาด้วยชื่อและเบอร์โทรได้', async () => {
    const byName = await listConversations(OWNER, { search: 'คุณบี' });
    expect(byName.conversations.map((c) => c.id)).toEqual([ids.convB]);

    const byPhone = await listConversations(OWNER, { search: '0812345678' });
    expect(byPhone.conversations.map((c) => c.id)).toEqual([ids.convA]);

    const none = await listConversations(OWNER, { search: 'ไม่มีคนนี้แน่นอน' });
    expect(none.conversations).toEqual([]);
  });

  /* -------------------------------------------------------------- */
  it('กรองเฉพาะที่ยังไม่ตอบได้', async () => {
    await pool.query('update conversations set is_read = true where id = $1', [ids.convA]);
    const result = await listConversations(OWNER, { unread_only: true });
    expect(result.conversations.map((c) => c.id)).toEqual([ids.convB]);
  });

  /* -------------------------------------------------------------- */
  it('⭐ กดอ่านแล้ว ต้องไม่แตะ last_customer_message_at', async () => {
    const before = await pool.query(
      'select last_customer_message_at from conversations where id = $1',
      [ids.convA],
    );

    await markRead(ADMIN_A, ids.convA);

    const after = await pool.query(
      'select is_read, assigned_admin_id, last_customer_message_at from conversations where id = $1',
      [ids.convA],
    );
    expect(after.rows[0].is_read).toBe(true);
    expect(after.rows[0].assigned_admin_id).toBe(ids.adminA);
    // ⭐ ประวัติจริงที่ Policy Engine ใช้ ต้องเท่าเดิมเป๊ะ
    expect(after.rows[0].last_customer_message_at).toEqual(before.rows[0].last_customer_message_at);
  });

  /* -------------------------------------------------------------- */
  it('ลิสต์แชทบอกว่าใครกำลังเปิดห้องอยู่', async () => {
    await acquireLock(ADMIN_B, ids.convA);

    const result = await listConversations(ADMIN_A);
    const row = result.conversations.find((c) => c.id === ids.convA)!;
    expect(row.locked_by_admin_id).toBe(ids.adminB);
    expect(row.locked_by_name).toBe('แอดมิน บี');
  });

  /* -------------------------------------------------------------- */
  it('ล็อกที่หมดอายุแล้ว ต้องไม่โชว์ว่ามีคนเปิดอยู่', async () => {
    await acquireLock(ADMIN_B, ids.convA);
    await pool.query(`update conversations set locked_at = now() - interval '10 minutes' where id = $1`, [
      ids.convA,
    ]);

    const result = await listConversations(ADMIN_A);
    const row = result.conversations.find((c) => c.id === ids.convA)!;
    expect(row.locked_by_admin_id).toBeNull();
    expect(row.locked_by_name).toBeNull();
  });

  /* -------------------------------------------------------------- */
  it('ข้อความเรียงตามเวลาจากเก่าไปใหม่ และข้อความที่ถูกลบไม่โผล่', async () => {
    const base = Date.now() - 60_000;
    await pool.query(
      `insert into messages (conversation_id, direction, sender_type, text, created_at, is_deleted)
       values ($1,'in','customer','ข้อความที่ 1', to_timestamp($2), false),
              ($1,'out','admin','ข้อความที่ 2', to_timestamp($3), false),
              ($1,'in','customer','ข้อความที่ถูกลบ', to_timestamp($4), true)`,
      [ids.convA, base / 1000, (base + 1000) / 1000, (base + 2000) / 1000],
    );

    const { messages } = await listMessages(OWNER, ids.convA);
    expect(messages.map((m) => m.text)).toEqual(['ข้อความที่ 1', 'ข้อความที่ 2']);
  });

  /* -------------------------------------------------------------- *
   * รอบ 7 — ไล่อ่านข้อความเก่าย้อนหลังทีละชุด
   * 🔴 ก่อนรอบนี้ ห้องแชทเห็นได้แค่ชุดล่าสุดเท่านั้น
   *    พอดึงแชทเก่าจาก Meta เข้ามาเป็นพันข้อความ ก็ยังอ่านย้อนไม่ได้อยู่ดี
   * -------------------------------------------------------------- */
  it('⭐ ขอข้อความเก่ากว่าที่ถืออยู่ได้ และไล่ย้อนจนครบทุกข้อความ', async () => {
    const base = Date.now() - 3_600_000;
    const values = Array.from({ length: 12 }, (_, i) => `ข้อความที่ ${i + 1}`);
    for (let i = 0; i < values.length; i += 1) {
      await pool.query(
        `insert into messages (conversation_id, direction, sender_type, text, created_at)
         values ($1,'in','customer',$2, to_timestamp($3))`,
        [ids.convA, values[i], (base + i * 60_000) / 1000],
      );
    }

    const first = await listMessages(OWNER, ids.convA, 5);
    expect(first.messages).toHaveLength(5);
    // ได้ "ล่าสุด 5 ข้อความ" แล้วเรียงเก่า→ใหม่ให้อ่าน
    expect(first.messages.map((m) => m.text)).toEqual([
      'ข้อความที่ 8', 'ข้อความที่ 9', 'ข้อความที่ 10', 'ข้อความที่ 11', 'ข้อความที่ 12',
    ]);
    expect(first.has_more).toBe(true);

    // ไล่ย้อนไปเรื่อย ๆ จนหมด — เหมือนที่หน้าเว็บกดปุ่ม "ดูข้อความเก่ากว่านี้"
    const seen = new Map(first.messages.map((m) => [m.id, m.text]));
    let cursor: string | null = first.messages[0].created_at;
    for (let round = 0; round < 10 && cursor; round += 1) {
      const older: Awaited<ReturnType<typeof listMessages>> =
        await listMessages(OWNER, ids.convA, 5, cursor);
      const fresh = older.messages.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) break;
      for (const m of older.messages) seen.set(m.id, m.text);
      cursor = older.has_more ? older.messages[0].created_at : null;
    }

    expect([...seen.values()].sort()).toEqual([...values].sort());
  });

  /* -------------------------------------------------------------- */
  it('⭐ ใช้ lte ไม่ใช่ lt — ข้อความที่เวลาตรงขอบพอดีต้องไม่หายไปเงียบ ๆ', async () => {
    // สามข้อความเวลาเท่ากันเป๊ะ — เกิดได้จริงกับแชทที่ดึงย้อนหลังมาจาก Meta
    const same = Math.floor((Date.now() - 600_000) / 1000);
    await pool.query(
      `insert into messages (conversation_id, direction, sender_type, text, created_at)
       values ($1,'in','customer','พร้อมกัน A', to_timestamp($2)),
              ($1,'in','customer','พร้อมกัน B', to_timestamp($2)),
              ($1,'in','customer','ใหม่กว่า', to_timestamp($3))`,
      [ids.convA, same, same + 60],
    );

    const first = await listMessages(OWNER, ids.convA, 2);
    const cursor = first.messages[0].created_at;
    const older = await listMessages(OWNER, ids.convA, 5, cursor);

    // ถ้าใช้ lt ข้อความที่เวลาตรงกับขอบจะหายไปทั้งกลุ่ม
    const texts = new Set([...first.messages, ...older.messages].map((m) => m.text));
    expect(texts.has('พร้อมกัน A')).toBe(true);
    expect(texts.has('พร้อมกัน B')).toBe(true);
    expect(texts.has('ใหม่กว่า')).toBe(true);
  });

  /* -------------------------------------------------------------- */
  it('🔴 ข้อความที่ถูกลบติดกันเป็นพรืด ต้องไม่บังประวัติที่อยู่เก่ากว่านั้น', async () => {
    /**
     * เดิมกรอง is_deleted ทีหลังใน JavaScript
     * ถ้าข้อความที่ถูกลบติดกันเกินขนาดชุดหนึ่งชุด ชุดที่ได้จะว่างเปล่า
     * หน้าเว็บก็จะเข้าใจว่า "ถึงต้นห้องแล้ว" แล้วอ่านของเก่ากว่านั้นไม่ได้อีกเลย
     */
    const base = Date.now() - 3_600_000;
    await pool.query(
      `insert into messages (conversation_id, direction, sender_type, text, created_at)
       values ($1,'in','customer','ของเก่าสุด', to_timestamp($2))`,
      [ids.convA, base / 1000],
    );
    for (let i = 1; i <= 6; i += 1) {
      await pool.query(
        `insert into messages (conversation_id, direction, sender_type, text, created_at, is_deleted)
         values ($1,'in','customer',$2, to_timestamp($3), true)`,
        [ids.convA, `ถูกลบ ${i}`, (base + i * 60_000) / 1000],
      );
    }
    await pool.query(
      `insert into messages (conversation_id, direction, sender_type, text, created_at)
       values ($1,'in','customer','ใหม่สุด', to_timestamp($2))`,
      [ids.convA, (base + 7 * 60_000) / 1000],
    );

    // ขอทีละ 3 — ถ้ากรองทีหลัง ชุดแรกจะเหลือแค่ 'ใหม่สุด' แล้วบอกว่าหมดแล้ว
    const first = await listMessages(OWNER, ids.convA, 3);
    expect(first.messages.map((m) => m.text)).toEqual(['ของเก่าสุด', 'ใหม่สุด']);
    expect(first.has_more).toBe(false);
  });

  /* -------------------------------------------------------------- */
  it('⭐ ลิสต์แชทไล่ดูของเก่ากว่าได้ — จำเป็นเมื่อเพจมีลูกค้าเป็นร้อย', async () => {
    // เพิ่มห้องแชทของเพจ A อีก 4 ห้อง ไล่เวลาถอยหลังทีละชั่วโมง
    const extra: string[] = [];
    for (let i = 1; i <= 4; i += 1) {
      const customerId = randomUUID();
      const convId = randomUUID();
      extra.push(convId);
      await pool.query(
        `insert into customers (id, page_id, psid, platform, name)
         values ($1,$2,$3,'facebook',$4)`,
        [customerId, ids.pageA, `PSID_EXTRA_${i}`, `ลูกค้า ${i}`],
      );
      await pool.query(
        `insert into conversations (id, customer_id, page_id, last_message_at, is_read)
         values ($1,$2,$3, now() - ($4 || ' hours')::interval, true)`,
        [convId, customerId, ids.pageA, String(i + 10)],
      );
    }

    const first = await listConversations(ADMIN_A, { limit: 2 });
    expect(first.conversations).toHaveLength(2);
    expect(first.has_more).toBe(true);

    const seen = new Set(first.conversations.map((c) => c.id));
    let cursor: string | null = first.conversations[first.conversations.length - 1].last_message_at;
    for (let round = 0; round < 10 && cursor; round += 1) {
      const older: Awaited<ReturnType<typeof listConversations>> =
        await listConversations(ADMIN_A, { limit: 2, before: cursor });
      const fresh = older.conversations.filter((c) => !seen.has(c.id));
      if (fresh.length === 0) break;
      for (const c of older.conversations) seen.add(c.id);
      cursor = older.has_more
        ? older.conversations[older.conversations.length - 1].last_message_at
        : null;
    }

    // ต้องได้ครบทุกห้องของเพจ A และต้องไม่หลุดห้องของเพจ B เข้ามา
    expect(seen.size).toBe(5);
    expect(seen.has(ids.convA)).toBe(true);
    expect(seen.has(ids.convB)).toBe(false);
    for (const id of extra) expect(seen.has(id)).toBe(true);
  });
});
