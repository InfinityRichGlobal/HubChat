/**
 * /api/dashboard — ตัวเลขสรุปยอด (รอบ 9 — สเปกหัวข้อ 5.4)
 *
 * 🔴 ขอบเขตสิทธิ์ตัดสินที่ชั้นบริการ ไม่ใช่ที่นี่
 *    แอดมินทั่วไปเห็นเฉพาะออเดอร์ที่ตัวเองสร้าง ไม่ว่าจะส่งพารามิเตอร์อะไรมา
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { can } from '@/lib/auth/permissions';
import { loadDashboard, type RangeKey } from '@/server/dashboard/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  range: z.enum(['today', '7d', '30d', 'custom']).default('7d'),
  from: z.string().max(40).optional().nullable(),
  to: z.string().max(40).optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin();

    if (!can(admin.role, 'dashboard.view.all') && !can(admin.role, 'dashboard.view.self')) {
      return fail('forbidden', 'บัญชีของคุณไม่มีสิทธิ์ดูสรุปยอด', 403);
    }

    const sp = req.nextUrl.searchParams;
    const input = schema.parse({
      range: sp.get('range') ?? undefined,
      from: sp.get('from'),
      to: sp.get('to'),
    });

    const data = await loadDashboard(admin, input.range as RangeKey, {
      from: input.from,
      to: input.to,
    });

    return ok(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}
