/**
 * /api/pages/[id]/test — ทดสอบว่า token ของเพจใช้งานได้จริงไหม (เจ้าของเท่านั้น)
 *
 * ทำไมต้องมี : ตอนตั้งค่าครั้งแรกคนมักคัดลอก token มาผิด หรือผิดเพจ
 *              ปุ่มนี้ทำให้รู้ทันทีตรงนั้น ไม่ต้องรอลูกค้าทักมาแล้วตอบไม่ได้
 */
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { testPageConnection } from '@/server/pages/service';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    await requirePermission('page.manage');
    const { id } = await ctx.params;
    const result = await testPageConnection(id);
    // ตอบ 200 เสมอ เพราะ "ทดสอบแล้วไม่ผ่าน" เป็นผลลัพธ์ปกติ ไม่ใช่ข้อผิดพลาดของระบบ
    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
