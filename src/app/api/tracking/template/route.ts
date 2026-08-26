/** /api/tracking/template — ไฟล์ CSV ตัวอย่างให้เจ้าของร้านโหลดไปกรอก (รอบ 8) */
import { requirePermission } from '@/lib/auth/current-admin';
import { toErrorResponse } from '@/lib/api';
import { csvTemplate } from '@/server/tracking/columns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requirePermission('order.create');
    return new Response(csvTemplate(), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="hubchat-tracking-template.csv"',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
