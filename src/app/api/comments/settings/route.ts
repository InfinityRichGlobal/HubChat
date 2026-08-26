/**
 * /api/comments/settings — คำกรองของฟีดคอมเมนต์ (รอบ 9)
 * ⚠️ คำกรองเป็นแค่ "ตัวชูขึ้นมาให้เห็น" ไม่ใช่ตัวตัดสินใจแทน
 *    คอมเมนต์ที่ไม่เข้าคำกรองยังอยู่ในฟีดครบ และไม่มีการตอบอัตโนมัติไม่ว่ากรณีใด
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { CommentError, getFilterWords, saveFilterWords } from '@/server/comments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ words: z.array(z.string().max(50)).max(50) });

export async function GET() {
  try {
    await requirePermission('chat.reply');
    return ok({ words: await getFilterWords() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    // เปลี่ยนคำกรองมีผลกับทุกคน จึงให้เฉพาะคนที่จัดการเนื้อหาได้
    const admin = await requirePermission('content.manage');
    const body = schema.parse(await req.json());
    return ok({ words: await saveFilterWords(admin, body.words) });
  } catch (err) {
    if (err instanceof CommentError) return fail('save_failed', err.message_th, 422);
    return toErrorResponse(err);
  }
}
