import 'server-only';
/**
 * Meta Data Deletion Callback
 * ===========================================================================
 * ⚠️ จำเป็นสำหรับ Meta App Review
 *    Meta กำหนดให้แอพทุกตัวต้องมี Data Deletion Callback หรือ Instructions URL
 *    เมื่อผู้ใช้ลบแอพออกจาก Facebook/Instagram → Meta จะยิง POST มาที่นี่
 *    แอพต้องลบข้อมูลของผู้ใช้นั้นออก แล้วตอบกลับด้วย confirmation_code
 *
 * Flow:
 *   1. ผู้ใช้ไปที่ Facebook → Settings → Apps and Websites → ลบแอพ
 *   2. Meta ส่ง POST มาพร้อม signed_request ใน body
 *   3. API ถอดรหัส signed_request → ได้ user_id
 *   4. ลบข้อมูลที่เกี่ยวข้องกับ user_id ออกจาก DB
 *   5. ตอบ JSON { url, confirmation_code }
 */
import crypto from 'node:crypto';
import { db } from '@/lib/supabase/admin';
import { getRuntimeSetting } from '@/server/settings/service';

export type ParsedSignedRequest = {
  user_id: string;
  algorithm: string;
  issued_at: number;
};

/**
 * ถอดรหัส signed_request ของ Meta
 * https://developers.facebook.com/docs/facebook-login/guides/parse-signed-request
 */
function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): ParsedSignedRequest | null {
  const [encodedSig, payload] = signedRequest.split('.', 2);
  if (!encodedSig || !payload) return null;

  // Base64url → Buffer
  const sig = Buffer.from(encodedSig, 'base64url');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ParsedSignedRequest & { algorithm?: string };

  // ตรวจว่า algorithm เป็น HMAC-SHA256
  if (data.algorithm?.toUpperCase() !== 'HMAC-SHA256') return null;

  // ตรวจลายเซ็น
  const expectedSig = crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest();

  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(sig, expectedSig)) return null;

  return data;
}

/**
 * ลบข้อมูลของผู้ใช้จากฐานข้อมูล
 */
async function deleteUserData(userId: string): Promise<number> {
  let deletedCount = 0;

  // ลบคอมเมนต์ที่ from_id ตรงกับ user_id
  const { count: commentsDeleted } = await db()
    .from('comments')
    .delete({ count: 'exact' })
    .eq('from_id', userId);
  deletedCount += commentsDeleted ?? 0;

  // ลบ customers ที่ meta_id ตรงกับ user_id
  const { data: customers } = await db()
    .from('customers')
    .select('id')
    .eq('meta_id', userId);

  if (customers && customers.length > 0) {
    const customerIds = customers.map((c: { id: string }) => c.id);

    // ลบ conversations ที่เชื่อมกับ customer
    const { count: convsDeleted } = await db()
      .from('conversations')
      .delete({ count: 'exact' })
      .in('customer_id', customerIds);
    deletedCount += convsDeleted ?? 0;

    // ลบ customers
    const { count: custDeleted } = await db()
      .from('customers')
      .delete({ count: 'exact' })
      .eq('meta_id', userId);
    deletedCount += custDeleted ?? 0;
  }

  return deletedCount;
}

export { parseSignedRequest, deleteUserData };
