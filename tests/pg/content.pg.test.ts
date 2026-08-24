/**
 * ชุดทดสอบชุดคำตอบ + แท็ก กับ PostgreSQL จริง (รอบ 4)
 * ===========================================================================
 *   1. ตัวย่อของชุดคำตอบห้ามซ้ำ (ฐานข้อมูลเป็นคนบังคับ)
 *   2. ⭐ นับการใช้พร้อมกันหลายคน ตัวเลขต้องไม่หาย
 *   3. ใส่แท็กซ้ำ ๆ ต้องไม่พัง และไม่เกิดสองแถว
 *   4. ลบแท็ก → หลุดจากห้องแชทที่ติดอยู่ตามไปด้วย
 *   5. กรองลิสต์แชทตามแท็กได้จริง
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

const content = await import('@/server/content/service');
const { listConversations } = await import('@/server/inbox/service');

let pool: Pool;
let rest: RestServer;

const ids = {
  page: randomUUID(),
  owner: randomUUID(),
  customerA: randomUUID(),
  customerB: randomUUID(),
  convA: randomUUID(),
  convB: randomUUID(),
};

const OWNER = {
  id: ids.owner,
  name: 'เจ้าของ',
  email: 'owner@test.local',
  role: 'owner' as const,
  allowed_page_ids: [] as string[],
  must_change_password: false,
  is_active: true,
  last_seen_at: null,
  last_login_ip: null,
  session_version: 1,
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/* ================================================================== */
describe.skipIf(!available)('PostgreSQL จริง — ชุดคำตอบ + แท็ก', () => {
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
    await pool.query('delete from conversation_tags');
    await pool.query('delete from tags');
    await pool.query('delete from canned_responses');
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');
    await pool.query('delete from admins');

    await pool.query(
      `insert into admins (id, name, email, password_hash, role) values ($1,'เจ้าของ','owner@test.local','x','owner')`,
      [ids.owner],
    );
    await pool.query(
      `insert into pages (id, platform, page_id, page_name) values ($1,'facebook','1001','เพจทดสอบ')`,
      [ids.page],
    );
    await pool.query(
      `insert into customers (id, page_id, psid, platform, name) values ($1,$3,'P_A','facebook','คุณเอ'), ($2,$3,'P_B','facebook','คุณบี')`,
      [ids.customerA, ids.customerB, ids.page],
    );
    await pool.query(
      `insert into conversations (id, customer_id, page_id) values ($1,$2,$4), ($3,$5,$4)`,
      [ids.convA, ids.customerA, ids.convB, ids.page, ids.customerB],
    );
  });

  /* ------------------------- ชุดคำตอบ ------------------------- */

  it('สร้างและค้นหาชุดคำตอบได้', async () => {
    await content.createCanned({ title: 'แจ้งเลขบัญชี', shortcut: 'bank', text: 'ธนาคารกสิกร 123-4-56789' });
    await content.createCanned({ title: 'ขอบคุณค่ะ', shortcut: 'ty', text: 'ขอบคุณค่ะ 🙏' });

    expect(await content.listCanned()).toHaveLength(2);
    expect((await content.listCanned('bank')).map((c) => c.title)).toEqual(['แจ้งเลขบัญชี']);
    // ค้นจากเนื้อข้อความก็ต้องเจอ
    expect((await content.listCanned('กสิกร')).map((c) => c.title)).toEqual(['แจ้งเลขบัญชี']);
  });

  it('🔴 ตัวย่อซ้ำไม่ได้ — ฐานข้อมูลเป็นคนบังคับ', async () => {
    await content.createCanned({ title: 'อันแรก', shortcut: 'bank' });
    await expect(content.createCanned({ title: 'อันสอง', shortcut: 'bank' })).rejects.toThrow(
      content.ContentConflictError,
    );
  });

  it('ตัวย่อว่างได้หลายอัน (ไม่นับว่าซ้ำ)', async () => {
    await content.createCanned({ title: 'ก' });
    await content.createCanned({ title: 'ข' });
    expect(await content.listCanned()).toHaveLength(2);
  });

  it('⭐ นับการใช้พร้อมกัน 10 ครั้ง ตัวเลขต้องครบ', async () => {
    const item = await content.createCanned({ title: 'ใช้บ่อย', shortcut: 'hot' });
    await Promise.all(Array.from({ length: 10 }, () => content.bumpCannedUse(item.id)));

    const row = await pool.query('select use_count from canned_responses where id = $1', [item.id]);
    expect(row.rows[0].use_count).toBe(10);
  });

  it('อันที่ใช้บ่อยกว่าต้องมาก่อน', async () => {
    const a = await content.createCanned({ title: 'ใช้น้อย' });
    const b = await content.createCanned({ title: 'ใช้เยอะ' });
    await content.bumpCannedUse(b.id);
    await content.bumpCannedUse(b.id);
    await content.bumpCannedUse(a.id);

    expect((await content.listCanned()).map((c) => c.title)).toEqual(['ใช้เยอะ', 'ใช้น้อย']);
  });

  /* --------------------------- แท็ก --------------------------- */

  it('ชื่อแท็กซ้ำไม่ได้ (ไม่สนตัวพิมพ์เล็กใหญ่)', async () => {
    await content.createTag({ name: 'รอโอน' });
    await expect(content.createTag({ name: 'รอโอน' })).rejects.toThrow(content.ContentConflictError);
  });

  it('แท็กที่แอดมินสร้างเองต้องไม่ถูกทำเครื่องหมายว่าอัตโนมัติ', async () => {
    const tag = await content.createTag({ name: 'ลูกค้าประจำ' });
    expect(tag.is_auto).toBe(false);
  });

  it('⭐ ใส่แท็กซ้ำ ๆ ต้องไม่พัง และไม่เกิดสองแถว', async () => {
    const tag = await content.createTag({ name: 'รอโอน' });
    const attach = () =>
      content.setConversationTag({
        conversation_id: ids.convA,
        tag_id: tag.id,
        admin_id: ids.owner,
        attached: true,
      });

    await Promise.all([attach(), attach(), attach()]);

    const rows = await pool.query('select count(*)::int as n from conversation_tags where conversation_id = $1', [
      ids.convA,
    ]);
    expect(rows.rows[0].n).toBe(1);
  });

  it('ถอดแท็กที่ไม่ได้ติดอยู่ ต้องไม่พัง', async () => {
    const tag = await content.createTag({ name: 'ยังไม่ติด' });
    await expect(
      content.setConversationTag({
        conversation_id: ids.convA,
        tag_id: tag.id,
        admin_id: ids.owner,
        attached: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('ลบแท็ก → หลุดจากห้องแชทที่ติดอยู่ตามไปด้วย', async () => {
    const tag = await content.createTag({ name: 'ชั่วคราว' });
    await content.setConversationTag({
      conversation_id: ids.convA,
      tag_id: tag.id,
      admin_id: ids.owner,
      attached: true,
    });

    await content.deleteTag(tag.id);

    const rows = await pool.query('select count(*)::int as n from conversation_tags');
    expect(rows.rows[0].n).toBe(0);
  });

  /* ------------------ แท็กในลิสต์แชท ------------------ */

  it('⭐ ลิสต์แชทกรองตามแท็กได้จริง และคืน tag_ids มาด้วย', async () => {
    const waiting = await content.createTag({ name: 'รอโอน' });
    const shipped = await content.createTag({ name: 'ส่งแล้ว' });

    await content.setConversationTag({
      conversation_id: ids.convA,
      tag_id: waiting.id,
      admin_id: ids.owner,
      attached: true,
    });
    await content.setConversationTag({
      conversation_id: ids.convB,
      tag_id: shipped.id,
      admin_id: ids.owner,
      attached: true,
    });

    const all = await listConversations(OWNER);
    expect(all.conversations).toHaveLength(2);
    expect(all.conversations.find((c) => c.id === ids.convA)?.tag_ids).toEqual([waiting.id]);

    const onlyWaiting = await listConversations(OWNER, { tag_ids: [waiting.id] });
    expect(onlyWaiting.conversations.map((c) => c.id)).toEqual([ids.convA]);

    const none = await listConversations(OWNER, { tag_ids: [randomUUID()] });
    expect(none.conversations).toEqual([]);
  });

  it('ห้องที่ไม่มีแท็ก ต้องได้ tag_ids เป็นรายการว่าง ไม่ใช่ undefined', async () => {
    const result = await listConversations(OWNER);
    expect(result.conversations.every((c) => Array.isArray(c.tag_ids))).toBe(true);
  });
});
