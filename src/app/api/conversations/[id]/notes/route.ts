/**
 * บันทึกภายในของแอดมิน (ข้อ 1.6)
 * ===========================================================================
 * 🔴 ข้อมูลตรงนี้ **ห้ามหลุดไปถึงลูกค้าเด็ดขาด**
 *    route นี้จึงไม่ import สายส่งข้อความเลยแม้แต่ตัวเดียว
 *    และมี architecture test คุมไว้ว่าห้ามมี
 */
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { InboxAccessError } from '@/server/inbox/service';
import { addNote, deleteNote, loadWorkspace } from '@/server/customers/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  body: z.string().trim().min(1, 'พิมพ์บันทึกก่อนกดเพิ่ม').max(2000, 'บันทึกยาวเกินไป'),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    const input = createSchema.parse(await req.json());

    await addNote(admin, id, input.body);
    // คืนรายการใหม่ทั้งชุด เพื่อให้หน้าเว็บไม่ต้องเดาว่าเรียงยังไง
    return ok({ notes: (await loadWorkspace(admin, id)).notes });
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { note_id?: string };
    if (!body.note_id) return fail('invalid_input', 'ไม่ได้ระบุบันทึกที่จะลบ', 422);

    await deleteNote(admin, id, body.note_id);
    return ok({ notes: (await loadWorkspace(admin, id)).notes });
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
