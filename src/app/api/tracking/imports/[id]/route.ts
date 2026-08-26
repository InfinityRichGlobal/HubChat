/** /api/tracking/imports/[id] — ดูรายละเอียดรอบนำเข้า + ยกเลิก (รอบ 8) */
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { logActivity } from '@/lib/activity-log';
import {
  getImport, listImportRows, cancelImport, TrackingError,
} from '@/server/tracking/service';
import { listImportNotifications } from '@/server/tracking/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id } = await ctx.params;

    const [view, rows, notifications] = await Promise.all([
      getImport(admin, id),
      listImportRows(id),
      listImportNotifications(id),
    ]);

    return ok({ import: view, rows, notifications });
  } catch (err) {
    if (err instanceof TrackingError) return fail('not_found', err.message_th, 404);
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id } = await ctx.params;
    await cancelImport(admin, id);

    await logActivity({
      adminId: admin.id,
      action: 'tracking.import_cancelled',
      targetType: 'tracking_import',
      targetId: id,
    });

    return ok({ cancelled: true });
  } catch (err) {
    if (err instanceof TrackingError) return fail('cannot_cancel', err.message_th, 409);
    return toErrorResponse(err);
  }
}
