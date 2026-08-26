import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { getWorkerHeartbeat, heartbeatIsStale } from '@/server/workers/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    const heartbeat = await getWorkerHeartbeat('notifications');
    return ok({
      last_flush_at: heartbeat?.last_success_at ?? null,
      last_heartbeat_at: heartbeat?.last_heartbeat_at ?? null,
      warning: heartbeatIsStale(heartbeat),
      last_error_at: heartbeat?.last_error_at ?? null,
      missing_without_worker: ['idle_15min', 'window_closing'],
    });
  } catch (err) { return toErrorResponse(err); }
}
