/**
 * /api/comments/sync — ดึงคอมเมนต์ล่าสุดจาก Facebook / Instagram เข้าสู่ระบบ
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { syncPageComments } from '@/server/comments/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    await requirePermission('chat.reply');
    const body = (await req.json().catch(() => ({}))) as { page_id?: string };
    const summary = await syncPageComments(body?.page_id);
    return ok({ summary });
  } catch (err) {
    return toErrorResponse(err);
  }
}
