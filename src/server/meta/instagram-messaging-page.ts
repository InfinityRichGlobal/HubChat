import 'server-only';
import { metaGet, type MetaPage } from './client';

/** Facebook Login uses a Page token and the linked Facebook Page's Send API.
 * Resolve the Page from that token, then verify its Instagram account before
 * sending. Never guess a Page from a display name or fall back after a POST.
 * https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies
 */
export async function resolveInstagramMessagingPage(page: MetaPage): Promise<
  { ok: true; facebook_page_id: string } | { ok: false; error_th: string }
> {
  const result = await metaGet(page, 'me', { fields: 'id,instagram_business_account' });
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
  return { ok: true, facebook_page_id: id };
}
