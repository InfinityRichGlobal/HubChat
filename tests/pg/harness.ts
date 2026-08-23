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
import { Client, Pool } from 'pg';

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
  } catch {
    return false;
  }
}

/** สร้างฐานข้อมูลใหม่แล้วรัน migration ทุกไฟล์ตามลำดับ */
export async function resetDatabase(): Promise<void> {
  const admin = new Client({ ...PG, database: 'postgres' });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const dir = path.resolve(__dirname, '../../supabase/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  const c = new Client({ ...PG, database: TEST_DB });
  await c.connect();
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

function q(id: string): string {
  return `"${id.replace(/"/g, '')}"`;
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
    const r = await pool.query(sql, names.map((n) => args[n]));
    return send(res, 200, r.rows.length === 1 && Object.keys(r.rows[0]).length === 0 ? null : r.rows);
  }

  const table = pathname.replace(/\/$/, '');
  const params: unknown[] = [];
  const where: string[] = [];
  let selectParam = '*';
  let order = '';
  let limit = '';

  for (const [k, v] of url.searchParams.entries()) {
    if (k === 'select') { selectParam = v; continue; }
    if (k === 'order') {
      const [col, dir] = v.split('.');
      order = ` order by ${q(col)} ${dir === 'desc' ? 'desc' : 'asc'}`;
      continue;
    }
    if (k === 'limit') { limit = ` limit ${parseInt(v, 10)}`; continue; }
    if (k === 'offset') continue;
    const dot = v.indexOf('.');
    const op = v.slice(0, dot);
    const val = v.slice(dot + 1);
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
        const c = await pool.query(`select count(*)::int as n from ${q(table)}${whereSql}`, params);
        total = c.rows[0].n;
      }
      if (req.method === 'GET') {
        const colSql = cols.includes('*') ? '*' : cols.map(q).join(', ');
        rows = (await pool.query(`select ${colSql} from ${q(table)}${whereSql}${order}${limit}`, params)).rows;
      }
    } else if (req.method === 'POST') {
      const payload = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
      const keys = Object.keys(payload[0]);
      const values = payload.map(
        (_row, i) => `(${keys.map((_k, j) => `$${i * keys.length + j + 1}`).join(',')})`,
      );
      const flat = payload.flatMap((row) => keys.map((k) => row[k]));
      const ret = prefer.includes('return=representation')
        ? ` returning ${cols.includes('*') ? '*' : cols.map(q).join(', ')}`
        : '';
      rows = (
        await pool.query(
          `insert into ${q(table)} (${keys.map(q).join(',')}) values ${values.join(',')}${ret}`,
          flat,
        )
      ).rows;
    } else if (req.method === 'PATCH') {
      const payload = body as Record<string, unknown>;
      const keys = Object.keys(payload);
      const sets = keys.map((k, i) => `${q(k)} = $${params.length + i + 1}`);
      const all = [...params, ...keys.map((k) => payload[k])];
      const ret = prefer.includes('return=representation')
        ? ` returning ${cols.includes('*') ? '*' : cols.map(q).join(', ')}`
        : '';
      rows = (await pool.query(`update ${q(table)} set ${sets.join(', ')}${whereSql}${ret}`, all)).rows;
    } else if (req.method === 'DELETE') {
      const r = await pool.query(`delete from ${q(table)}${whereSql} returning *`, params);
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
