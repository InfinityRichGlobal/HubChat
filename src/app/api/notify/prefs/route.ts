/**
 * ตั้งค่าแจ้งเตือนของตัวเอง (รอบ 10)
 * ===========================================================================
 * GET → ค่าปัจจุบัน + รายการเพจที่คนนี้มีสิทธิ์
 * PUT → บันทึกค่าใหม่
 *
 * ⚠️ ตั้งค่าได้เฉพาะของตัวเองเท่านั้น ไม่มีทางระบุ admin_id ของคนอื่นได้
 *    (เจ้าของร้านก็ตั้งค่าให้ลูกน้องไม่ได้ — เป็นเรื่องส่วนตัวของแต่ละคน)
 */
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { getPrefs, savePrefs } from '@/server/notify/prefs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "HH:MM" หรือ "HH:MM:SS" — ยอมรับทั้งสองแบบเพราะ Postgres คืน time มาแบบมีวินาที */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'เวลาต้องอยู่ในรูปแบบ ชม:นาที');

const prefsSchema = z.object({
  enabled_events: z.array(z.string()).max(20),
  page_ids: z.array(z.string().uuid()).max(50),
  quiet_hours_start: hhmm.nullable(),
  quiet_hours_end: hhmm.nullable(),
  sound_enabled: z.boolean(),
});

export async function GET() {
  try {
    const admin = await requireAdmin();
    return ok(await getPrefs(admin));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin();
    const input = prefsSchema.parse(await req.json());
    return ok(await savePrefs(admin, input));
  } catch (err) {
    return toErrorResponse(err);
  }
}
