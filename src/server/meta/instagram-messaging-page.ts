import 'server-only';
import type { MetaPage, MetaGetResult } from './client';

export type MetaGetter = (
  page: MetaPage,
  pathSegment: string,
  params?: Record<string, string>,
) => Promise<MetaGetResult>;

type CachedResolution = {
  facebook_page_id: string;
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
 * Results are cached in memory for 5 minutes to avoid redundant lookups.
 * https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies
 */
export async function resolveInstagramMessagingPage(
  page: MetaPage,
  getter: MetaGetter,
): Promise<{ ok: true; facebook_page_id: string } | { ok: false; error_th: string }> {
  const cacheKey = `${page.id || 'page'}:${page.page_id}`;
  const hit = resolutionCache.get(cacheKey);
  if (hit && hit.expires_at > Date.now()) {
    return { ok: true, facebook_page_id: hit.facebook_page_id };
  }

  const result = await getter(page, 'me', { fields: 'id,instagram_business_account' });
  if (!result.ok) {
    return { ok: false, error_th: `ยังไม่ได้ส่งข้อความ — ตรวจเพจที่เชื่อมกับ Instagram ไม่สำเร็จ: ${result.error.message_th}` };
  }
  const id = result.data.id;
  const account = result.data.instagram_business_account as { id?: unknown } | null | undefined;
  if (typeof id !== 'string' || !id || account?.id !== page.page_id || id === page.page_id) {
    return {
      ok: false,
      error_th: 'ยังไม่ได้ส่งข้อความ — token ต้องเป็นของเพจ Facebook ที่เชื่อมกับบัญชี Instagram นี้ กรุณาตรวจการเชื่อมต่อในหน้าตั้งค่า',
    };
  }

  resolutionCache.set(cacheKey, {
    facebook_page_id: id,
    expires_at: Date.now() + CACHE_TTL_MS,
  });

  return { ok: true, facebook_page_id: id };
}
