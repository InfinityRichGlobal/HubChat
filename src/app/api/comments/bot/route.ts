import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { getCommentBotSettings, saveCommentBotSettings } from '@/server/comments/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requirePermission('chat.reply');
    const settings = await getCommentBotSettings();
    return ok(settings);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requirePermission('content.manage');
    const body = await req.json();
    const updated = await saveCommentBotSettings(admin, body);
    return ok(updated);
  } catch (err) {
    return toErrorResponse(err);
  }
}
