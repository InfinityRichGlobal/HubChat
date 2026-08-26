import 'server-only';

import { db } from '@/lib/supabase/admin';
import { metaPost } from './client';

/**
 * ย้ายผู้ติดต่อไปสแปมด้วย Moderate Conversations API ของ Meta
 *
 * Endpoint นี้รองรับทั้ง Messenger PSID และ Instagram-scoped ID และเป็น
 * สถานะเดียวในชุดกลุ่มงานปัจจุบันที่ Meta เปิดให้แอปภายนอกเขียนลง
 * Business Suite โดยตรง
 */
export async function moveConversationToMetaSpam(pageId: string, customerId: string) {
  const [{ data: page, error: pageError }, { data: customer, error: customerError }] = await Promise.all([
    db().from('pages').select('id,platform,page_id,access_token').eq('id', pageId).maybeSingle(),
    db().from('customers').select('psid').eq('id', customerId).maybeSingle(),
  ]);
  if (pageError || !page) throw new Error(`อ่านข้อมูลเพจไม่สำเร็จ: ${pageError?.message ?? 'ไม่พบเพจ'}`);
  if (customerError || !customer) throw new Error(`อ่านข้อมูลลูกค้าไม่สำเร็จ: ${customerError?.message ?? 'ไม่พบลูกค้า'}`);

  return metaPost(page, `${page.page_id}/moderate_conversations`, {
    user_ids: [{ id: (customer as { psid: string }).psid }],
    actions: ['move_to_spam'],
  });
}
