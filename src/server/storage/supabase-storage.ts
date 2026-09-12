import 'server-only';
import { db } from '@/lib/supabase/admin';
import { createHash } from 'node:crypto';

export class SourceGoneError extends Error {}

export type StoredObject = {
  key: string;
  bytes: number;
  mime: string;
  sha256: string;
};

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
};

export function extensionFor(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? 'bin';
}

export function buildKey(prefix: string, sha256: string, mime: string, at: Date): string {
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, '') || 'misc';
  return `${safePrefix}/${yyyy}/${mm}/${sha256}.${extensionFor(mime)}`;
}

export function sha256Of(bytes: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

export async function putObject(
  key: string,
  bytes: ArrayBuffer,
  mime: string,
): Promise<StoredObject> {
  const { error } = await db().storage.from('media').upload(key, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(`เก็บไฟล์ลง Supabase Storage ไม่สำเร็จ: ${error.message}`);
  return { key, bytes: bytes.byteLength, mime, sha256: sha256Of(bytes) };
}

export async function getObject(
  key: string,
): Promise<{ body: ArrayBuffer; mime: string } | null> {
  const { data, error } = await db().storage.from('media').download(key);
  if (error) {
    return null;
  }
  return {
    body: await data.arrayBuffer(),
    mime: data.type ?? 'application/octet-stream',
  };
}

export function getPublicUrl(key: string): string {
  return db().storage.from('media').getPublicUrl(key).data.publicUrl;
}

export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export async function fetchAndStore(
  sourceUrl: string,
  prefix: string,
  now: Date,
): Promise<StoredObject> {
  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });

  if (res.status === 403 || res.status === 404 || res.status === 410) {
    throw new SourceGoneError(`ลิงก์ต้นทางหมดอายุแล้ว (${res.status})`);
  }
  if (!res.ok) throw new Error(`ดาวน์โหลดไฟล์ต้นทางไม่สำเร็จ (${res.status})`);

  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(`ไฟล์ใหญ่เกินไป (${Math.round(declared / 1024 / 1024)} MB)`);
  }

  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`ไฟล์ใหญ่เกินไป (${Math.round(body.byteLength / 1024 / 1024)} MB)`);
  }

  const mime = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim();
  const sha = sha256Of(body);
  const key = buildKey(prefix, sha, mime, now);

  return putObject(key, body, mime);
}
export function __setStorageFetcherForTests(f: any): void {}
