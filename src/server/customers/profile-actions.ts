import 'server-only';
/**
 * งานระดับ "ลูกค้าหนึ่งคน" ที่หน้าเว็บสั่งได้ (แก้ D-33)
 * ===========================================================================
 * ⭐ ทำไมต้องมีชั้นนี้แทนที่จะให้ API route เรียก Meta เอง :
 *
 *    กฎสถาปัตยกรรมของโปรเจกต์คือ **API route ห้าม import ชั้น Meta เลย**
 *    (มี eslint + architecture test คุมอยู่) เพื่อไม่ให้มีใครเผลอเปิดทางลัด
 *    ส่งข้อความข้าม Policy Engine ได้
 *
 *    การดึงโปรไฟล์เป็นการ "อ่านอย่างเดียว" จึงไม่เกี่ยวกับ Policy Engine
 *    แต่ก็ไม่ควรไปเจาะรูในกฎนั้น เพราะรูที่เจาะไว้วันนี้
 *    คือทางลัดที่คนถัดไปจะใช้ส่งข้อความในวันหน้า
 *
 *    → ทางที่ถูกคือให้ route คุยกับชั้นนี้ และให้ชั้นนี้คุยกับ Meta
 *
 * 🔴 ชั้นนี้เป็นคนบังคับสิทธิ์รายเพจด้วย ไม่ใช่ปล่อยให้ route จำเอง
 */
import { db } from '@/lib/supabase/admin';
import { canSeePage } from '@/lib/auth/permissions';
import type { PublicAdmin } from '@/types/db';
import { refreshCustomerProfile } from '@/server/meta/profile-sync';
import type { MetaPage } from '@/server/meta/client';

export type RefreshResult =
  | { ok: true; name: string | null; has_picture: boolean }
  | { ok: false; code: string; message_th: string; status: number };

export async function refreshProfileForConversation(
  admin: PublicAdmin,
  conversationId: string,
): Promise<RefreshResult> {
  const { data, error } = await db()
    .from('conversations')
    .select('id,customer_id,page_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (error) throw new Error(`อ่านข้อมูลห้องแชทไม่สำเร็จ: ${error.message}`);
  const conv = data as { customer_id: string; page_id: string } | null;
  if (!conv) return { ok: false, code: 'not_found', message_th: 'ไม่พบห้องแชทนี้', status: 404 };

  /**
   * 🔴 ด่านสิทธิ์รายเพจ
   *    ถ้าไม่ตรวจ แอดมินที่ไม่มีสิทธิ์เห็นเพจนั้นจะสั่งให้ระบบไปดึงข้อมูล
   *    ลูกค้าของเพจที่ตัวเองไม่ควรรู้ว่ามีอยู่ได้
   */
  if (!canSeePage(admin.role, admin.allowed_page_ids, conv.page_id)) {
    return { ok: false, code: 'forbidden', message_th: 'คุณไม่มีสิทธิ์ดูเพจนี้', status: 403 };
  }

  const [{ data: custRow }, { data: pageRow }] = await Promise.all([
    db().from('customers').select('psid').eq('id', conv.customer_id).maybeSingle(),
    db().from('pages').select('id,platform,page_id,access_token').eq('id', conv.page_id).maybeSingle(),
  ]);

  const customer = custRow as { psid: string } | null;
  const page = pageRow as {
    id: string; platform: 'facebook' | 'instagram'; page_id: string; access_token: string | null;
  } | null;

  if (!customer || !page) {
    return { ok: false, code: 'not_found', message_th: 'ไม่พบข้อมูลลูกค้าหรือเพจ', status: 404 };
  }
  if (!page.access_token) {
    return {
      ok: false,
      code: 'no_token',
      message_th: 'เพจนี้ยังไม่ได้ใส่ token — ไปที่ ตั้งค่า → จัดการเพจ ก่อน',
      status: 400,
    };
  }

  const metaPage: MetaPage = {
    id: page.id,
    platform: page.platform,
    page_id: page.page_id,
    access_token: page.access_token,
  };

  const outcome = await refreshCustomerProfile(metaPage, conv.customer_id, customer.psid);

  if (outcome.kind === 'synced') {
    return { ok: true, name: outcome.name, has_picture: outcome.pic };
  }
  if (outcome.kind === 'failed') {
    // ⚠️ ข้อความนี้มาจาก explainProfileError ซึ่งรับประกันแล้วว่าไม่มี token ปน
    return { ok: false, code: 'profile_failed', message_th: outcome.reason_th, status: 502 };
  }
  return { ok: false, code: 'skipped', message_th: 'ยังไม่ได้ลองดึง ลองใหม่อีกครั้ง', status: 400 };
}
