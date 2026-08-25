/**
 * /api/pages/[id]/sync — ดึงแชทเก่าจาก Meta เข้าระบบ (รอบ 7)
 *
 * 🔴 ทำไมต้องมีเส้นนี้ :
 *    webhook ส่งให้เราเฉพาะข้อความที่เกิดหลังกด Subscribe เท่านั้น
 *    แชทเก่าที่มีอยู่ก่อนหน้าไม่มีทางไหลเข้ามาเอง ต้องมาดึงเอง
 *
 * ⚠️ ดึงทีละชุด ไม่ดึงรวดเดียวจนหมด — กันโดน Meta ตัดโควตา
 *    ถ้ายังมีของเก่ากว่านั้น จะคืน has_more + next_cursor มาให้กดต่อ
 *
 * ⚠️ route นี้ "ไม่แตะตาราง pages เอง" และ "ไม่ import @/server/meta"
 *    ทั้งสองข้อมีชุดทดสอบสถาปัตยกรรมคุมอยู่ (กัน access token หลุดออกหน้าเว็บ)
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { syncPageConversations } from '@/server/ingest/backfill';
import { logActivity } from '@/lib/activity-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  /** cursor จากการกดครั้งก่อน — ส่งมาเพื่อดึงต่อจากที่ค้างไว้ */
  after: z.string().max(500).optional().nullable(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('page.manage');
    const { id } = await ctx.params;
    const body = schema.parse(await req.json().catch(() => ({})));

    const outcome = await syncPageConversations(id, body.after);

    if (outcome.kind === 'not_found') return fail('not_found', 'ไม่พบเพจนี้', 404);
    if (outcome.kind === 'not_configured') {
      return fail('not_configured', outcome.message_th, 422);
    }

    const summary = outcome.summary;

    // จดลงประวัติการใช้งาน — การดึงข้อมูลก้อนใหญ่ควรรู้ว่าใครสั่งและเมื่อไหร่
    await logActivity({
      adminId: admin.id,
      action: 'page.sync_conversations',
      targetType: 'page',
      targetId: id,
      detail: {
        conversations: summary.conversations_seen,
        saved: summary.messages_saved,
        duplicates: summary.duplicates,
        has_more: summary.has_more,
      },
    });

    console.log(
      `[backfill] page=${id} ห้อง=${summary.conversations_seen} ` +
        `บันทึกใหม่=${summary.messages_saved} ซ้ำ=${summary.duplicates} ` +
        `ข้าม=${summary.skipped} ยังมีต่อ=${summary.has_more}` +
        (summary.error_th ? ` ❌ ${summary.error_th}` : ' ✅'),
    );

    /**
     * ⚠️ ตั้งใจคืน 200 แม้ summary.error_th จะมีค่า
     *    เพราะการซิงก์ "สำเร็จบางส่วน" เป็นเรื่องปกติ (ชนโควตากลางทาง ฯลฯ)
     *    ถ้าคืน error เปล่า ๆ เจ้าของร้านจะเข้าใจว่าไม่ได้อะไรเลย
     *    ทั้งที่ดึงมาได้ตั้งเยอะแล้ว — หน้าเว็บมีหน้าที่โชว์ทั้งตัวเลขและคำเตือน
     */
    return ok({ summary, page_label: outcome.page_label });
  } catch (err) {
    return toErrorResponse(err);
  }
}
