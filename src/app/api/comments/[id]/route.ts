/**
 * /api/comments/[id] — แอดมินจัดการคอมเมนต์ (รอบ 9)
 *
 * 🔴 กฎที่เส้นนี้ต้องรักษา :
 *   • ไม่มีการตอบอัตโนมัติ — ทุกครั้งต้องมีแอดมินตัวจริงกดเอง (ตรวจ session แล้ว)
 *   • "ทักส่วนตัว" ทำได้ครั้งเดียวต่อคอมเมนต์ — ฐานข้อมูลเป็นคนบังคับ
 *   • เบราว์เซอร์กำหนดได้แค่ "ข้อความ" กับ "จะทำอะไร" เท่านั้น
 *     ตัวคอมเมนต์ / เพจ / สิทธิ์ อ่านจากฐานข้อมูลเองทั้งหมด
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { CommentError, setHandled } from '@/server/comments/service';
import { hideComment, replyPrivate, replyPublic, MAX_REPLY_LENGTH } from '@/server/comments/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reply_public'), text: z.string().min(1).max(MAX_REPLY_LENGTH) }),
  z.object({ action: z.literal('reply_private'), text: z.string().min(1).max(MAX_REPLY_LENGTH) }),
  z.object({ action: z.literal('hide'), hidden: z.boolean() }),
  z.object({ action: z.literal('handled'), handled: z.boolean() }),
]);

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    const body = schema.parse(await req.json());

    if (body.action === 'handled') {
      return ok({ comment: await setHandled(admin, id, body.handled), ok: true, message_th: 'บันทึกแล้ว' });
    }

    const outcome =
      body.action === 'reply_public' ? await replyPublic(admin, id, body.text)
      : body.action === 'reply_private' ? await replyPrivate(admin, id, body.text)
      : await hideComment(admin, id, body.hidden);

    const line =
      `[comments] ${body.action} id=${id} ok=${outcome.ok} unknown=${outcome.outcome_unknown}`;
    if (outcome.ok) console.log(`${line} ✅`);
    else console.error(`${line} ❌ ${outcome.message_th}`);

    // ⚠️ ล้มเหลวก็คืน 200 พร้อมเหตุผล — หน้าเว็บต้องได้สถานะล่าสุดของคอมเมนต์กลับไปด้วย
    return ok(outcome);
  } catch (err) {
    if (err instanceof CommentError) return fail('comment_error', err.message_th, 409);
    return toErrorResponse(err);
  }
}
