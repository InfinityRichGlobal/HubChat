import 'server-only';
/**
 * Cloudflare R2 — "จุดเดียว" ในระบบที่คุยกับที่เก็บไฟล์ (D-17)
 * ===========================================================================
 * 🔴 ทำไมต้องมีไฟล์นี้ (ปัญหาที่กำลังแก้) :
 *
 *    รูปที่ลูกค้าส่งมาทาง Messenger เก็บมาเป็น "ลิงก์ชั่วคราวของ Meta"
 *    ซึ่งหมดอายุในเวลาไม่นาน พอหมดอายุแล้ว **เปิดดูย้อนหลังไม่ได้อีกเลย**
 *
 *    เรื่องนี้ไม่ใช่ความสวยงาม — สลิปโอนเงินคือหลักฐานการชำระเงิน
 *    ลูกค้าโอนมาแล้วเราเปิดสลิปไม่ได้ = ทะเลาะกันโดยไม่มีใครพิสูจน์ได้
 *    และเป็นความเสียหายที่ "แก้ทีหลังไม่ได้" เพราะไฟล์หายไปแล้วจริง ๆ
 *
 *    ทางแก้เดียวคือ **ดาวน์โหลดมาเก็บเองทันทีที่ได้รับ** ก่อนลิงก์จะหมดอายุ
 *
 * ⚠️ ห้ามมีโค้ดที่คุยกับ R2 ที่ไฟล์อื่นเด็ดขาด (ชุดทดสอบสถาปัตยกรรมไล่ตรวจอยู่)
 *
 * ⭐ ระบบต้องทำงานได้แม้ยังไม่ได้ตั้งค่า R2
 *    ตอนนี้เจ้าของร้านยังไม่ได้เปิดบัญชี R2 — ถ้าไฟล์นี้ทำให้ระบบพัง
 *    แปลว่าเราบังคับให้เขาต้องตั้งค่าก่อนถึงจะใช้ระบบได้ ซึ่งไม่ถูกต้อง
 *    เมื่อยังไม่ตั้งค่า : isStorageConfigured() คืน false และทุกอย่างข้ามไปอย่างสุภาพ
 */
import { AwsClient } from 'aws4fetch';
import { createHash } from 'node:crypto';
import { serverEnv } from '@/config/env';

export class StorageNotConfiguredError extends Error {}

/**
 * 🔴 ลิงก์ต้นทางหมดอายุ/หายไปแล้ว — กู้ไม่ได้
 *
 * แยกเป็นชนิดข้อผิดพลาดของตัวเองโดยตั้งใจ ไม่ใช้การอ่านเลขจากข้อความ
 * เพราะเคยเขียนแบบเดาจากข้อความแล้วพลาด : ตอน R2 ตอบ 403 กลับมา
 * ระบบไปจดว่า "ไฟล์ของลูกค้าหายถาวร" ทั้งที่จริงแค่ตั้งค่าถังผิด
 * ซึ่งทำให้เจ้าของร้านเข้าใจผิดว่าสลิปหาย และไปตามหาผิดที่
 */
export class SourceGoneError extends Error {}

export type StoredObject = {
  /** ที่อยู่ของไฟล์ในถัง เช่น inbound/2026/08/ab12….jpg */
  key: string;
  bytes: number;
  mime: string;
  /** ลายนิ้วมือของไฟล์ — ใช้ตรวจว่าไฟล์เดิมหรือเปล่าโดยไม่ต้องดาวน์โหลดมาเทียบ */
  sha256: string;
};

/* ------------------------------------------------------------------------ */
/* การตั้งค่า                                                                 */
/* ------------------------------------------------------------------------ */

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

function readConfig(): R2Config | null {
  const env = serverEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
    return null;
  }
  return {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  };
}

/** ตั้งค่าครบหรือยัง — ที่อื่นใช้ตัวนี้ตัดสินใจว่าจะเก็บไฟล์หรือข้ามไป */
export function isStorageConfigured(): boolean {
  return readConfig() !== null;
}

/**
 * ตัวยิงจริง — แยกออกมาให้ชุดทดสอบสวมของปลอมเข้าไปได้
 * (แบบเดียวกับ Meta client เพื่อให้ทดสอบได้โดยไม่ต้องมีบัญชี R2 จริง)
 */
export type Fetcher = typeof fetch;
let _fetcher: Fetcher | null = null;

export function __setStorageFetcherForTests(f: Fetcher | null): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__setStorageFetcherForTests() ใช้บนเครื่องจริงไม่ได้');
  }
  _fetcher = f;
}

function client(cfg: R2Config): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    // R2 ไม่สนใจ region แต่ SigV4 บังคับให้ต้องมี — 'auto' คือค่าที่ Cloudflare แนะนำ
    region: 'auto',
  });
}

/**
 * เซ็นคำขอด้วย aws4fetch แล้ว "ยิงเอง" ด้วยตัวยิงของเรา
 *
 * ⚠️ ทำไมไม่ใช้ client.fetch() ตรง ๆ :
 *    aws4fetch ยิงด้วย fetch ตัวโลกเสมอ ใส่ตัวยิงของเราเข้าไปไม่ได้
 *    ผลคือชุดทดสอบจะวิ่งออกเน็ตจริง ซึ่งทั้งช้าและไม่น่าเชื่อถือ
 *    (เคยเป็นแบบนั้นแล้วเทสต์ล้มเพราะ DNS ไม่ใช่เพราะโค้ดผิด)
 *    แยก "เซ็น" กับ "ยิง" ออกจากกัน จึงสวมของปลอมได้และยังเซ็นถูกต้องเหมือนเดิม
 */
async function signedFetch(cfg: R2Config, url: string, init: RequestInit): Promise<Response> {
  const signed = await client(cfg).sign(url, init);
  return (_fetcher ?? fetch)(signed);
}

function endpoint(cfg: R2Config, key: string): string {
  // encode ทีละส่วนของ path เพื่อไม่ให้ '/' ที่คั่นโฟลเดอร์ถูกแปลงไปด้วย
  const safeKey = key.split('/').map(encodeURIComponent).join('/');
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${safeKey}`;
}

/* ------------------------------------------------------------------------ */
/* การตั้งชื่อไฟล์                                                             */
/* ------------------------------------------------------------------------ */

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
};

export function extensionFor(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? 'bin';
}

/**
 * สร้างที่อยู่ไฟล์จาก "เนื้อไฟล์" ไม่ใช่จากเวลาหรือเลขสุ่ม
 *
 * ⭐ ผลพลอยได้ที่สำคัญ : ไฟล์เดิมเป๊ะ ๆ จะได้ชื่อเดิมเสมอ
 *    ถ้าดาวน์โหลดซ้ำเพราะ webhook เข้ามาซ้ำ ก็แค่ทับที่เดิม ไม่เปลืองที่
 *    และไม่มีทางเกิดไฟล์ซ้ำหลายก้อนที่เนื้อหาเหมือนกัน
 *
 * @param prefix กลุ่มของไฟล์ เช่น 'inbound' / 'slip' / 'outbound'
 */
export function buildKey(prefix: string, sha256: string, mime: string, at: Date): string {
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, '') || 'misc';
  return `${safePrefix}/${yyyy}/${mm}/${sha256}.${extensionFor(mime)}`;
}

export function sha256Of(bytes: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

/* ------------------------------------------------------------------------ */
/* คำสั่งหลัก                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * เก็บไฟล์ลงถัง
 * @throws StorageNotConfiguredError ถ้ายังไม่ได้ตั้งค่า R2
 */
export async function putObject(
  key: string,
  bytes: ArrayBuffer,
  mime: string,
): Promise<StoredObject> {
  const cfg = readConfig();
  if (!cfg) throw new StorageNotConfiguredError('ยังไม่ได้ตั้งค่า Cloudflare R2');

  const res = await signedFetch(cfg, endpoint(cfg, key), {
    method: 'PUT',
    body: bytes,
    headers: {
      'Content-Type': mime,
      // ไฟล์ตั้งชื่อตามลายนิ้วมือ จึงไม่มีวันเปลี่ยนเนื้อหา — ให้แคชยาวได้เลย
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`เก็บไฟล์ลง R2 ไม่สำเร็จ (${res.status}): ${detail.slice(0, 200)}`);
  }

  return { key, bytes: bytes.byteLength, mime, sha256: sha256Of(bytes) };
}

/** อ่านไฟล์กลับมา — ใช้ตอนเสิร์ฟให้แอดมินดู */
export async function getObject(
  key: string,
): Promise<{ body: ArrayBuffer; mime: string } | null> {
  const cfg = readConfig();
  if (!cfg) throw new StorageNotConfiguredError('ยังไม่ได้ตั้งค่า Cloudflare R2');

  const res = await signedFetch(cfg, endpoint(cfg, key), { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`อ่านไฟล์จาก R2 ไม่สำเร็จ (${res.status})`);

  return {
    body: await res.arrayBuffer(),
    mime: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}

/**
 * ดาวน์โหลดไฟล์จากลิงก์ภายนอก (ลิงก์ชั่วคราวของ Meta) มาเก็บลงถัง
 *
 * ⚠️ จำกัดขนาดไว้ เพราะเราไม่รู้ว่าปลายทางส่งอะไรมา
 *    ถ้าไม่จำกัด ไฟล์วิดีโอยาว ๆ จะกินหน่วยความจำจนเซิร์ฟเวอร์ล้ม
 */
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export async function fetchAndStore(
  sourceUrl: string,
  prefix: string,
  now: Date,
): Promise<StoredObject> {
  const f = _fetcher ?? fetch;
  const res = await f(sourceUrl, { signal: AbortSignal.timeout(30_000) });

  // 🔴 403 / 404 / 410 = ลิงก์ชั่วคราวของ Meta หมดอายุแล้ว — ไฟล์นั้นกู้ไม่ได้อีก
  //    ต่างจาก 5xx ซึ่งแปลว่าปลายทางสะดุดชั่วคราว และลองใหม่ทีหลังได้
  if (res.status === 403 || res.status === 404 || res.status === 410) {
    throw new SourceGoneError(`ลิงก์ต้นทางหมดอายุแล้ว (${res.status})`);
  }
  if (!res.ok) throw new Error(`ดาวน์โหลดไฟล์ต้นทางไม่สำเร็จ (${res.status})`);

  // เช็กขนาดจากหัวคำตอบก่อน ถ้าใหญ่เกินก็ไม่ต้องเสียเวลาโหลด
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(`ไฟล์ใหญ่เกินไป (${Math.round(declared / 1024 / 1024)} MB)`);
  }

  const body = await res.arrayBuffer();
  // เช็กซ้ำหลังโหลดจริง เพราะบางเซิร์ฟเวอร์ไม่ส่ง content-length มา
  if (body.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`ไฟล์ใหญ่เกินไป (${Math.round(body.byteLength / 1024 / 1024)} MB)`);
  }

  const mime = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim();
  const sha = sha256Of(body);
  const key = buildKey(prefix, sha, mime, now);

  return putObject(key, body, mime);
}
