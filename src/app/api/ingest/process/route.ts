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
import { getRuntimeSetting } from '@/server/settings/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function authorize(req: Request): Promise<'cron' | 'admin'> {
  const expected = process.env.CRON_SECRET || (await getRuntimeSetting('CRON_SECRET'));
  const header = req.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (expected && bearer && secretMatches(bearer, expected)) return 'cron';

  // ไม่ใช่ cron → ต้องมีสิทธิ์ page.manage
  await requirePermission('page.manage');
  return 'admin';
}

async function handle(req: Request) {
  try {
    const by = await authorize(req);
    const summary = await drainWebhookQueue();
    return ok({ by, ...summary });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
