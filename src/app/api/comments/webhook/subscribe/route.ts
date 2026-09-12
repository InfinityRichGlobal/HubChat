import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { subscribeAllFacebookPages } from '@/server/comments/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    await requirePermission('content.manage');
    const result = await subscribeAllFacebookPages();
    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
