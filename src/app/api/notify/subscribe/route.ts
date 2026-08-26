/**
 * ลงทะเบียน / ยกเลิกเครื่องที่จะรับแจ้งเตือน (รอบ 10)
 * ===========================================================================
 * GET    → คืนกุญแจสาธารณะ VAPID ให้เบราว์เซอร์เอาไปขอสิทธิ์
 * POST   → บันทึกเครื่องนี้
 * DELETE → เอาเครื่องนี้ออก
 *
 * 🔴 กุญแจสาธารณะเปิดเผยได้ (เบราว์เซอร์ต้องใช้อยู่แล้ว)
 *    แต่ VAPID_PRIVATE_KEY ห้ามหลุดออกจากเซิร์ฟเวอร์เด็ดขาด
 *    จึงต้องไม่มีที่ไหนในไฟล์นี้อ่านค่านั้นออกไปตอบ
 *
 * ⚠️ endpoint ที่เบราว์เซอร์ส่งมาคือ "ที่อยู่ของเครื่องผู้ใช้"
 *    ต้องผูกกับแอดมินที่ล็อกอินอยู่เท่านั้น ห้ามให้ระบุ admin_id เองมาจากฝั่งเบราว์เซอร์
 */
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { isPushConfigured, publicVapidKey, saveSubscription, removeSubscription } from '@/server/notify/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(10).max(500),
    auth: z.string().min(5).max(500),
  }),
  device_label: z.string().max(80).optional(),
  platform: z.enum(['ios', 'android', 'desktop']).optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    return ok({ configured: await isPushConfigured(), public_key: await publicVapidKey() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    if (!(await isPushConfigured())) {
      return fail(
        'push_not_configured',
        'ยังไม่ได้ตั้งค่ากุญแจแจ้งเตือน — เจ้าของร้านต้องรัน npm run vapid แล้วใส่ค่าใน .env.local ก่อน',
        503,
      );
    }

    const input = subscribeSchema.parse(await req.json());
    const ua = req.headers.get('user-agent')?.slice(0, 300) ?? null;

    await saveSubscription({
      admin_id: admin.id,          // ⭐ มาจาก session เท่านั้น ไม่รับจากฝั่งเบราว์เซอร์
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      device_label: input.device_label ?? null,
      platform: input.platform ?? null,
      user_agent: ua,
    });

    return ok({ saved: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
    if (!body.endpoint) return fail('invalid_input', 'ไม่ได้ระบุเครื่องที่จะเอาออก', 422);

    await removeSubscription(admin.id, body.endpoint);
    return ok({ removed: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
