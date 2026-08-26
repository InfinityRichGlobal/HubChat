/**
 * /api/comments — ฟีดคอมเมนต์ (รอบ 9 — สเปกหัวข้อ 5.5)
 * ⚠️ อ่านอย่างเดียว การกระทำทั้งหมดอยู่ที่ /api/comments/[id]
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { listComments, getFilterWords } from '@/server/comments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const admin = await requirePermission('chat.reply');
    const sp = req.nextUrl.searchParams;

    const result = await listComments(admin, {
      unhandled_only: sp.get('unhandled') === '1',
      keyword_only: sp.get('keyword') === '1',
      page_id: sp.get('page_id') ?? undefined,
      before: sp.get('before'),
      limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
    });

    return ok({ ...result, filter_words: await getFilterWords() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
