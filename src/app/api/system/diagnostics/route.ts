import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { runSystemDiagnostics } from '@/server/diagnostics/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const refresh = searchParams.get('refresh') === 'true';

    const report = await runSystemDiagnostics({ fullPageCheck: refresh });
    return ok(report);
  } catch (err) {
    return toErrorResponse(err);
  }
}
