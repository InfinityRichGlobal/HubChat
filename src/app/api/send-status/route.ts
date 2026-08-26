import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { listSendStatuses, statusLabel } from '@/server/messaging/status-service';
import type { SendStatus } from '@/server/messaging/store';

const STATUSES: SendStatus[] = ['claimed', 'blocked_by_policy', 'succeeded', 'permanent_failed', 'retryable_failed', 'outcome_unknown'];

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin();
    const raw = new URL(req.url).searchParams.get('status');
    if (raw && !STATUSES.includes(raw as SendStatus)) return fail('invalid_status', 'สถานะไม่ถูกต้อง', 422);
    const rows = await listSendStatuses(admin, raw as SendStatus | undefined);
    return ok({ sends: rows.map((row) => ({ ...row, ...statusLabel(row.status) })) });
  } catch (err) { return toErrorResponse(err); }
}
