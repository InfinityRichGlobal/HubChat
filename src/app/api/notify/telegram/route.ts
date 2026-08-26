/**
 * ทดสอบ / ตั้งค่า Telegram (รอบ 10 — เจ้าของร้านเท่านั้น)
 * ===========================================================================
 * GET  → ค้นหา chat id ของกลุ่มที่บอทถูกเชิญเข้าไป
 * POST → ยิงข้อความทดสอบเข้ากลุ่ม
 *
 * 🔴 TELEGRAM_BOT_TOKEN อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น
 *    ไฟล์นี้ห้ามคืนค่า token กลับไปฝั่งเบราว์เซอร์ไม่ว่ากรณีใด
 *    (ใครได้ token ไป = ส่งข้อความในนามร้านเราได้ทันที)
 *
 * ⚠️ chat id ของกลุ่มเป็นเลข "ติดลบ" เสมอ เช่น -1001234567890
 *    ถ้าเห็นเลขบวก แปลว่าเป็นแชทส่วนตัวกับบอท ไม่ใช่กลุ่ม
 */
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { discoverChatIds, isTelegramConfigured, sendTelegramTest } from '@/server/notify/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const testSchema = z.object({
  /** ใส่ทดสอบก่อนบันทึกลง env ได้ — ไม่ใส่ = ใช้ค่าจาก env */
  chat_id: z.string().max(64).nullable().optional(),
});

export async function GET() {
  try {
    await requirePermission('page.manage');
    const found = await discoverChatIds();
    if (!found.ok) return fail('telegram_failed', found.error_th, 502);
    // แปลงชื่อฟิลด์ให้ตรงกับที่หน้าเว็บใช้ และไม่ส่งอะไรเกินจำเป็นออกไป
    return ok({ chats: found.chats.map((c) => ({ chat_id: c.id, title: c.title })) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    await requirePermission('page.manage');
    const input = testSchema.parse(await req.json().catch(() => ({})));

    if (!isTelegramConfigured(input.chat_id ?? null)) {
      return fail(
        'telegram_not_configured',
        'ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN และ TELEGRAM_CHAT_ID — ดูวิธีที่ docs/NOTIFICATIONS.md',
        503,
      );
    }

    const result = await sendTelegramTest(input.chat_id ?? null);
    if (!result.ok) return fail('telegram_failed', result.error_th, 502);
    return ok({ sent: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
