/**
 * POST /api/customers/sync-profiles — ดึงชื่อและโปรไฟล์ลูกค้าจริงจาก Meta
 * -------------------------------------------------------------------------
 * ดึงชื่อจริงจาก Meta Graph API มาเติมให้ลูกค้าทุกคนที่ยังเป็น 'ลูกค้า xxxxxx'
 */
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { syncAllCustomerProfiles } from '@/server/customers/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requirePermission('chat.reply');

    const totalUpdated = await syncAllCustomerProfiles();

    return ok({ updated: totalUpdated, message_th: `ซิงก์ชื่อลูกค้าสำเร็จ ${totalUpdated} รายการ` });
  } catch (err) {
    return toErrorResponse(err);
  }
}
