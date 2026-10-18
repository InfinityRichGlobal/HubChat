/**
 * /api/comments/sync — ดึงคอมเมนต์ล่าสุดจาก Facebook / Instagram เข้าสู่ระบบ
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { syncPageComments } from '@/server/comments/sync';
import { canSeePage } from '@/lib/auth/permissions';
import { AuthError } from '@/lib/auth/current-admin';
import { z } from 'zod';

const SyncInput = z.object({ page_id: z.string().uuid().optional() });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const admin = await requirePermission('chat.reply');
    const body = SyncInput.parse(await req.json());
    if (body.page_id && !canSeePage(admin.role, admin.allowed_page_ids, body.page_id)) {
      throw new AuthError('forbidden', 'คุณไม่มีสิทธิ์เข้าถึงเพจนี้', 403);
    }
    const summary = await syncPageComments(body?.page_id, admin.role === 'owner' ? undefined : admin.allowed_page_ids);
    return ok({ summary });
  } catch (err) {
    return toErrorResponse(err);
  }
}
