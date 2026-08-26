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
import { decryptSecret } from '@/lib/crypto';
import { getRuntimeSetting } from '@/server/settings/service';
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

async function graphVersion(): Promise<string> {
  return (await getRuntimeSetting('META_GRAPH_VERSION')) ?? 'v21.0';
}

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
  const token = pageToken(page);
  const url = `${GRAPH_HOST}/${await graphVersion()}/${encodeURIComponent(page.page_id)}/messages`;

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

/* ------------------------------------------------------------------------ */
/* การเขียนอย่างอื่นที่ไม่ใช่ "ข้อความหาลูกค้า" (รอบ 9)                            */
/* ------------------------------------------------------------------------ */

export type MetaPostResult =
  | { ok: true; data: Record<string, unknown>; http_status: number }
  | { ok: false; error: MetaErrorInfo; http_status: number };

/**
 * ยิง POST ไป Graph API สำหรับงานที่ "ไม่ใช่การส่งข้อความหาลูกค้าผ่าน Send API"
 * ===========================================================================
 * 🔴 ห้ามใช้ตัวนี้ส่งข้อความแชทเด็ดขาด
 *    การส่งข้อความทุกกรณีต้องผ่าน sendMessage() → Policy Engine → sendToMeta()
 *    (ชุดทดสอบสถาปัตยกรรมไล่ตรวจว่าไม่มีใครใช้ตัวนี้ยิง /messages)
 *
 * ใช้กับ : ตอบใต้โพสต์ / ทักส่วนตัวจากคอมเมนต์ / ซ่อนคอมเมนต์ (สเปก 5.5 + 6.4)
 *          ซึ่งเป็น endpoint คนละตัวและมีกฎของตัวเองต่างหาก
 */
export async function metaPost(
  page: MetaPage,
  pathSegment: string,
  payload: Record<string, unknown>,
): Promise<MetaPostResult> {
  const token = pageToken(page);

  // เข้ารหัสทีละท่อน — ดู D-62 (เข้ารหัสทั้งเส้นจะกินเครื่องหมาย / ของ path)
  const safePath = pathSegment.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const url = `${GRAPH_HOST}/${await graphVersion()}/${safePath}`;

  let res: Response;
  try {
    res = await fetcher()(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    // ยิงออกไปแล้วไม่รู้ผล — ผู้เรียกต้องตัดสินใจเองว่าจะทำอย่างไรต่อ
    return {
      ok: false,
      http_status: 0,
      error: classifyMetaError({ message: (err as Error).message }, 0, { networkFailure: true }),
    };
  }

  const body = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: RawMetaError })
    | null;

  if (!res.ok || body?.error) {
    return { ok: false, http_status: res.status, error: classifyMetaError(body?.error ?? null, res.status) };
  }

  return { ok: true, data: body ?? {}, http_status: res.status };
}

/* ------------------------------------------------------------------------ */
/* การอ่านข้อมูลจาก Meta (ไม่ใช่การส่งข้อความ)                                  */
/* ------------------------------------------------------------------------ */

export type MetaGetResult =
  | { ok: true; data: Record<string, unknown>; http_status: number }
  | { ok: false; error: MetaErrorInfo; http_status: number };

/**
 * อ่านข้อมูลจาก Graph API แบบ GET
 * ===========================================================================
 * ⚠️ ตัวนี้ "อ่านอย่างเดียว" ห้ามใช้ส่งข้อความเด็ดขาด
 *    การส่งข้อความทุกกรณีต้องผ่าน sendMessage() → Policy Engine → sendToMeta()
 *    ที่แยกกันชัดเจนเพราะการอ่านไม่มีความเสี่ยงเรื่องนโยบายของ Meta
 *    แต่การส่งมี และเป็นส่วนที่ผิดแล้วเพจโดนระงับ
 *
 * ใช้กับ : ดึงชื่อ/รูปโปรไฟล์ลูกค้า (webhook ไม่ได้ส่งชื่อมาให้)
 */
export async function metaGet(
  page: MetaPage,
  pathSegment: string,
  params: Record<string, string> = {},
): Promise<MetaGetResult> {
  const token = pageToken(page);
  const qs = new URLSearchParams(params).toString();
  /**
   * 🔴 ต้องเข้ารหัส "ทีละท่อน" ไม่ใช่ทั้งเส้น
   *    encodeURIComponent('12345/conversations') จะได้ '12345%2Fconversations'
   *    ซึ่ง Meta จะมองว่าเป็นชื่อวัตถุชิ้นเดียว แล้วตอบ error 100 กลับมา
   *    (เดิมไม่มีใครเรียกเส้นทางที่มีเครื่องหมาย / จึงไม่เคยเจอ — รอบ 7 เป็นรายแรก)
   */
  const safePath = pathSegment.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const url = `${GRAPH_HOST}/${await graphVersion()}/${safePath}` + (qs ? `?${qs}` : '');

  let res: Response;
  try {
    res = await fetcher()(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return {
      ok: false,
      http_status: 0,
      error: classifyMetaError({ message: (err as Error).message }, 0, { networkFailure: true }),
    };
  }

  const body = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: RawMetaError })
    | null;

  if (!res.ok || body?.error) {
    return { ok: false, http_status: res.status, error: classifyMetaError(body?.error ?? null, res.status) };
  }

  return { ok: true, data: body ?? {}, http_status: res.status };
}

/** ตรวจว่าตั้งค่า Meta App ครบหรือยัง — ใช้ตอนเปิดใช้ adapter */
export async function isMetaConfigured(): Promise<boolean> {
  const [appId, appSecret] = await Promise.all([
    getRuntimeSetting('META_APP_ID'), getRuntimeSetting('META_APP_SECRET'),
  ]);
  return Boolean(appId && appSecret);
}

/* ------------------------------------------------------------------------ */
/* อัปโหลดไฟล์แนบ (รอบ 6)                                                     */
/* ------------------------------------------------------------------------ */

export type MetaUploadResult =
  | { ok: true; attachment_id: string; http_status: number }
  | { ok: false; error: MetaErrorInfo; http_status: number };

/**
 * อัปโหลดรูปไปเก็บไว้ที่ Meta แล้วได้ attachment_id ที่ใช้ซ้ำได้
 *
 * ⭐ ทำไมใช้วิธีนี้ ไม่ใช่ส่งเป็น URL :
 *    การส่งรูปด้วย URL ต้องมีที่เก็บไฟล์ที่ Meta เข้าถึงได้จากอินเทอร์เน็ต
 *    ซึ่งเรายังไม่มี (D-17 / Cloudflare R2 ยังไม่ได้ทำ)
 *    แต่ Attachment Upload API รับ "ตัวไฟล์" ตรง ๆ ได้เลย
 *    → ส่งรูปออกได้จริงตั้งแต่รอบนี้ โดยไม่ต้องรอ R2
 *
 * ⚠️ ข้อจำกัดที่ต้องรู้ และจดไว้ใน DEFERRED_REVIEW :
 *    วิธีนี้ทำให้ "รูปที่แอดมินส่ง" ถูกเก็บไว้ที่ Meta ไม่ใช่ที่เรา
 *    เราเก็บแค่ attachment_id ไว้อ้างอิง ถ้าวันหนึ่งอยากได้สำเนาของตัวเอง
 *    (เช่น ทำรายงาน หรือย้ายระบบ) ยังต้องทำ R2 อยู่ดี
 *
 * ⚠️ ผลลัพธ์ที่ไม่รู้แน่ชัด (เน็ตขาดกลางทาง) ถือเป็น ambiguous เหมือนการส่งข้อความ
 *    แต่กรณีนี้ปลอดภัยกว่ามาก เพราะการอัปโหลดซ้ำไม่ได้ทำให้ลูกค้าเห็นอะไรเลย
 */
export async function uploadAttachmentToMeta(
  page: MetaPage,
  file: { bytes: ArrayBuffer; mime: string; filename: string },
  attachmentType: 'image' | 'video' | 'file' = 'image',
): Promise<MetaUploadResult> {
  const token = pageToken(page);
  const url = `${GRAPH_HOST}/${await graphVersion()}/${encodeURIComponent(page.page_id)}/message_attachments`;

  const form = new FormData();
  form.append(
    'message',
    JSON.stringify({ attachment: { type: attachmentType, payload: { is_reusable: true } } }),
  );
  form.append('filedata', new Blob([file.bytes], { type: file.mime }), file.filename);

  let res: Response;
  try {
    res = await fetcher()(url, {
      method: 'POST',
      // ⚠️ ห้ามตั้ง Content-Type เอง — ต้องให้ fetch ใส่ boundary ของ multipart ให้
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(30_000), // ไฟล์ใหญ่กว่าข้อความ ให้เวลามากกว่า
    });
  } catch (err) {
    return {
      ok: false,
      http_status: 0,
      error: classifyMetaError({ message: (err as Error).message }, 0, { networkFailure: true }),
    };
  }

  const body = (await res.json().catch(() => null)) as
    | { attachment_id?: string; error?: RawMetaError }
    | null;

  if (!res.ok || body?.error || !body?.attachment_id) {
    return {
      ok: false,
      http_status: res.status,
      error: classifyMetaError(body?.error ?? { message: 'Meta ไม่ได้คืน attachment_id กลับมา' }, res.status),
    };
  }

  return { ok: true, attachment_id: body.attachment_id, http_status: res.status };
}
