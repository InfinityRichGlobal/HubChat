import 'server-only';
/**
 * Meta Graph API client — "จุดเดียว" ในระบบที่คุยกับ Meta
 * ===========================================================================
 * ⚠️ ห้ามมี fetch ไป graph.facebook.com ที่ไฟล์อื่นเด็ดขาด
 *    (ชุดทดสอบมีข้อที่ไล่ตรวจทั้งโปรเจกต์ ถ้ามีที่อื่นจะ fail ทันที)
 *
 * ทำไมต้องรวมไว้ที่เดียว :
 *   • เปลี่ยนเวอร์ชัน API ทีเดียวจบ
 *   • แปลง error เป็นรูปแบบเดียวกันทุกที่ ตัดสินใจ retry ได้ถูก
 *   • token ของเพจถูกถอดรหัสที่นี่ที่เดียว ไม่กระจายไปทั้งระบบ
 *
 * ไฟล์นี้ "ไม่รู้จัก" กฎของ Meta เรื่องกรอบเวลา — นั่นเป็นหน้าที่ของ Policy Engine
 * หน้าที่ของที่นี่คือ "ยิงตามที่สั่ง แล้วรายงานผลกลับให้ตรงความจริง" เท่านั้น
 */
import { serverEnv } from '@/config/env';
import { decryptSecret } from '@/lib/crypto';
import { classifyMetaError, type MetaErrorInfo, type RawMetaError } from './errors';

const GRAPH_HOST = 'https://graph.facebook.com';

/** ข้อมูลเพจเท่าที่ client ต้องใช้ */
export type MetaPage = {
  id: string;
  platform: 'facebook' | 'instagram';
  /** id ฝั่ง Meta */
  page_id: string;
  /** token ที่เข้ารหัสไว้ในฐานข้อมูล */
  access_token: string | null;
};

/** payload ที่ adapter ประกอบขึ้นมา — client ไม่แก้ไขเนื้อหา ส่งตามนั้น */
export type MetaSendPayload = Record<string, unknown>;

export type MetaSendResult =
  | { ok: true; message_id: string | null; http_status: number }
  | { ok: false; error: MetaErrorInfo; http_status: number };

/** ผลลัพธ์ที่ไม่รู้แน่ชัด — ใช้ตัดสินใจว่าห้าม retry */
export function isAmbiguousResult(r: MetaSendResult): boolean {
  return !r.ok && r.error.kind === 'ambiguous';
}

/** ตัวยิงจริง — แยกออกมาให้ชุดทดสอบสวมของปลอมเข้าไปได้ */
export type Fetcher = typeof fetch;

let _fetcher: Fetcher | null = null;

/**
 * ใช้ในชุดทดสอบเท่านั้น : สวม fetch ปลอมเข้าไปแทนของจริง
 * ⚠️ บนเครื่องจริงเรียกไม่ได้ — กันไม่ให้ใครสลับตัวยิงจริงตอนรันจริง
 */
export function __setFetcherForTests(f: Fetcher | null): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__setFetcherForTests() ใช้บนเครื่องจริงไม่ได้');
  }
  _fetcher = f;
}

function fetcher(): Fetcher {
  return _fetcher ?? fetch;
}

export class MetaNotConfiguredError extends Error {
  constructor(message_th: string) {
    super(message_th);
    this.name = 'MetaNotConfiguredError';
  }
}

/** ถอดรหัส token ของเพจ — ทำที่นี่ที่เดียว */
function pageToken(page: MetaPage): string {
  if (!page.access_token) {
    throw new MetaNotConfiguredError(
      `เพจนี้ยังไม่ได้เชื่อมต่อ (ไม่มี access token) — ไปเชื่อมเพจในหน้าตั้งค่าก่อน`,
    );
  }
  return decryptSecret(page.access_token);
}

/**
 * ส่งข้อความออกไปยัง Meta
 * @param page    เพจต้นทาง (ถือ token ไว้ฝั่งเซิร์ฟเวอร์เท่านั้น)
 * @param payload เนื้อหาที่ adapter ประกอบมาแล้ว
 */
export async function sendToMeta(page: MetaPage, payload: MetaSendPayload): Promise<MetaSendResult> {
  const env = serverEnv();
  const token = pageToken(page);
  const url = `${GRAPH_HOST}/${env.META_GRAPH_VERSION}/${encodeURIComponent(page.page_id)}/messages`;

  let res: Response;
  try {
    res = await fetcher()(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`, // token อยู่ใน header ไม่ใช่ query string — ไม่ติดใน log ของ proxy
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    // ⚠️ คำขอออกจากเครื่องเราไปแล้ว แต่ไม่ได้รับคำตอบ (timeout / เน็ตขาด / ปลายทางตัดสาย)
    //    เราไม่มีทางรู้ว่า Meta รับข้อความไปแล้วหรือยัง
    //    → ห้ามลองใหม่อัตโนมัติ เพราะลูกค้าอาจได้ข้อความซ้ำ แก้ไม่ได้
    return {
      ok: false,
      http_status: 0,
      error: classifyMetaError({ message: (err as Error).message }, 0, { networkFailure: true }),
    };
  }

  const body = (await res.json().catch(() => null)) as
    | { message_id?: string; error?: RawMetaError; message_id_?: string }
    | null;

  if (!res.ok || body?.error) {
    return {
      ok: false,
      http_status: res.status,
      error: classifyMetaError(body?.error ?? null, res.status),
    };
  }

  return { ok: true, message_id: body?.message_id ?? null, http_status: res.status };
}

/** ตรวจว่าตั้งค่า Meta App ครบหรือยัง — ใช้ตอนเปิดใช้ adapter */
export function isMetaConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.META_APP_ID && env.META_APP_SECRET);
}
