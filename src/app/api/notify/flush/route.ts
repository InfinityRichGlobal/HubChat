/**
 * ส่งแจ้งเตือนที่ค้างคิว + เดินตรวจแชทค้าง (รอบ 10)
 * ===========================================================================
 * ที่อยู่นี้ถูกเรียกจาก 2 ที่ :
 *   • ตัวตั้งเวลาภายนอก (cron ของ Vercel / เครื่องที่บ้าน) — ใช้หัวข้อ Authorization
 *   • ปุ่มในหน้าตั้งค่าของเจ้าของร้าน — ใช้ session ปกติ
 *
 * 🔴 ถ้าไม่ตั้ง CRON_SECRET ไว้ ที่อยู่นี้จะรับเฉพาะเจ้าของร้านที่ล็อกอินเท่านั้น
 *    ห้าม "เปิดให้ใครก็เรียกได้" เด็ดขาด เพราะจะโดนยิงรัวจนโดน Telegram แบน
 */
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { flushNotifications } from '@/server/notify/dispatch';
import { scanIdleAndClosing } from '@/server/notify/scan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * ⚠️ เทียบความลับแบบ "เวลาเท่ากันเสมอ" ไม่ได้ในที่นี้โดยไม่ดึงไลบรารีเพิ่ม
 *    จึงเทียบความยาวก่อนแล้วค่อยเทียบทีละตัว เพื่อไม่ให้จบเร็วตอนตัวแรกไม่ตรง
 */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function authorize(req: Request): Promise<'cron' | 'admin'> {
  const expected = process.env.CRON_SECRET;
  const header = req.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (expected && bearer && secretMatches(bearer, expected)) return 'cron';

  // ไม่ใช่ cron → ต้องเป็นเจ้าของร้านที่ล็อกอินอยู่
  await requirePermission('page.manage');
  return 'admin';
}

export async function POST(req: Request) {
  try {
    const by = await authorize(req);
    // เดินตรวจก่อน แล้วค่อยส่ง — ของที่เพิ่งเข้าคิวจะได้ออกในรอบเดียวกัน
    const scan = await scanIdleAndClosing();
    const sent = await flushNotifications();
    return ok({ by, scan, sent });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function GET() {
  return fail('method_not_allowed', 'ที่อยู่นี้ต้องเรียกด้วย POST เท่านั้น', 405);
}
