/**
 * ชุดทดสอบการตอบกลับข้อความกับ PostgreSQL จริง (ก้อน 2 ข้อ 1.3)
 * ===========================================================================
 * 🔴 สิ่งที่ชุดนี้ต้องพิสูจน์ — ทั้งหมดเป็นเรื่องที่ "หน้าเว็บปลอมได้ถ้าไม่มีด่าน" :
 *
 *   1. ตอบกลับข้ามห้องแชท = ต้องทำไม่ได้ ทั้งทางฟังก์ชันและทาง insert ตรง ๆ
 *      (ถ้าทำได้ = แอดมินอ้างอิงข้อความของลูกค้าคนอื่นมาแปะในห้องนี้ได้ = ข้อมูลรั่ว)
 *   2. ข้อความที่ถูกลบแล้ว ตอบกลับไม่ได้
 *   3. ข้อความที่ไม่มี mid ยังตอบกลับได้ในระบบเรา
 *   4. ⭐ ฐานข้อมูลต้องกันเอง แม้โค้ดฝั่งเซิร์ฟเวอร์จะพลาด
 *      (บทเรียน D-68 : TypeScript อย่างเดียวไม่ใช่หลักประกัน)
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

const { resolveReplyTarget } = await import('@/server/messaging/store');
const { encryptSecret } = await import('@/lib/crypto');

let pool: Pool;
let rest: RestServer;

const ids = {
  page: randomUUID(),
  custA: randomUUID(), convA: randomUUID(),
  custB: randomUUID(), convB: randomUUID(),
};

async function addMessage(conversationId: string, over: {
  mid?: string | null; deleted?: boolean; text?: string;
} = {}) {
  const id = randomUUID();
  await pool.query(
    `insert into messages (id, conversation_id, direction, sender_type, text, meta_message_id, is_deleted)
     values ($1,$2,'in','customer',$3,$4,$5)`,
    [id, conversationId, over.text ?? 'ข้อความ', over.mid ?? null, over.deleted ?? false],
  );
  return id;
}

/* ================================================================== */
describe.skipIf(!available)('PostgreSQL จริง — ตอบกลับข้อความ', () => {
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

    await pool.query(
      `insert into pages (id, platform, page_id, page_name, access_token, is_active)
       values ($1,'facebook','111111','เพจทดสอบ',$2,true)`,
      [ids.page, encryptSecret('EAA-fake')],
    );
    await pool.query(
      `insert into customers (id, page_id, platform, psid, name) values
        ($1,$3,'facebook','psid_a','ลูกค้า A'),
        ($2,$3,'facebook','psid_b','ลูกค้า B')`,
      [ids.custA, ids.custB, ids.page],
    );
    await pool.query(
      `insert into conversations (id, customer_id, page_id, last_message_at) values
        ($1,$3,$5,now()), ($2,$4,$5,now())`,
      [ids.convA, ids.convB, ids.custA, ids.custB, ids.page],
    );
  });

  /* ============================================================== */
  describe('🔴 ห้ามตอบกลับข้ามห้องแชท', () => {
    it('⭐ ข้อความอยู่ห้อง B แต่จะตอบในห้อง A → ต้องถูกปฏิเสธ', async () => {
      /**
       * นี่คือสิ่งที่หน้าเว็บปลอมได้ง่ายที่สุด — แค่เปลี่ยน id ที่ส่งมา
       * ถ้าผ่าน = ข้อความของลูกค้า B จะไปโผล่เป็นบริบทในห้องของลูกค้า A
       */
      const msgInB = await addMessage(ids.convB, { text: 'ความลับของลูกค้า B' });

      const result = await resolveReplyTarget(ids.convA, msgInB);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason_th).toContain('ข้ามห้อง');
    });

    it('🔴 แม้เขียนลงฐานข้อมูลตรง ๆ ก็ต้องเข้าไม่ได้', async () => {
      /**
       * ด่านชั้นสุดท้าย — เผื่อวันหนึ่งมีโค้ดใหม่ที่ลืมเรียก resolveReplyTarget
       * ฐานข้อมูลต้องยังกันให้อยู่ (บทเรียน D-68)
       */
      const msgInB = await addMessage(ids.convB);
      await expect(
        pool.query(
          `insert into messages (conversation_id, direction, sender_type, text, reply_to_message_id)
           values ($1,'out','admin','แอบอ้างอิงข้ามห้อง',$2)`,
          [ids.convA, msgInB],
        ),
      ).rejects.toThrow(/ข้ามห้อง/);
    });

    it('ห้องเดียวกัน → ผ่านปกติ', async () => {
      const msgInA = await addMessage(ids.convA, { mid: 'mid.abc' });
      const result = await resolveReplyTarget(ids.convA, msgInA);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.meta_message_id).toBe('mid.abc');
    });
  });

  /* ============================================================== */
  describe('กรณีที่ตอบกลับไม่ได้', () => {
    it('ข้อความถูกลบไปแล้ว → ปฏิเสธ', async () => {
      const deleted = await addMessage(ids.convA, { deleted: true });
      const result = await resolveReplyTarget(ids.convA, deleted);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason_th).toContain('ถูกลบ');
    });

    it('ไม่มีข้อความนี้อยู่จริง → ปฏิเสธ', async () => {
      const result = await resolveReplyTarget(ids.convA, randomUUID());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason_th).toContain('ไม่พบ');
    });

    it('ไม่ได้ระบุว่าจะตอบกลับอะไร → ผ่าน (ส่งข้อความธรรมดา)', async () => {
      const result = await resolveReplyTarget(ids.convA, null);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.meta_message_id).toBeNull();
    });
  });

  /* ============================================================== */
  describe('⭐ ข้อความที่ไม่มี mid ของ Meta', () => {
    it('ยังตอบกลับได้ในระบบเรา แค่ไม่มี native reply', async () => {
      /**
       * เช่นข้อความที่ยังส่งไม่สำเร็จ หรือที่ดึงมาจาก backfill บางแบบ
       * ไม่ควรห้ามตอบกลับ เพราะในมุมแอดมินมันก็เป็นข้อความหนึ่งในห้อง
       */
      const noMid = await addMessage(ids.convA, { mid: null });
      const result = await resolveReplyTarget(ids.convA, noMid);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.meta_message_id).toBeNull();
    });
  });

  /* ============================================================== */
  describe('บันทึกความสัมพันธ์ลงประวัติ', () => {
    it('record_outbound_message เก็บ reply_to + reply_native ได้ครบ', async () => {
      const target = await addMessage(ids.convA, { mid: 'mid.target' });

      const { rows } = await pool.query(
        `select record_outbound_message($1,null,'admin','ตอบกลับ','[]'::jsonb,'mid.new',false,$2,true) as id`,
        [ids.convA, target],
      );
      const newId = rows[0].id as string;

      const { rows: saved } = await pool.query(
        `select reply_to_message_id, reply_native from messages where id = $1`, [newId],
      );
      expect(saved[0].reply_to_message_id).toBe(target);
      expect(saved[0].reply_native).toBe(true);
    });

    it('ไม่ระบุ reply → ค่าเริ่มต้นต้องไม่ใช่ native', async () => {
      const { rows } = await pool.query(
        `select record_outbound_message($1,null,'admin','ข้อความธรรมดา','[]'::jsonb,'mid.plain',false) as id`,
        [ids.convA],
      );
      const { rows: saved } = await pool.query(
        `select reply_to_message_id, reply_native from messages where id = $1`, [rows[0].id],
      );
      expect(saved[0].reply_to_message_id).toBeNull();
      expect(saved[0].reply_native).toBe(false);
    });

    it('🔴 ตอบกลับข้ามห้องผ่าน record_outbound_message ก็ต้องพัง', async () => {
      const msgInB = await addMessage(ids.convB);
      await expect(
        pool.query(
          `select record_outbound_message($1,null,'admin','x','[]'::jsonb,'mid.x',false,$2,true)`,
          [ids.convA, msgInB],
        ),
      ).rejects.toThrow(/ข้ามห้อง/);
    });
  });
});
