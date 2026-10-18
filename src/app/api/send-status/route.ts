import { PAGE_SIZE, pageNumber } from '@/lib/pagination';
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { listSendStatuses, statusLabel } from '@/server/messaging/status-service';
import type { SendStatus } from '@/server/messaging/store';

const STATUSES: SendStatus[] = ['claimed', 'blocked_by_policy', 'succeeded', 'permanent_failed', 'retryable_failed', 'outcome_unknown'];

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin();
    const params = new URL(req.url).searchParams;
    const raw = params.get('status');
    const page = pageNumber(params.get('p'));
    if (raw && !STATUSES.includes(raw as SendStatus)) return fail('invalid_status', 'สถานะไม่ถูกต้อง', 422);
    const rows = await listSendStatuses(admin, raw as SendStatus | undefined, { offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE + 1, q: params.get('q') ?? '' });
    return ok({ page, has_more: rows.length > PAGE_SIZE, sends: rows.slice(0, PAGE_SIZE).map((row) => ({ ...row, ...statusLabel(row.status) })) });
  } catch (err) { return toErrorResponse(err); }
}
