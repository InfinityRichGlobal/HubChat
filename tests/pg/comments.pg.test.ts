/**
 * ชุดทดสอบฟีดคอมเมนต์กับ PostgreSQL จริง (รอบ 9 — สเปกหัวข้อ 5.5 + 6.4)
 * ===========================================================================
 * ชุดนี้พิสูจน์เรื่องที่ฐานข้อมูลปลอมพิสูจน์ไม่ได้ :
 *
 *   1. ⭐ คอมเมนต์เดิมจาก Meta เข้ามาซ้ำ → บันทึกครั้งเดียว
 *   2. 🔴 "ทักส่วนตัว" ทำได้ครั้งเดียวต่อคอมเมนต์ตลอดกาล (กฎของ Meta)
 *   3. 🔴 สองคำขอพร้อมกัน → ยิง Meta ครั้งเดียวเท่านั้น
 *   4. 🔴 ไม่ทราบผล → ไม่คืนสิทธิ์ (ยอมเสียสิทธิ์ ดีกว่าลูกค้าได้ข้อความซ้ำ)
 *   5. รู้แน่ว่า Meta ปฏิเสธ → คืนสิทธิ์ให้ลองใหม่ได้
 *   6. คอมเมนต์เก่าเกิน 7 วัน → ปฏิเสธตั้งแต่ต้น ไม่ยิงออกไปเปล่า ๆ
 *   7. ⭐ ไม่มีการตอบอัตโนมัติ — สายรับข้อมูลแค่บันทึก ไม่ยิงอะไรเลย
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
  saveIncomingComment, listComments, getComment, setHandled,
  getFilterWords, saveFilterWords, CommentError,
} = await import('@/server/comments/service');
const { replyPrivate, replyPublic } = await import('@/server/comments/actions');
const { processCommentAutoReply, saveCommentBotSettings } = await import('@/server/comments/bot');
const { __setFetcherForTests } = await import('@/server/meta/client');
const { encryptSecret } = await import('@/lib/crypto');
const { DEFAULT_FILTER_WORDS } = await import('@/server/comments/filter');

let pool: Pool;
let rest: RestServer;

const ids = {
  page: randomUUID(),
  otherPage: randomUUID(),
  owner: randomUUID(),
  admin: randomUUID(),
};

const PAGE_META_ID = '111111';

type Who = Parameters<typeof listComments>[0];

function who(id: string, role: 'owner' | 'admin', allowed: string[] = []): Who {
  return {
    id,
    name: role === 'owner' ? 'เจ้าของ' : 'แอดมิน',
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

function comment(over: Partial<Parameters<typeof saveIncomingComment>[0]> = {}) {
  return {
    page_id: over.page_id ?? ids.page,
    comment_id: over.comment_id ?? 'cmt_1',
    post_id: over.post_id ?? 'post_1',
    parent_comment_id: over.parent_comment_id ?? null,
    from_id: over.from_id ?? 'fbuser_1',
    from_name: over.from_name ?? 'คุณสมชาย',
    message: over.message ?? 'ราคาเท่าไหร่คะ',
    permalink: over.permalink ?? 'https://facebook.com/post_1',
    attachment_url: over.attachment_url ?? null,
    is_from_page: over.is_from_page ?? false,
    commented_at: over.commented_at ?? new Date().toISOString(),
    raw: over.raw ?? {},
  };
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
  new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const errorResponse = (code: number, message: string, status = 400) =>
  new Response(JSON.stringify({ error: { code, message, type: 'OAuthException' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/* ================================================================== */
describe.skipIf(!available)('PostgreSQL จริง — ฟีดคอมเมนต์', () => {
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
    await pool.query('delete from comments');
    await pool.query('delete from conversations');
    await pool.query('delete from customers');
    await pool.query('delete from pages');
    await pool.query('delete from admins');
    await pool.query(`delete from app_settings where key in ('comment_filter_words', 'comment_bot_settings')`);

    await pool.query(
      `insert into admins (id, name, email, password_hash, role)
       values ($1,'เจ้าของ','owner@test.local','x','owner'),
              ($2,'แอดมิน','admin@test.local','x','admin')`,
      [ids.owner, ids.admin],
    );

    await pool.query(
      `insert into pages (id, platform, page_id, page_name, access_token, is_active)
       values ($1,'facebook',$3,'เพจทดสอบ',$2,true),
              ($4,'facebook','222222','เพจที่สอง',$2,true)`,
      [ids.page, encryptSecret('EAA-fake'), PAGE_META_ID, ids.otherPage],
    );
  });

  /* ============================================================== */
  /* A) บันทึกคอมเมนต์                                                */
  /* ============================================================== */
  it('⭐ คอมเมนต์เดิมเข้ามาซ้ำ → บันทึกครั้งเดียว', async () => {
    const first = await saveIncomingComment(comment(), DEFAULT_FILTER_WORDS);
    expect(first.duplicate).toBe(false);

    const second = await saveIncomingComment(comment(), DEFAULT_FILTER_WORDS);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);

    const { rows } = await pool.query('select count(*)::int n from comments');
    expect(rows[0].n).toBe(1);
  });

  it('webhook และ sync พร้อมกัน 8 ครั้ง → รายงานรายการใหม่ครั้งเดียวและเติมโปรไฟล์ได้', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => saveIncomingComment(comment(), [])));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const enriched = await saveIncomingComment({ ...comment(), from_username: 'customer', from_pic_url: 'https://example.com/avatar.png' }, []);
    expect(enriched.duplicate).toBe(true);
    const { rows } = await pool.query('select from_username, from_pic_url from comments');
    expect(rows[0]).toEqual({ from_username: 'customer', from_pic_url: 'https://example.com/avatar.png' });
  });

  async function setupBot(extra: Record<string, unknown> = {}) {
    await saveCommentBotSettings(OWNER, {
      reply_mode: 'template', auto_reply_public: true,
      public_reply_template: 'ขอบคุณค่ะ {name}', ...extra,
    });
    const saved = await saveIncomingComment(comment(), []);
    const page = { id: ids.page, platform: 'facebook' as const, page_id: PAGE_META_ID, access_token: encryptSecret('EAA-fake') };
    const event = { comment_id: 'cmt_1', message: 'สนใจ', from_name: 'ลูกค้าตัวจริง', is_from_page: false };
    return { saved, run: () => processCommentAutoReply(page, event, saved.id) };
  }

  it('บอทหลายตัวตอบคอมเมนต์พร้อมกันและเรียกซ้ำ → ส่งสาธารณะครั้งเดียว', async () => {
    const bot = await setupBot();
    const meta = fakeMeta(() => okResponse('reply-1'));
    await Promise.all(Array.from({ length: 8 }, () => bot.run()));
    await bot.run();
    expect(meta.calls).toBe(1);
    const { rows } = await pool.query('select replied_public, bot_public_claimed_at from comments');
    expect(rows[0].replied_public).toBe(true);
    expect(rows[0].bot_public_claimed_at).not.toBeNull();
  });

  it('บอทส่งแล้ว timeout → ไม่ส่งซ้ำและแสดงเหตุผลให้แอดมิน', async () => {
    const bot = await setupBot();
    const meta = fakeMeta(() => { throw new Error('connection reset after sending'); });
    await bot.run();
    await bot.run();
    expect(meta.calls).toBe(1);
    const { rows } = await pool.query('select replied_public, last_error_th from comments');
    expect(rows[0].replied_public).toBe(false);
    expect(rows[0].last_error_th).toContain('ไม่ทราบผล');
  });

  it('public ล้มเหลวแล้ว private สำเร็จในรอบถัดไป → ยังแสดงข้อผิดพลาด public และไม่ส่ง public ซ้ำ', async () => {
    const bot = await setupBot({ auto_reply_private: true, private_reply_template: 'สวัสดีค่ะ' });
    const meta = fakeMeta((n) => n <= 2 ? errorResponse(10, 'Permission denied') : okResponse('private-1'));
    await bot.run();
    await bot.run();
    await bot.run();
    expect(meta.calls).toBe(3);
    const { rows } = await pool.query('select replied_public, replied_private, last_error_th from comments');
    expect(rows[0].replied_public).toBe(false);
    expect(rows[0].replied_private).toBe(true);
    expect(rows[0].last_error_th).toBeTruthy();
  });

  it('Meta ตอบรับแล้ว แต่บันทึกผลล้มเหลว → เก็บสิทธิ์ไว้ ป้องกันการส่งซ้ำ', async () => {
    const bot = await setupBot();
    const meta = fakeMeta(() => okResponse('reply-1'));
    await pool.query(`create function fail_comment_finish() returns trigger language plpgsql as $$
      begin if new.replied_public then raise exception 'simulated DB outage'; end if; return new; end $$;
      create trigger fail_comment_finish before update on comments for each row execute function fail_comment_finish();`);
    try {
      await bot.run();
    } finally {
      await pool.query('drop trigger fail_comment_finish on comments; drop function fail_comment_finish()');
    }
    await bot.run();
    expect(meta.calls).toBe(1);
    const { rows } = await pool.query('select replied_public, last_error_th from comments');
    expect(rows[0].replied_public).toBe(false);
    expect(rows[0].last_error_th).toContain('Meta รับคำตอบแล้ว');
  });

  it('เคยตอบสาธารณะแล้ว ยังทำ private reply แยกได้ โดยไม่เปลี่ยนชื่อลูกค้าตามห้องล่าสุด', async () => {
    const bot = await setupBot({ auto_reply_private: true, private_reply_template: 'สวัสดีค่ะ' });
    await pool.query('update comments set replied_public = true');
    const meta = fakeMeta(() => okResponse('private-1'));
    await bot.run();
    await bot.run();
    expect(meta.calls).toBe(1);
    const { rows } = await pool.query('select replied_private, from_name from comments');
    expect(rows[0]).toEqual({ replied_private: true, from_name: 'คุณสมชาย' });
  });

  it('ติดป้ายคำกรองให้ตอนบันทึก', async () => {
    const hit = await saveIncomingComment(comment({ message: 'สนใจค่ะ' }), DEFAULT_FILTER_WORDS);
    expect(hit.matched).toBe('สนใจ');

    const miss = await saveIncomingComment(
      comment({ comment_id: 'cmt_2', message: 'สวยจังเลย' }),
      DEFAULT_FILTER_WORDS,
    );
    expect(miss.matched).toBeNull();
  });

  it('⭐ คอมเมนต์ของเพจเราเอง ถือว่าจัดการแล้ว และไม่โผล่ในฟีด', async () => {
    await saveIncomingComment(comment({ is_from_page: true }), DEFAULT_FILTER_WORDS);

    const feed = await listComments(OWNER);
    expect(feed.comments).toHaveLength(0);
    expect(feed.unhandled_count).toBe(0);
  });

  it('🔴 comment_id เดิมที่มาซ้ำ (แม้อ้างคนละเพจ) ต้องถือเป็นของซ้ำ ไม่ใช่โยน error', async () => {
    /**
     * id ของคอมเมนต์ฝั่ง Meta เป็นรูปแบบ "{post}_{comment}" ซึ่งไม่ซ้ำข้ามเพจอยู่แล้ว
     * ฐานข้อมูลมี unique บน comment_id มาตั้งแต่ 0001
     * ⚠️ เคยพลาด : ใช้ (page_id, comment_id) เป็นเป้าของ on conflict
     *    แล้วพอชนกับ index เดิม คำสั่งจะโยน error → สายรับข้อมูลพังทั้งก้อน
     */
    const first = await saveIncomingComment(comment({ comment_id: 'same' }), DEFAULT_FILTER_WORDS);
    const other = await saveIncomingComment(
      comment({ comment_id: 'same', page_id: ids.otherPage }),
      DEFAULT_FILTER_WORDS,
    );
    expect(other.duplicate).toBe(true);
    expect(other.id).toBe(first.id);
  });

  /* ============================================================== */
  /* B) ฟีดและสิทธิ์                                                  */
  /* ============================================================== */
  it('🔴 แอดมินเห็นเฉพาะคอมเมนต์ของเพจที่ตัวเองมีสิทธิ์', async () => {
    await saveIncomingComment(comment({ comment_id: 'a' }), DEFAULT_FILTER_WORDS);
    await saveIncomingComment(
      comment({ comment_id: 'b', page_id: ids.otherPage }),
      DEFAULT_FILTER_WORDS,
    );

    const scoped = who(ids.admin, 'admin', [ids.page]);
    const feed = await listComments(scoped);
    expect(feed.comments).toHaveLength(1);
    expect(feed.comments[0].comment_id).toBe('a');

    expect(await listComments(OWNER).then((f) => f.comments.length)).toBe(2);
  });

  it('ตัวกรอง "ยังไม่จัดการ" และ "เข้าคำกรอง"', async () => {
    const withWord = await saveIncomingComment(comment({ comment_id: 'a', message: 'ราคา' }), DEFAULT_FILTER_WORDS);
    await saveIncomingComment(comment({ comment_id: 'b', message: 'สวยจัง' }), DEFAULT_FILTER_WORDS);

    expect((await listComments(OWNER, { keyword_only: true })).comments).toHaveLength(1);
    expect((await listComments(OWNER, { unhandled_only: true })).comments).toHaveLength(2);

    await setHandled(OWNER, withWord.id!, true);
    expect((await listComments(OWNER, { unhandled_only: true })).comments).toHaveLength(1);
    expect((await listComments(OWNER)).unhandled_count).toBe(1);
  });

  it('paginates equal timestamps and null dates exactly once, with an accurate final page', async () => {
    for (let i = 0; i < 7; i++) await saveIncomingComment(comment({ comment_id: `page_${i}`, commented_at: '2026-10-18T10:00:00.000Z' }), []);
    await pool.query("update comments set commented_at = null where comment_id in ('page_5', 'page_6')");
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const feed = await listComments(OWNER, { limit: 2, cursor });
      seen.push(...feed.comments.map((c) => c.comment_id));
      expect(feed.has_more).toBe(page < 3);
      cursor = feed.next_cursor;
    }
    expect(new Set(seen).size).toBe(7);
    expect(seen).toHaveLength(7);
    expect(cursor).toBeNull();
    const exact = await listComments(OWNER, { limit: 7 });
    expect(exact.has_more).toBe(false);
  });

  it('combines search, status and cursor without widening the result set', async () => {
    for (let i = 0; i < 5; i++) await saveIncomingComment(comment({ comment_id: `find_${i}`, message: i === 4 ? 'อื่น' : 'สนใจ, (ราคา) 100%_ "ดี"', commented_at: '2026-10-18T10:00:00.000Z' }), []);
    await pool.query("update comments set is_handled = true where comment_id = 'find_3'");
    const first = await listComments(OWNER, { search: ', (ราคา) 100%_ "ดี"', status: 'pending', limit: 2 });
    const second = await listComments(OWNER, { search: ', (ราคา) 100%_ "ดี"', status: 'pending', limit: 2, cursor: first.next_cursor });
    expect(first.has_more).toBe(true);
    expect(second.has_more).toBe(false);
    expect(new Set([...first.comments, ...second.comments].map((c) => c.comment_id))).toEqual(new Set(['find_0', 'find_1', 'find_2']));
    expect((await listComments(OWNER, { search: 'not-present' })).comments).toHaveLength(0);
  });

  it('keeps failed work out of handled and deleted work out of pending counts', async () => {
    for (const id of ['pending', 'failed', 'handled', 'deleted']) await saveIncomingComment(comment({ comment_id: id }), []);
    await pool.query("update comments set is_handled = true where comment_id in ('failed', 'handled')");
    await pool.query("update comments set last_error_th = 'ส่งไม่สำเร็จ' where comment_id = 'failed'");
    await pool.query("update comments set is_deleted = true where comment_id = 'deleted'");
    for (const [status, expected] of [['pending', 'pending'], ['review', 'failed'], ['handled', 'handled'], ['deleted', 'deleted']] as const) {
      const result = await listComments(OWNER, { status });
      expect(result.comments.map((c) => c.comment_id)).toEqual([expected]);
      expect(result.unhandled_count).toBe(1);
      expect(result.review_count).toBe(1);
    }
  });

  it('does not silently show all permitted pages when requesting an inaccessible page', async () => {
    await saveIncomingComment(comment(), []);
    const result = await listComments(who(ids.admin, 'admin', [ids.page]), { page_id: ids.otherPage });
    expect(result.comments).toHaveLength(0);
    expect(result.unhandled_count).toBe(0);
  });

  it('rejects malformed pagination before querying comments', async () => {
    await expect(listComments(OWNER, { cursor: 'invalid' })).rejects.toThrow();
    const cursor = Buffer.from(JSON.stringify({ at: '2026-10-18T00:00:00Z', id: 'bad),id.gt.0' })).toString('base64url');
    await expect(listComments(OWNER, { cursor })).rejects.toThrow();
  });

  it('🔴 แตะคอมเมนต์ของเพจที่ไม่มีสิทธิ์ไม่ได้', async () => {
    const other = await saveIncomingComment(
      comment({ page_id: ids.otherPage }),
      DEFAULT_FILTER_WORDS,
    );
    const scoped = who(ids.admin, 'admin', [ids.page]);
    await expect(getComment(scoped, other.id!)).rejects.toThrow(/ไม่มีสิทธิ์/);
    await expect(setHandled(scoped, other.id!, true)).rejects.toThrow(/ไม่มีสิทธิ์/);
  });

  /* ============================================================== */
  /* C) 🔴 ทักส่วนตัว — ครั้งเดียวต่อคอมเมนต์ตลอดกาล                     */
  /* ============================================================== */
  it('🔴 ทักส่วนตัวได้ครั้งเดียว — ครั้งที่สองต้องถูกปฏิเสธ และไม่ยิง Meta', async () => {
    const saved = await saveIncomingComment(comment(), DEFAULT_FILTER_WORDS);
    const meta = fakeMeta(() => okResponse('m_1'));

    const first = await replyPrivate(OWNER, saved.id!, 'สวัสดีค่ะ');
    expect(first.ok).toBe(true);
    expect(meta.calls).toBe(1);

    await expect(replyPrivate(OWNER, saved.id!, 'ทักอีกที')).rejects.toThrow(/ครั้งเดียว/);
    // ⭐ ต้องไม่ยิงเพิ่มเลย
    expect(meta.calls).toBe(1);
  });

  it('🔴 สองคำขอพร้อมกัน → ยิง Meta ครั้งเดียวเท่านั้น', async () => {
    const saved = await saveIncomingComment(comment(), DEFAULT_FILTER_WORDS);
    const meta = fakeMeta(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return okResponse('m_1');
    });

    const results = await Promise.allSettled([
      replyPrivate(OWNER, saved.id!, 'ทัก 1'),
      replyPrivate(OWNER, saved.id!, 'ทัก 2'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(meta.calls).toBe(1);
  });

  it('🔴 ไม่ทราบผล → ไม่คืนสิทธิ์ (ยอมเสียสิทธิ์ ดีกว่าลูกค้าได้ข้อความซ้ำ)', async () => {
    const saved = await saveIncomingComment(comment(), DEFAULT_FILTER_WORDS);
    const meta = fakeMeta(() => {
      throw new Error('network down');
    });

    const result = await replyPrivate(OWNER, saved.id!, 'สวัสดีค่ะ');
    expect(result.ok).toBe(false);
    expect(result.outcome_unknown).toBe(true);
    expect(meta.calls).toBe(1);

    // ⭐ สิทธิ์ต้องยังถูกใช้ไปแล้ว — กดใหม่ไม่ได้
    const row = await pool.query('select replied_private, last_error_th from comments where id=$1', [saved.id]);
    expect(row.rows[0].replied_private).toBe(true);
    expect(row.rows[0].last_error_th).toContain('ไม่ทราบผล');

    await expect(replyPrivate(OWNER, saved.id!, 'ลองอีกที')).rejects.toThrow(/ครั้งเดียว/);
    expect(meta.calls).toBe(1);
  });

  it('รู้แน่ว่า Meta ปฏิเสธ → คืนสิทธิ์ให้ลองใหม่ได้', async () => {
    const saved = await saveIncomingComment(comment(), DEFAULT_FILTER_WORDS);

    const meta = fakeMeta((n) =>
      n === 1 ? errorResponse(4, 'Application request limit reached', 400) : okResponse('m_1'),
    );

    const first = await replyPrivate(OWNER, saved.id!, 'สวัสดีค่ะ');
    expect(first.ok).toBe(false);
    expect(first.outcome_unknown).toBe(false);

    const row = await pool.query('select replied_private from comments where id=$1', [saved.id]);
    expect(row.rows[0].replied_private).toBe(false);

    // ลองใหม่ได้และสำเร็จ
    const second = await replyPrivate(OWNER, saved.id!, 'สวัสดีค่ะ');
    expect(second.ok).toBe(true);
    expect(meta.calls).toBe(2);
  });

  it('🔴 คอมเมนต์เก่าเกิน 7 วัน → ปฏิเสธตั้งแต่ต้น ไม่ยิงออกไปเปล่า ๆ', async () => {
    const old = new Date(Date.now() - 8 * 24 * 3_600_000).toISOString();
    const saved = await saveIncomingComment(comment({ commented_at: old }), DEFAULT_FILTER_WORDS);
    const meta = fakeMeta(() => okResponse('m_1'));

    await expect(replyPrivate(OWNER, saved.id!, 'สวัสดี')).rejects.toThrow(/7 วัน/);
    expect(meta.calls).toBe(0);
  });

  it('คอมเมนต์ของเพจเราเอง → ทักส่วนตัวไม่ได้', async () => {
    const saved = await saveIncomingComment(comment({ is_from_page: true }), DEFAULT_FILTER_WORDS);
    const meta = fakeMeta(() => okResponse('m_1'));
    await expect(replyPrivate(OWNER, saved.id!, 'x')).rejects.toThrow(/เพจเราเอง/);
    expect(meta.calls).toBe(0);
  });

  it('ทักส่วนตัวสำเร็จ → ผูกกับห้องแชทของลูกค้าถ้าหาเจอ', async () => {
    const customerId = randomUUID();
    const convId = randomUUID();
    await pool.query(
      `insert into customers (id, page_id, psid, platform, name) values ($1,$2,'fbuser_1','facebook','คุณสมชาย')`,
      [customerId, ids.page],
    );
    await pool.query(
      `insert into conversations (id, customer_id, page_id, last_message_at) values ($1,$2,$3, now())`,
      [convId, customerId, ids.page],
    );

    const saved = await saveIncomingComment(comment(), DEFAULT_FILTER_WORDS);
    fakeMeta(() => okResponse('m_1'));

    const result = await replyPrivate(OWNER, saved.id!, 'สวัสดีค่ะ');
    expect(result.ok).toBe(true);
    expect(result.comment.conversation_id).toBe(convId);
    expect(result.comment.is_handled).toBe(true);
  });

  /* ============================================================== */
  /* D) ตอบใต้โพสต์                                                  */
  /* ============================================================== */
  it('ตอบใต้โพสต์สำเร็จ → จดว่าจัดการแล้ว', async () => {
    const saved = await saveIncomingComment(comment(), DEFAULT_FILTER_WORDS);
    const meta = fakeMeta(() => okResponse('reply_1'));

    const result = await replyPublic(OWNER, saved.id!, 'ทักแชทได้เลยค่ะ');
    expect(result.ok).toBe(true);
    expect(result.comment.replied_public).toBe(true);
    expect(result.comment.public_reply_text).toBe('ทักแชทได้เลยค่ะ');
    expect(result.comment.is_handled).toBe(true);
    expect(meta.calls).toBe(1);
  });

  it('ตอบใต้โพสต์ล้มเหลว → จดเหตุผล ไม่ปลอมว่าสำเร็จ', async () => {
    const saved = await saveIncomingComment(comment(), DEFAULT_FILTER_WORDS);
    fakeMeta(() => errorResponse(190, 'Invalid OAuth token', 401));

    const result = await replyPublic(OWNER, saved.id!, 'x');
    expect(result.ok).toBe(false);
    expect(result.comment.replied_public).toBe(false);
    expect(result.comment.last_error_th).toContain('token');
  });

  it('ข้อความว่าง / ยาวเกิน → ปฏิเสธก่อนยิง', async () => {
    const saved = await saveIncomingComment(comment(), DEFAULT_FILTER_WORDS);
    const meta = fakeMeta(() => okResponse('x'));

    await expect(replyPublic(OWNER, saved.id!, '   ')).rejects.toThrow(CommentError);
    await expect(replyPublic(OWNER, saved.id!, 'x'.repeat(2000))).rejects.toThrow(/ยาวเกิน/);
    expect(meta.calls).toBe(0);
  });

  /* ============================================================== */
  /* E) คำกรอง                                                       */
  /* ============================================================== */
  it('บันทึกและอ่านคำกรองได้ และคำว่างถูกตัดทิ้ง', async () => {
    expect(await getFilterWords()).toEqual(DEFAULT_FILTER_WORDS);

    const saved = await saveFilterWords(OWNER, ['ราคา', '', '  ', 'เท่าไหร่', 'ราคา']);
    expect(saved).toEqual(['ราคา', 'เท่าไหร่']);
    expect(await getFilterWords()).toEqual(['ราคา', 'เท่าไหร่']);
  });
});
