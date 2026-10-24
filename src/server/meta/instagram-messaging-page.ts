import 'server-only';
import { createHash } from 'node:crypto';
import type { MetaPage, MetaGetResult } from './client';
import type { MetaErrorInfo } from './errors';

export type MetaGetter = (
  page: MetaPage,
  pathSegment: string,
  params?: Record<string, string>,
) => Promise<MetaGetResult>;

type CachedResolution = {
  facebook_page_id: string;
  credential_fingerprint: string;
  expires_at: number;
};

const resolutionCache = new Map<string, CachedResolution>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function clearInstagramMessagingPageCache(): void {
  resolutionCache.clear();
}

/** Facebook Login uses a Page token and the linked Facebook Page's Send API.
 * Resolve the Page from that token, then verify its Instagram account before
 * sending. Never guess a Page from a display name or fall back after a POST.
 * Results are cached for 5 minutes, bound to the credential that was verified.
 * https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies
 */
export async function resolveInstagramMessagingPage(
  page: MetaPage,
  getter: MetaGetter,
): Promise<
  | { ok: true; facebook_page_id: string }
  | { ok: false; error_th: string; http_status: number; error: MetaErrorInfo }
> {
  const cacheKey = `${page.id || 'page'}:${page.page_id}`;
  // Token rotation/reconnection must not reuse an identity verified with the
  // previous token. Only retain a fingerprint of the encrypted credential.
  const credentialFingerprint = createHash('sha256').update(page.access_token ?? '').digest('hex');
  const hit = resolutionCache.get(cacheKey);
  if (hit && hit.expires_at > Date.now() && hit.credential_fingerprint === credentialFingerprint) {
    return { ok: true, facebook_page_id: hit.facebook_page_id };
  }
  resolutionCache.delete(cacheKey);

  const result = await getter(page, 'me', { fields: 'id,instagram_business_account' });
  if (!result.ok) {
    // An uncertain GET cannot have delivered a message. Retrying this lookup
    // is safe; an uncertain POST remains ambiguous in the Send API client.
    const kind = result.error.kind === 'ambiguous' ? 'transient' : result.error.kind;
    const errorTh = kind === 'transient'
      ? 'ยังไม่ได้ส่งข้อความ — ตรวจเพจที่เชื่อมกับ Instagram ไม่สำเร็จชั่วคราว สามารถลองใหม่ได้'
      : `ยังไม่ได้ส่งข้อความ — ตรวจเพจที่เชื่อมกับ Instagram ไม่สำเร็จ: ${result.error.message_th}`;
    return {
      ok: false,
      error_th: errorTh,
      http_status: result.http_status,
      error: { ...result.error, kind, message_th: errorTh, window_actually_closed: false },
    };
  }
  const id = result.data.id;
  const account = result.data.instagram_business_account as { id?: unknown } | null | undefined;
  if (typeof id !== 'string' || !id || account?.id !== page.page_id || id === page.page_id) {
    const errorTh = 'ยังไม่ได้ส่งข้อความ — token ต้องเป็นของเพจ Facebook ที่เชื่อมกับบัญชี Instagram นี้ กรุณาตรวจการเชื่อมต่อในหน้าตั้งค่า';
    return {
      ok: false,
      error_th: errorTh,
      http_status: 400,
      error: {
        kind: 'permanent', code: null, subcode: null, message: errorTh,
        message_th: errorTh, fbtrace_id: null, window_actually_closed: false,
      },
    };
  }

  resolutionCache.set(cacheKey, {
    facebook_page_id: id,
    credential_fingerprint: credentialFingerprint,
    expires_at: Date.now() + CACHE_TTL_MS,
  });

  return { ok: true, facebook_page_id: id };
}
