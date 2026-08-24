import 'server-only';
/**
 * เก็บสื่อไว้เองอย่างถาวร — ชั้นประสานงาน (D-17)
 * ===========================================================================
 * หน้าที่ : ตัดสินใจว่าไฟล์ไหนต้องเก็บ จองสิทธิ์ ดาวน์โหลด แล้วจดผล
 *          ส่วนการคุยกับ R2 จริง ๆ อยู่ที่ server/storage/r2.ts ที่เดียว
 *
 * 🔴 กฎเหล็กสองข้อของไฟล์นี้ :
 *
 *   1. ⚠️ ห้ามทำให้การรับข้อความของลูกค้าพังเด็ดขาด
 *      ถ้า R2 ล่ม / ยังไม่ได้ตั้งค่า / ลิงก์หมดอายุ → จดไว้แล้วเดินต่อ
 *      ข้อความของลูกค้าสำคัญกว่ารูป เพราะข้อความยังอ่านได้ แต่ถ้าทั้งงานพัง
 *      เราจะเสียทั้งข้อความและรูป
 *
 *   2. ⭐ ต้องจองสิทธิ์กับฐานข้อมูลก่อนโหลดเสมอ
 *      webhook เดิมเข้ามาซ้ำได้ ถ้าไม่กันจะโหลดไฟล์เดิมหลายรอบ
 *      เปลืองโควตาและอาจโดน Meta จำกัดการเรียก
 */
import { db } from '@/lib/supabase/admin';
import {
  fetchAndStore, isStorageConfigured, SourceGoneError, StorageNotConfiguredError,
} from './r2';

export type MediaCaptureInput = {
  message_id: string;
  conversation_id: string;
  page_id: string;
  attachments: Array<{ type: string; url?: string }>;
};

export type CaptureSummary = {
  stored: number;
  skipped: number;
  failed: number;
};

type ClaimRow = { media_id: string | null; won: boolean };

async function claim(
  input: MediaCaptureInput,
  index: number,
  url: string,
  kind: string,
): Promise<ClaimRow> {
  const { data, error } = await db().rpc('claim_media', {
    p_message_id: input.message_id,
    p_attachment_index: index,
    p_conversation_id: input.conversation_id,
    p_page_id: input.page_id,
    p_source_url: url,
    p_kind: kind,
  });
  if (error) throw new Error(`จองสิทธิ์เก็บไฟล์ไม่สำเร็จ: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as ClaimRow | undefined;
  if (!row) throw new Error('ฐานข้อมูลไม่ได้คืนผลการจองสิทธิ์กลับมา');
  return row;
}

async function finish(
  mediaId: string,
  status: 'stored' | 'failed' | 'expired' | 'skipped',
  fields: {
    storage_key?: string | null;
    mime?: string | null;
    bytes?: number | null;
    sha256?: string | null;
    error?: string | null;
  } = {},
): Promise<void> {
  const { error } = await db().rpc('finish_media', {
    p_media_id: mediaId,
    p_status: status,
    p_storage_key: fields.storage_key ?? null,
    p_mime: fields.mime ?? null,
    p_bytes: fields.bytes ?? null,
    p_sha256: fields.sha256 ?? null,
    p_error: fields.error ?? null,
  });
  // จดผลไม่ได้ = ต้องเห็นในล็อก แต่ห้ามโยนต่อจนงานอื่นพัง
  if (error) console.error(`[media] จดผลไม่สำเร็จ (media=${mediaId}): ${error.message}`);
}

/**
 * เก็บไฟล์แนบของข้อความหนึ่งข้อความ
 *
 * ⚠️ ฟังก์ชันนี้ต้องไม่โยน error ออกไปในกรณีปกติ
 *    ผู้เรียกคือสายรับข้อความขาเข้า ซึ่งห้ามพังเพราะเรื่องรูป
 */
export async function captureInboundMedia(input: MediaCaptureInput): Promise<CaptureSummary> {
  const summary: CaptureSummary = { stored: 0, skipped: 0, failed: 0 };

  // เอาเฉพาะไฟล์แนบที่มีลิงก์จริง (sticker/template ไม่มีลิงก์ ก็ไม่ต้องเก็บ)
  const targets = input.attachments
    .map((a, index) => ({ ...a, index }))
    .filter((a) => typeof a.url === 'string' && a.url.length > 0);

  if (targets.length === 0) return summary;

  const configured = isStorageConfigured();
  const now = new Date();

  for (const target of targets) {
    let mediaId: string | null = null;
    try {
      const claimed = await claim(input, target.index, target.url!, 'inbound');
      if (!claimed.won) continue; // มีคนจองไปแล้ว — webhook ซ้ำ
      mediaId = claimed.media_id!;

      // ⭐ ยังไม่ได้ตั้งค่า R2 → จดว่าข้ามโดยตั้งใจ ไม่ใช่ความผิดพลาด
      //    ทำแบบนี้เพื่อให้รู้ย้อนหลังได้ว่า "ช่วงไหนที่เรายังไม่ได้เก็บไฟล์"
      if (!configured) {
        await finish(mediaId, 'skipped', { error: 'ยังไม่ได้ตั้งค่า Cloudflare R2' });
        summary.skipped += 1;
        continue;
      }

      const stored = await fetchAndStore(target.url!, 'inbound', now);
      await finish(mediaId, 'stored', {
        storage_key: stored.key,
        mime: stored.mime,
        bytes: stored.bytes,
        sha256: stored.sha256,
      });
      summary.stored += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.failed += 1;

      /**
       * ⭐ แยกสาเหตุด้วย "ชนิดของข้อผิดพลาด" ไม่ใช่การอ่านเลขจากข้อความ
       *
       * 🔴 เคยเขียนแบบเดาจากข้อความแล้วพลาด : ตอนถัง R2 ตอบ 403 กลับมา
       *    ระบบไปจดว่า "ไฟล์ของลูกค้าหายถาวร" ทั้งที่จริงแค่ตั้งค่าถังผิด
       *    เจ้าของร้านจะเข้าใจผิดว่าสลิปหาย แล้วไปตามหาผิดที่
       */
      const status =
        err instanceof StorageNotConfiguredError ? 'skipped'
        : err instanceof SourceGoneError ? 'expired'
        : 'failed';

      if (mediaId) await finish(mediaId, status, { error: message });

      // ลิงก์หมดอายุ = กู้ไม่ได้แล้ว ต้องเห็นชัดในล็อก ไม่ใช่ warn เบา ๆ
      if (status === 'expired') {
        console.error(
          `[media] 🔴 ลิงก์หมดอายุก่อนเก็บทัน — ไฟล์นี้กู้ไม่ได้แล้ว (message=${input.message_id}): ${message}`,
        );
      } else {
        console.warn(`[media] เก็บไฟล์ไม่สำเร็จ (message=${input.message_id}): ${message}`);
      }
    }
  }

  return summary;
}

/* ------------------------------------------------------------------------ */
/* อ่านข้อมูลไฟล์ (ใช้ตอนเสิร์ฟ)                                                */
/* ------------------------------------------------------------------------ */

export type MediaAsset = {
  id: string;
  storage_key: string | null;
  mime: string | null;
  bytes: number | null;
  status: string;
  conversation_id: string | null;
  page_id: string | null;
  kind: string;
  created_at: string;
};

export async function getMediaAsset(id: string): Promise<MediaAsset | null> {
  const { data } = await db()
    .from('media_assets')
    .select('id,storage_key,mime,bytes,status,conversation_id,page_id,kind,created_at')
    .eq('id', id)
    .maybeSingle();
  return (data as unknown as MediaAsset) ?? null;
}

/**
 * เก็บไฟล์ที่แอดมินอัปโหลดเอง (เช่น สลิปที่ถ่ายรูปมา)
 * คืน media id ไว้ให้ผูกกับออเดอร์
 */
export async function storeUploadedFile(
  bytes: ArrayBuffer,
  mime: string,
  kind: 'slip' | 'outbound',
  context: { conversation_id?: string | null; page_id?: string | null } = {},
): Promise<string> {
  if (!isStorageConfigured()) {
    throw new StorageNotConfiguredError(
      'ยังไม่ได้ตั้งค่าที่เก็บไฟล์ (Cloudflare R2) — ดูขั้นตอนที่ docs/STORAGE.md',
    );
  }

  const { buildKey, putObject, sha256Of } = await import('./r2');
  const sha = sha256Of(bytes);
  const key = buildKey(kind, sha, mime, new Date());
  const stored = await putObject(key, bytes, mime);

  const { data, error } = await db()
    .from('media_assets')
    .insert({
      conversation_id: context.conversation_id ?? null,
      page_id: context.page_id ?? null,
      storage_key: stored.key,
      mime: stored.mime,
      bytes: stored.bytes,
      sha256: stored.sha256,
      kind,
      status: 'stored',
      stored_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`บันทึกทะเบียนไฟล์ไม่สำเร็จ: ${error.message}`);
  return (data as { id: string }).id;
}
