/**
 * ชุดทดสอบการเติมชื่อ/รูปลูกค้า (แก้ D-33)
 * ===========================================================================
 * 🔴 ชุดนี้เกิดจากบั๊กจริงที่ทำให้ลิสต์แชทเป็น "ลูกค้า xxxxxx" ทั้งหมด
 *
 *    โค้ดเดิมจด profile_synced_at ทุกครั้งแม้ดึงไม่สำเร็จ
 *    แล้วรอบถัดไปเช็คว่าเคยจดแล้วก็ข้าม
 *    → ลูกค้าที่พลาดครั้งแรก ไม่มีวันถูกดึงใหม่อีกเลยตลอดกาล
 *    → เจ้าของร้านแก้สิทธิ์ Meta ถูกแล้วก็ไม่มีอะไรเปลี่ยน
 *
 * สิ่งที่ชุดนี้ต้องพิสูจน์ :
 *   1. ⭐ ล้มเหลว = ต้องกลับมาลองใหม่ได้ ไม่ใช่ยอมแพ้ถาวร
 *   2. ⭐ แต่ต้องไม่ยิงถาม Meta รัวทุกข้อความ (ต้องเว้นระยะ)
 *   3. 🔴 สำเร็จแล้วห้ามถามซ้ำ
 *   4. 🔴 ห้ามเขียนทับชื่อจริงด้วยค่าว่าง
 *   5. Facebook กับ Instagram แยกกัน ขอฟิลด์คนละชุด
 *   6. เหตุผลที่พลาดต้องอ่านแล้วรู้ว่าต้องไปทำอะไรต่อ
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

const { syncCustomerProfile, refreshCustomerProfile, MAX_PROFILE_ATTEMPTS } =
  await import('@/server/meta/profile-sync');
const { explainProfileError } = await import('@/server/meta/profile');
const { __setFetcherForTests } = await import('@/server/meta/client');
const { encryptSecret } = await import('@/lib/crypto');

let pool: Pool;
let rest: RestServer;

const ids = { page: randomUUID(), igPage: randomUUID() };

type Page = Parameters<typeof syncCustomerProfile>[0];

const fbPage = (): Page => ({
  id: ids.page, platform: 'facebook', page_id: '111111', access_token: encryptSecret('EAA-fake'),
});
const igPage = (): Page => ({
  id: ids.igPage, platform: 'instagram', page_id: '222222', access_token: encryptSecret('IG-fake'),
});

/** Meta ปลอม — จำ URL ที่ถูกเรียกไว้ตรวจได้ */
function fakeMeta(handler: (n: number, url: string) => Response) {
  const state = { calls: 0, urls: [] as string[] };
  __setFetcherForTests((async (input: RequestInfo | URL) => {
    state.calls += 1;
    const url = String(input);
    state.urls.push(url);
    return handler(state.calls, url);
  }) as typeof fetch);
  return state;
}

const okProfile = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const metaError = (code: number, message: string, status = 400) =>
  new Response(JSON.stringify({ error: { code, message, type: 'OAuthException' } }), {
    status, headers: { 'Content-Type': 'application/json' },
  });

async function makeCustomer(over: { name?: string | null; page?: string } = {}) {
  const id = randomUUID();
  await pool.query(
    `insert into customers (id, page_id, platform, psid, name)
     values ($1,$2,'facebook',$3,$4)`,
    [id, over.page ?? ids.page, `psid_${id.slice(0, 8)}`, over.name ?? null],
  );
  return id;
}

async function readCustomer(id: string) {
  const { rows } = await pool.query(
    `select name, profile_pic_url, profile_synced_at, profile_attempts,
            profile_last_attempt_at, profile_error_kind, profile_error_th
       from customers where id = $1`, [id],
  );
  return rows[0];
}

/** ย้อนเวลา "ครั้งล่าสุดที่ลอง" ให้เก่าลง เพื่อทดสอบว่าถึงเวลาลองใหม่แล้ว */
async function rewindAttempt(id: string, interval: string) {
  await pool.query(
    `update customers set profile_last_attempt_at = now() - $2::interval where id = $1`,
    [id, interval],
  );
}

/* ================================================================== */
describe.skipIf(!available)('PostgreSQL จริง — เติมชื่อ/รูปลูกค้า', () => {
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
    __setFetcherForTests(null);
    await pool.query('delete from customers');
    await pool.query('delete from pages');
    await pool.query(
      `insert into pages (id, platform, page_id, page_name, access_token, is_active)
       values ($1,'facebook','111111','เพจ FB',$3,true),
              ($2,'instagram','222222','เพจ IG',$3,true)`,
      [ids.page, ids.igPage, encryptSecret('EAA-fake')],
    );
  });

  /* ============================================================== */
  describe('🔴 ล้มเหลวแล้วต้องกลับมาลองใหม่ได้ (หัวใจของ D-33)', () => {
    it('⭐ ดึงพลาด → profile_synced_at ต้องยังเป็น null', async () => {
      /**
       * นี่คือข้อที่พังมาตลอด
       * ถ้า profile_synced_at ถูกจดตอนพลาด = ยอมแพ้ถาวร ไม่มีใครมาดึงใหม่อีกเลย
       */
      const id = await makeCustomer();
      fakeMeta(() => metaError(10, 'permission denied'));

      const out = await syncCustomerProfile(fbPage(), id, 'psid_1');
      expect(out.kind).toBe('failed');

      const row = await readCustomer(id);
      expect(row.profile_synced_at, 'จด synced_at ตอนพลาด = ยอมแพ้ถาวร (บั๊ก D-33)').toBeNull();
      expect(row.profile_attempts).toBe(1);
      expect(row.profile_error_th).toContain('สิทธิ์');
    });

    it('⭐ เจ้าของร้านแก้สิทธิ์ Meta แล้ว → ระบบต้องได้ชื่อมาเองในรอบถัดไป', async () => {
      const id = await makeCustomer();

      // รอบแรก : สิทธิ์ยังไม่ครบ
      fakeMeta(() => metaError(10, 'permission denied'));
      await syncCustomerProfile(fbPage(), id, 'psid_1');
      expect((await readCustomer(id)).name).toBeNull();

      // เวลาผ่านไป แล้วเจ้าของร้านไปแก้สิทธิ์เรียบร้อย
      await rewindAttempt(id, '2 minutes');
      fakeMeta(() => okProfile({ first_name: 'สมชาย', last_name: 'ใจดี', profile_pic: 'https://x/p.jpg' }));

      const out = await syncCustomerProfile(fbPage(), id, 'psid_1');
      expect(out.kind).toBe('synced');

      const row = await readCustomer(id);
      expect(row.name).toBe('สมชาย ใจดี');
      expect(row.profile_pic_url).toBe('https://x/p.jpg');
      expect(row.profile_synced_at).not.toBeNull();
      expect(row.profile_error_th, 'สำเร็จแล้วต้องล้างข้อความผิดพลาดเก่าทิ้ง').toBeNull();
    });

    it('🔴 แต่ต้องไม่ยิงถาม Meta รัวทุกข้อความ', async () => {
      /**
       * เหตุผลเดิมที่โค้ดเก่าจด synced_at ตอนพลาดคือกลัวข้อนี้ ซึ่งเป็นห่วงที่ถูก
       * แค่วิธีแก้ผิด — ตอนนี้กันด้วยการเว้นระยะ ไม่ใช่การยอมแพ้
       */
      const id = await makeCustomer();
      const meta = fakeMeta(() => metaError(10, 'permission denied'));

      await syncCustomerProfile(fbPage(), id, 'psid_1');
      // ข้อความถัดมาอีก 4 ข้อความในนาทีเดียวกัน
      for (let i = 0; i < 4; i += 1) await syncCustomerProfile(fbPage(), id, 'psid_1');

      expect(meta.calls, 'ยิงถาม Meta ซ้ำทั้งที่เพิ่งลองไป').toBe(1);
      expect((await readCustomer(id)).profile_attempts).toBe(1);
    });

    it('ระยะห่างต้องยืดขึ้นเรื่อย ๆ ตามจำนวนครั้งที่พลาด', async () => {
      const id = await makeCustomer();
      const meta = fakeMeta(() => metaError(10, 'denied'));

      await syncCustomerProfile(fbPage(), id, 'psid_1');   // ครั้งที่ 1

      // ผ่านไป 2 นาที → ครั้งที่ 2 ควรได้ (เกณฑ์คือ 1 นาที)
      await rewindAttempt(id, '2 minutes');
      await syncCustomerProfile(fbPage(), id, 'psid_1');
      expect(meta.calls).toBe(2);

      // ผ่านไปอีกแค่ 2 นาที → ยังไม่ถึงเวลา (เกณฑ์ครั้งที่ 3 คือ 10 นาที)
      await rewindAttempt(id, '2 minutes');
      await syncCustomerProfile(fbPage(), id, 'psid_1');
      expect(meta.calls, 'ยังไม่ถึงเวลาแต่ยิงไปแล้ว').toBe(2);

      // ผ่านไป 20 นาที → ได้
      await rewindAttempt(id, '20 minutes');
      await syncCustomerProfile(fbPage(), id, 'psid_1');
      expect(meta.calls).toBe(3);
    });

    it('ลองครบเพดานแล้วต้องหยุดเอง ไม่ถามไม่เลิก', async () => {
      const id = await makeCustomer();
      const meta = fakeMeta(() => metaError(10, 'denied'));

      for (let i = 0; i < MAX_PROFILE_ATTEMPTS + 5; i += 1) {
        await rewindAttempt(id, '48 hours');
        await syncCustomerProfile(fbPage(), id, 'psid_1');
      }
      expect(meta.calls).toBe(MAX_PROFILE_ATTEMPTS);
    });

    it('⭐ ปุ่ม "ลองดึงชื่ออีกครั้ง" ต้องใช้ได้แม้ครบเพดานแล้ว', async () => {
      const id = await makeCustomer();
      const meta = fakeMeta((n) =>
        n <= MAX_PROFILE_ATTEMPTS
          ? metaError(10, 'denied')
          : okProfile({ first_name: 'สมหญิง', last_name: '', profile_pic: null }),
      );

      for (let i = 0; i < MAX_PROFILE_ATTEMPTS; i += 1) {
        await rewindAttempt(id, '48 hours');
        await syncCustomerProfile(fbPage(), id, 'psid_1');
      }
      // ตันแล้ว
      await rewindAttempt(id, '48 hours');
      await syncCustomerProfile(fbPage(), id, 'psid_1');
      expect(meta.calls).toBe(MAX_PROFILE_ATTEMPTS);

      // เจ้าของร้านแก้สิทธิ์เสร็จแล้วกดปุ่มเอง
      const out = await refreshCustomerProfile(fbPage(), id, 'psid_1');
      expect(out.kind).toBe('synced');
      expect((await readCustomer(id)).name).toBe('สมหญิง');
    });
  });

  /* ============================================================== */
  describe('🔴 ห้ามทำให้ของที่ใช้ได้อยู่แล้วแย่ลง', () => {
    it('ได้ชื่อแล้วต้องไม่ถาม Meta ซ้ำอีก', async () => {
      const id = await makeCustomer();
      const meta = fakeMeta(() => okProfile({ first_name: 'สมชาย', last_name: 'ใจดี' }));

      await syncCustomerProfile(fbPage(), id, 'psid_1');
      await syncCustomerProfile(fbPage(), id, 'psid_1');
      await syncCustomerProfile(fbPage(), id, 'psid_1');

      expect(meta.calls).toBe(1);
    });

    it('🔴 ห้ามเขียนทับชื่อจริงด้วยค่าว่าง', async () => {
      /**
       * เคยได้ชื่อแล้วกลับกลายเป็น "ลูกค้า xxxxxx" คือความถดถอยที่แอดมินรับไม่ได้
       * (จำผิดคน = ตอบผิดคน)
       */
      const id = await makeCustomer({ name: 'ชื่อที่ได้มาก่อนหน้านี้' });
      await pool.query(`update customers set profile_synced_at = null where id = $1`, [id]);

      fakeMeta(() => okProfile({ first_name: '', last_name: '', profile_pic: 'https://x/new.jpg' }));
      await syncCustomerProfile(fbPage(), id, 'psid_1');

      const row = await readCustomer(id);
      expect(row.name, 'ชื่อเดิมถูกลบทิ้ง').toBe('ชื่อที่ได้มาก่อนหน้านี้');
      expect(row.profile_pic_url, 'รูปใหม่ควรถูกบันทึก').toBe('https://x/new.jpg');
    });

    it('Meta ตอบ 200 แต่ไม่มีอะไรเลย = ยังไม่สำเร็จ ต้องได้ลองใหม่', async () => {
      const id = await makeCustomer();
      fakeMeta(() => okProfile({}));

      const out = await syncCustomerProfile(fbPage(), id, 'psid_1');
      expect(out.kind).toBe('failed');
      expect((await readCustomer(id)).profile_synced_at).toBeNull();
    });

    it('ได้รูปอย่างเดียวก็นับว่าสำเร็จ ไม่ต้องถามซ้ำ', async () => {
      const id = await makeCustomer();
      const meta = fakeMeta(() => okProfile({ profile_pic: 'https://x/only-pic.jpg' }));

      await syncCustomerProfile(fbPage(), id, 'psid_1');
      await syncCustomerProfile(fbPage(), id, 'psid_1');

      expect(meta.calls).toBe(1);
      expect((await readCustomer(id)).profile_synced_at).not.toBeNull();
    });
  });

  /* ============================================================== */
  describe('Facebook กับ Instagram แยกกัน', () => {
    it('Facebook ขอ first_name/last_name และต่อชื่อให้ถูก', async () => {
      const id = await makeCustomer();
      const meta = fakeMeta(() => okProfile({ first_name: 'สมชาย', last_name: 'ใจดี' }));

      await syncCustomerProfile(fbPage(), id, 'psid_fb');

      expect(meta.urls[0]).toContain('first_name');
      expect(meta.urls[0]).toContain('last_name');
      expect((await readCustomer(id)).name).toBe('สมชาย ใจดี');
    });

    it('🔴 Instagram ขอคนละฟิลด์ ห้ามใช้ชุดเดียวกับ Facebook', async () => {
      const id = await makeCustomer({ page: ids.igPage });
      const meta = fakeMeta(() => okProfile({ name: 'ร้านสวย', username: 'suay_shop' }));

      await syncCustomerProfile(igPage(), id, 'psid_ig');

      expect(meta.urls[0]).toContain('username');
      expect(meta.urls[0], 'IG ไม่มีฟิลด์ first_name').not.toContain('first_name');
      expect((await readCustomer(id)).name).toBe('ร้านสวย');
    });

    it('Instagram ไม่มี name → ใช้ username แทน', async () => {
      const id = await makeCustomer({ page: ids.igPage });
      fakeMeta(() => okProfile({ username: 'suay_shop' }));

      await syncCustomerProfile(igPage(), id, 'psid_ig');
      expect((await readCustomer(id)).name).toBe('suay_shop');
    });
  });

  /* ============================================================== */
  describe('เหตุผลที่พลาด ต้องอ่านแล้วรู้ว่าต้องทำอะไรต่อ', () => {
    it('token หมดอายุ → บอกให้ไปสร้างใหม่', () => {
      const msg = explainProfileError(
        { kind: 'permanent', code: 190, subcode: null, message: 'x', fbtrace_id: null, message_th: '', window_actually_closed: false },
        'facebook',
      );
      expect(msg).toContain('สร้างใหม่');
    });

    it('🔴 สิทธิ์ไม่พอ → ต้องบอกชื่อสิทธิ์ ไม่ใช่บอกลอย ๆ', () => {
      const fb = explainProfileError(
        { kind: 'permanent', code: 10, subcode: null, message: 'x', fbtrace_id: null, message_th: '', window_actually_closed: false },
        'facebook',
      );
      expect(fb).toContain('pages_messaging');

      const ig = explainProfileError(
        { kind: 'permanent', code: 10, subcode: null, message: 'x', fbtrace_id: null, message_th: '', window_actually_closed: false },
        'instagram',
      );
      expect(ig).toContain('instagram_manage_messages');
    });

    it('⭐ code 100 ต้องแยกจาก "สิทธิ์ไม่พอ" — อาจเป็นความเป็นส่วนตัวของลูกค้า', () => {
      /** ถ้าไม่แยก เจ้าของร้านจะไล่แก้ token ไม่จบทั้งที่ token ถูกอยู่แล้ว */
      const msg = explainProfileError(
        { kind: 'permanent', code: 100, subcode: null, message: 'x', fbtrace_id: null, message_th: '', window_actually_closed: false },
        'facebook',
      );
      expect(msg).toContain('ความเป็นส่วนตัว');
    });

    it('🔴 ข้อความที่เก็บลง DB ต้องไม่มี token ปนเด็ดขาด', async () => {
      const id = await makeCustomer();
      fakeMeta(() => metaError(190, 'Invalid OAuth access token EAA-SUPER-SECRET-VALUE'));

      await syncCustomerProfile(fbPage(), id, 'psid_1');

      const row = await readCustomer(id);
      expect(row.profile_error_th).not.toContain('EAA');
      expect(row.profile_error_th).not.toContain('SECRET');
    });
  });

  /* ============================================================== */
  describe('ซ่อมข้อมูลเดิมที่ถูกตีตราว่า "ดึงแล้ว"', () => {
    it('⭐ migration 0014 ต้องปลดล็อกแถวที่พลาดไว้ ให้กลับมาลองใหม่ได้', async () => {
      /**
       * ลูกค้าที่มีอยู่ก่อนแก้บั๊ก ถูกจด synced_at ไว้ทั้งที่ไม่มีชื่อ
       * ถ้า migration ไม่ปลดล็อกให้ คนเหล่านั้นจะค้างเป็น "ลูกค้า xxxxxx" ตลอดไป
       */
      const id = await makeCustomer();
      await pool.query(
        `update customers set profile_synced_at = now(), name = null, profile_pic_url = null where id = $1`,
        [id],
      );

      // จำลองการรัน migration 0014 ส่วนที่ซ่อมข้อมูล
      await pool.query(`
        update customers set profile_synced_at = null, profile_attempts = 0
         where profile_synced_at is not null
           and (name is null or btrim(name) = '')
           and (profile_pic_url is null or btrim(profile_pic_url) = '')`);

      fakeMeta(() => okProfile({ first_name: 'กลับมาได้', last_name: 'แล้ว' }));
      const out = await syncCustomerProfile(fbPage(), id, 'psid_1');

      expect(out.kind).toBe('synced');
      expect((await readCustomer(id)).name).toBe('กลับมาได้ แล้ว');
    });

    it('🔴 แถวที่มีชื่ออยู่แล้ว ต้องไม่ถูกแตะ', async () => {
      const id = await makeCustomer({ name: 'มีชื่ออยู่แล้ว' });
      await pool.query(`update customers set profile_synced_at = now() where id = $1`, [id]);

      await pool.query(`
        update customers set profile_synced_at = null, profile_attempts = 0
         where profile_synced_at is not null
           and (name is null or btrim(name) = '')
           and (profile_pic_url is null or btrim(profile_pic_url) = '')`);

      const row = await readCustomer(id);
      expect(row.profile_synced_at, 'แถวที่ใช้ได้อยู่แล้วถูกปลดล็อกโดยไม่จำเป็น').not.toBeNull();
      expect(row.name).toBe('มีชื่ออยู่แล้ว');
    });
  });
});
