/**
 * สั่งประมวลผลคิว webhook เดี๋ยวนี้ (เจ้าของร้านเท่านั้น)
 * ===========================================================================
 * ปกติคิวถูกประมวลผลอัตโนมัติหลังตอบ webhook อยู่แล้ว
 * ปุ่มนี้มีไว้ 2 กรณี :
 *   • ตอนตั้งค่าครั้งแรก อยากเห็นด้วยตาว่าข้อความไหลเข้ามาจริง
 *   • มีงานค้างในคิวเพราะเซิร์ฟเวอร์เพิ่งรีสตาร์ต
 *
 * ⚠️ ที่อยู่นี้ "ไม่ได้" อยู่ใต้ /api/webhooks โดยตั้งใจ
 *    เพราะเส้นทางนั้นถูกยกเว้นการตรวจ session ไว้ให้ Meta ยิงเข้ามา
 *    ถ้าเอาไปไว้ตรงนั้น ใครก็สั่งให้ระบบทำงานได้
 */
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { drainWebhookQueue } from '@/server/ingest/processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requirePermission('page.manage');
    const summary = await drainWebhookQueue();
    return ok(summary);
  } catch (err) {
    return toErrorResponse(err);
  }
}
