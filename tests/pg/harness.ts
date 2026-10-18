/**
 * ชุดทดสอบกับ PostgreSQL จริง — ตัวช่วยเตรียมสนามทดสอบ
 * ===========================================================================
 * ทำไมต้องมี :
 *   การรับประกันบางอย่างพิสูจน์ด้วยฐานข้อมูลปลอมไม่ได้ เช่น
 *     • คำขอสองอันมาพร้อมกันด้วยกุญแจเดียวกัน ใครได้สิทธิ์ยิง
 *     • unique constraint ทำงานจริงไหม
 *   ของพวกนี้ความปลอดภัยอยู่ที่ฐานข้อมูล ไม่ใช่ที่จังหวะของ JavaScript
 *   จึงต้องทดสอบกับ Postgres ของจริง
 *
 * วิธีทำงาน :
 *   1. สร้างฐานข้อมูลชั่วคราว แล้วรัน migration ทั้งหมด
 *   2. เปิดตัวแปลง REST → SQL เล็ก ๆ ขึ้นมา (พูดภาษาเดียวกับ Supabase)
 *      เพื่อให้โค้ดจริงของเราวิ่งผ่านเส้นทางเดิมทุกประการ ไม่ต้องแก้อะไรเลย
 *   3. ชี้ NEXT_PUBLIC_SUPABASE_URL มาที่ตัวนี้
 *
 * ถ้าเครื่องไม่มี Postgres ชุดทดสอบจะข้ามให้เอง (ไม่ทำให้ npm test พัง)
 *
 * ตั้งค่าที่อยู่ฐานข้อมูลได้ด้วย PGHOST / PGPORT / PGUSER / PGPASSWORD
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Client, Pool, types as pgTypes } from 'pg';

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
};

const TEST_DB = process.env.HUBCHAT_TEST_DB ?? 'hubchat_pgtest';
const REST_PORT = Number(process.env.HUBCHAT_TEST_REST_PORT ?? 54399);

/** ตรวจว่าต่อ Postgres ได้ไหม — ใช้ตัดสินว่าจะข้ามชุดทดสอบหรือไม่ */
export async function postgresAvailable(): Promise<boolean> {
  const c = new Client({ ...PG, database: 'postgres', connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch (error) {
    throw new Error('ต้องเปิด PostgreSQL สำหรับ test:pg ก่อนรัน (ตั้ง PGHOST/PGPORT/PGUSER/PGPASSWORD) — จะไม่ข้ามชุดทดสอบเงียบ ๆ', { cause: error });
  }
}

/** สร้างฐานข้อมูลใหม่แล้วรัน migration ทุกไฟล์ตามลำดับ */
export async function resetDatabase(): Promise<void> {
  if (!['127.0.0.1', 'localhost', '::1'].includes(PG.host) || !/^hubchat_[a-z0-9_]*test$/.test(TEST_DB)) throw new Error('Test reset is restricted to a local hubchat_*test database');
  // ฐานข้อมูลใหม่ = ชนิดคอลัมน์ที่จำไว้ใช้ไม่ได้แล้ว
  COLUMN_TYPES.clear();
  const admin = new Client({ ...PG, database: 'postgres' });
  await admin.connect();
  await admin.query(`drop database if exists ${q(TEST_DB)} with (force)`);
  await admin.query(`create database ${q(TEST_DB)}`);
  await admin.end();

  const dir = path.resolve(__dirname, '../../supabase/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  const c = new Client({ ...PG, database: TEST_DB });
  await c.connect();

  /**
   * 🔴 สร้าง role ของ Supabase ให้ก่อนรัน migration
   *
   *    Supabase มี role พวกนี้มาให้ตั้งแต่ต้น แต่ PostgreSQL เปล่า ๆ ไม่มี
   *    migration 0017/0018 มีคำสั่ง `revoke ... from anon, authenticated`
   *    และ `grant ... to service_role` ซึ่งถูกต้องแล้วสำหรับเครื่องจริง
   *    (เป็นการล็อกสิทธิ์ที่ควรทำ ห้ามถอดออกเพื่อให้เทสต์ผ่าน)
   *
   *    แต่บนเครื่องที่ไม่มี role พวกนี้ คำสั่งจะพังทันที
   *    ผลคือ **ชุดทดสอบ PostgreSQL ทั้งหมดรันไม่ได้เลย** — 286 ข้อถูกข้าม
   *    ซึ่งเป็นการเสียตาข่ายนิรภัยทั้งชั้นแบบเงียบ ๆ (ขึ้นเป็น skip ไม่ใช่ fail)
   *
   * ⚠️ ต้องสร้างที่ระดับ cluster ไม่ใช่ระดับ database — role เป็นของทั้ง cluster
   *    และต้องทนกรณีที่มีอยู่แล้ว (รันซ้ำได้)
   */
  await c.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
      end if;
    end $$;
  `);

  // Supabase provides this schema before application migrations. These tests
  // exercise database logic, not the external Storage HTTP service.
  await c.query(`
    create schema storage;
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint
    );
  `);

  for (const f of files) {
    await c.query(readFileSync(path.join(dir, f), 'utf8'));
  }
  await c.end();
}

export function testPool(): Pool {
  return new Pool({ ...PG, database: TEST_DB });
}

/* ------------------------------------------------------------------------ */
/* ตัวแปลง REST → SQL (พูดภาษาเดียวกับ Supabase เท่าที่โค้ดเราใช้จริง)          */
/* ------------------------------------------------------------------------ */

const OPS: Record<string, string> = {
  eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', ilike: 'ILIKE', like: 'LIKE',
};


/** ตัดสตริงด้วยเครื่องหมายจุลภาค โดยไม่ตัดข้างในวงเล็บหรือเครื่องหมายคำพูด */
function splitTop(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  let escaped = false;
  for (const ch of input) {
    if (escaped) { cur += ch; escaped = false; continue; }
    if (quoted && ch === '\\') { cur += ch; escaped = true; continue; }
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '(') depth += 1;
    if (!quoted && ch === ')') depth -= 1;
    if (!quoted && depth === 0 && ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function q(id: string): string {
  return `"${id.replace(/"/g, '')}"`;
}

/**
 * ⭐ ตัวจำลองต้องรู้ "ชนิดของคอลัมน์" ไม่งั้นแยก jsonb กับ array ของ Postgres ไม่ออก
 *
 * 🔴 บทเรียนรอบ 8 : ตอนแรกแปลง array ของ JavaScript เป็นข้อความ JSON ทุกตัว
 *    ผลคือคอลัมน์ jsonb (เช่น headers, problems) ใช้ได้
 *    แต่คอลัมน์ที่เป็น array จริง ๆ (candidate_order_ids uuid[]) พัง
 *    ถ้าไม่แปลงเลย ก็สลับกันพังอีกด้าน
 *
 *    PostgREST ตัวจริงรู้ชนิดคอลัมน์จาก catalog อยู่แล้ว ตัวจำลองจึงต้องรู้ด้วย
 *    (บทเรียนซ้ำรอย D-50 และ D-61 : ตัวจำลองที่ "เดา" ทำให้เทสต์ผ่านทั้งที่ของจริงพัง)
 */
const COLUMN_TYPES = new Map<string, Map<string, string>>();

async function columnTypes(pool: Pool, table: string): Promise<Map<string, string>> {
  const cached = COLUMN_TYPES.get(table);
  if (cached) return cached;

  const r = await pool.query(
    `select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = $1`,
    [table],
  );
  const m = new Map<string, string>(
    (r.rows as Array<{ column_name: string; data_type: string }>).map((x) => [x.column_name, x.data_type]),
  );
  COLUMN_TYPES.set(table, m);
  return m;
}

/** แปลงค่าให้ตรงกับชนิดของคอลัมน์ก่อนส่งให้ node-postgres */
function coerceValue(types: Map<string, string>, column: string, value: unknown): unknown {
  const t = types.get(column);
  if ((t === 'json' || t === 'jsonb') && value !== null && typeof value === 'object') {
    // jsonb ต้องได้ "ข้อความ JSON" ไม่ใช่ array ของ Postgres
    return JSON.stringify(value);
  }
  return value;
}

export type RestServer = { close: () => Promise<void>; url: string };

export async function startRestServer(pool: Pool): Promise<RestServer> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      handle(pool, req, res, body).catch((e: Error) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: e.message }));
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(REST_PORT, resolve));
  return {
    url: `http://127.0.0.1:${REST_PORT}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// PostgREST preserves microseconds. Date serialization would silently corrupt cursors.
function restQuery(pool: Pool, text: string, values: unknown[] = []) {
  return pool.query({ text, values, types: { getTypeParser(oid: number) {
    return oid === 1184 ? (value: string) => value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00') : pgTypes.getTypeParser(oid);
  } } });
}

async function handle(
  pool: Pool,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: unknown,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x');
  const pathname = url.pathname.replace(/^\/rest\/v1\//, '');

  /* ---- เรียกฟังก์ชันในฐานข้อมูล (ที่ที่ความปลอดภัยอยู่จริง) ---- */
  if (pathname.startsWith('rpc/')) {
    const fn = pathname.slice(4);
    const args = (body ?? {}) as Record<string, unknown>;
    const names = Object.keys(args);
    const sql = `select * from ${q(fn)}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
    // ⚠️ ค่า array ของ JavaScript ต้องแปลงเป็นข้อความ JSON ก่อน
    //    ไม่งั้น node-postgres จะแปลงเป็น array ของ Postgres ({...}) ซึ่งใส่ในช่อง jsonb ไม่ได้
    //    (ตัว PostgREST จริงรับ JSON มาทั้งก้อนอยู่แล้ว จึงไม่มีปัญหานี้)
    //    ถ้าวันหนึ่งมีฟังก์ชันที่รับ text[] / uuid[] จริง ๆ ต้องกลับมาแก้ตรงนี้
    const r = await restQuery(pool,
      sql,
      names.map((n) => (Array.isArray(args[n]) ? JSON.stringify(args[n]) : args[n])),
    );
    const meta = await restQuery(pool, `select p.proretset, t.typtype from pg_proc p join pg_type t on t.oid=p.prorettype join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 limit 1`, [fn]);
    const scalar = meta.rows[0] && !meta.rows[0].proretset && meta.rows[0].typtype !== 'c' && r.fields.length === 1 && r.fields[0].name === fn;
    return send(res, 200, scalar ? (r.rows[0]?.[fn] ?? null) : r.rows);
  }

  const table = pathname.replace(/\/$/, '');
  const params: unknown[] = [];
  const where: string[] = [];
  let selectParam = '*';
  let order = '';
  let limit = '';
  let offset = '';

  for (const [k, v] of url.searchParams.entries()) {
    if (k === 'select') { selectParam = v; continue; }
    if (k === 'order') {
      /**
       * ⚠️ PostgREST รับหลายคอลัมน์คั่นด้วยจุลภาค เช่น order=created_at.desc,id.desc
       *    ตอนแรกตัวจำลองอ่านแค่คอลัมน์แรก ทำให้ "ตัวตัดสินตอนเวลาเท่ากัน"
       *    ที่เพิ่งใส่เข้าไปกลายเป็นของหลอก — เทสต์ผ่านทั้งที่ของจริงยังไม่คงที่
       *    (บทเรียนเดียวกับ D-50 เรื่องตัวดำเนินการ is)
       */
      const parts = v
        .split(',')
        .map((one) => {
          const [col, dir, nulls] = one.split('.');
          return `${q(col)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullslast' ? ' nulls last' : nulls === 'nullsfirst' ? ' nulls first' : ''}`;
        })
        .filter(Boolean);
      if (parts.length > 0) order = ` order by ${parts.join(', ')}`;
      continue;
    }
    if (k === 'limit') { limit = ` limit ${parseInt(v, 10)}`; continue; }
    if (k === 'offset') { offset = ` offset ${parseInt(v, 10)}`; continue; }

    /* ---- or=(cond,cond) : ใช้ในช่องค้นหาของอินบ็อกซ์ ---- */
    if (k === 'or' || k === 'and') {
      const expression = (part: string): string => {
        const nested = /^(and|or)\((.*)\)$/.exec(part);
        if (nested) return `(${splitTop(nested[2]).map(expression).join(` ${nested[1]} `)})`;
        const condition = /^([a-z_]+)\.([a-z]+)\.(.*)$/.exec(part);
        if (!condition) throw new Error(`Unsupported logical filter: ${part}`);
        const [, col, op, raw] = condition;
        if (op === 'is' && raw === 'null') return `${q(col)} is null`;
        if (op === 'not' && raw === 'is.null') return `${q(col)} is not null`;
        if (!OPS[op]) throw new Error(`Unsupported logical operator: ${op}`);
        const value = raw.startsWith('"') ? JSON.parse(raw) : raw;
        params.push(op === 'ilike' || op === 'like' ? value.replace(/\*/g, '%') : value);
        return `${q(col)} ${OPS[op]} $${params.length}`;
      };
      where.push(`(${splitTop(v.slice(1, -1)).map(expression).join(` ${k} `)})`);
      continue;
    }

    const dot = v.indexOf('.');
    const op = v.slice(0, dot);
    const val = v.slice(dot + 1);

    /* ---- col=not.<op>.<value> ----
     * ⚠️ PostgREST ใช้ not.is.null / not.eq.x สำหรับการปฏิเสธเงื่อนไข
     *    🔴 ตอนแรกตัวจำลองไม่รู้จัก แล้ว "เมินเงียบ ๆ"
     *       ผลคือตัวกรอง .not('matched_keyword','is',null) ไม่ทำงานเลย
     *       แต่เทสต์ผ่าน เพราะไม่มีใครสังเกตว่าได้ผลลัพธ์เกินมา
     *       (บทเรียนซ้ำรอย D-50 / D-61 / D-69 — ตัวจำลองที่เงียบคือกับดัก)
     */
    if (op === 'not') {
      const rest = val;
      const d = rest.indexOf('.');
      const innerOp = d === -1 ? rest : rest.slice(0, d);
      const innerVal = d === -1 ? '' : rest.slice(d + 1);

      if (innerOp === 'is') {
        const target = innerVal.toLowerCase();
        if (target === 'null') where.push(`${q(k)} is not null`);
        else if (target === 'true') where.push(`${q(k)} is not true`);
        else if (target === 'false') where.push(`${q(k)} is not false`);
        continue;
      }
      if (OPS[innerOp]) {
        params.push(innerVal);
        where.push(`not (${q(k)} ${OPS[innerOp]} $${params.length})`);
        continue;
      }
      if (innerOp === 'in') {
        const items = splitTop(innerVal.replace(/^\(|\)$/g, '')).map((x) => x.replace(/^"|"$/g, ''));
        params.push(items);
        where.push(`not (${q(k)}::text = any($${params.length}::text[]))`);
        continue;
      }
      // ไม่รู้จัก = ต้องดังทันที ห้ามเมินเงียบ ๆ
      throw new Error(`ตัวจำลอง PostgREST ยังไม่รองรับ not.${innerOp} — เพิ่มใน tests/pg/harness.ts ก่อน`);
    }

    /* ---- col=is.null / col=is.not.null ----
     * ⚠️ PostgREST ใช้ตัวนี้แทน eq สำหรับค่าว่าง เพราะ SQL เทียบ null ด้วย = ไม่ได้
     *    (ตอนแรกลืมใส่ในตัวจำลอง ทำให้ตัวกรอง .is('archived_at', null) เงียบหายไปเฉย ๆ
     *     แล้วเทสต์ผ่านทั้งที่ของจริงยังไม่ถูกกรอง — ชุดทดสอบวิธีจัดส่งเป็นตัวจับได้)
     */
    if (op === 'is') {
      const target = val.toLowerCase();
      if (target === 'null') where.push(`${q(k)} is null`);
      else if (target === 'not.null') where.push(`${q(k)} is not null`);
      else if (target === 'true') where.push(`${q(k)} is true`);
      else if (target === 'false') where.push(`${q(k)} is false`);
      continue;
    }

    /* ---- col=in.(a,b,c) ---- */
    if (op === 'in') {
      const items = splitTop(val.replace(/^\(|\)$/g, '')).map((x) => x.replace(/^"|"$/g, ''));
      params.push(items);
      where.push(`${q(k)}::text = any($${params.length}::text[])`);
      continue;
    }

    if (!OPS[op]) continue;
    params.push(val);
    where.push(`${q(k)} ${OPS[op]} $${params.length}`);
  }

  const whereSql = where.length ? ` where ${where.join(' and ')}` : '';
  const prefer = String(req.headers['prefer'] ?? '');
  const wantCount = prefer.includes('count=exact');
  const wantObject = String(req.headers['accept'] ?? '').includes('pgrst.object');
  const cols = selectParam === '*' ? ['*'] : selectParam.split(',').filter((c) => !c.includes('('));

  let rows: Record<string, unknown>[] = [];
  let total: number | null = null;

  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (wantCount) {
        const c = await restQuery(pool, `select count(*)::int as n from ${q(table)}${whereSql}`, params);
        total = c.rows[0].n;
      }
      if (req.method === 'GET') {
        const colSql = cols.includes('*') ? '*' : cols.map(q).join(', ');
        rows = (await restQuery(pool, `select ${colSql} from ${q(table)}${whereSql}${order}${limit}${offset}`, params)).rows;
      }
    } else if (req.method === 'POST') {
      const payload = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
      const keys = Object.keys(payload[0]);
      const values = payload.map(
        (_row, i) => `(${keys.map((_k, j) => `$${i * keys.length + j + 1}`).join(',')})`,
      );
      const types = await columnTypes(pool, table);
      const flat = payload.flatMap((row) => keys.map((k) => coerceValue(types, k, row[k])));
      const ret = prefer.includes('return=representation')
        ? ` returning ${cols.includes('*') ? '*' : cols.map(q).join(', ')}`
        : '';
      const conflictKeys = (url.searchParams.get('on_conflict') ?? 'id').split(',');
      const conflict = prefer.includes('resolution=ignore-duplicates') ? ` on conflict (${conflictKeys.map(q).join(',')}) do nothing`
        : prefer.includes('resolution=merge-duplicates') ? ` on conflict (${conflictKeys.map(q).join(',')}) do update set ${keys.map(k => `${q(k)}=excluded.${q(k)}`).join(',')}` : '';
      rows = (
        await restQuery(pool,
          `insert into ${q(table)} (${keys.map(q).join(',')}) values ${values.join(',')}${conflict}${ret}`,
          flat,
        )
      ).rows;
    } else if (req.method === 'PATCH') {
      const payload = body as Record<string, unknown>;
      const keys = Object.keys(payload);
      const sets = keys.map((k, i) => `${q(k)} = $${params.length + i + 1}`);
      const types = await columnTypes(pool, table);
      const all = [...params, ...keys.map((k) => coerceValue(types, k, payload[k]))];
      const ret = prefer.includes('return=representation')
        ? ` returning ${cols.includes('*') ? '*' : cols.map(q).join(', ')}`
        : '';
      rows = (await restQuery(pool, `update ${q(table)} set ${sets.join(', ')}${whereSql}${ret}`, all)).rows;
    } else if (req.method === 'DELETE') {
      const r = await restQuery(pool, `delete from ${q(table)}${whereSql} returning *`, params);
      rows = prefer.includes('return=representation') ? r.rows : [];
    }
  } catch (err) {
    const e = err as { message: string; code?: string };
    return send(res, 400, { message: e.message, code: e.code ?? 'ERR', details: null, hint: null });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (total !== null) headers['Content-Range'] = `0-${Math.max(0, rows.length - 1)}/${total}`;

  if (wantObject) {
    if (rows.length === 0) {
      res.writeHead(406, headers);
      return void res.end(JSON.stringify({ code: 'PGRST116', message: 'Results contain 0 rows' }));
    }
    res.writeHead(200, headers);
    return void res.end(JSON.stringify(rows[0]));
  }

  res.writeHead(req.method === 'POST' ? 201 : 200, headers);
  res.end(req.method === 'HEAD' ? '' : JSON.stringify(rows));
}

function send(res: http.ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
