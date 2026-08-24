/**
 * /api/autoreply/[id] — แก้ / เปิด-ปิด / เก็บเข้ากรุ
 *
 * ⚠️ ไม่มี DELETE โดยตั้งใจ — ใช้ archive แทน
 *    เพราะประวัติการตอบอัตโนมัติอ้างถึงกฎนี้อยู่
 *    ลบทิ้งแล้วจะตอบไม่ได้ว่า "ทำไมระบบตอบลูกค้าแบบนั้น"
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { archiveRule, getRule, saveRule, setRuleActive, RuleError } from '@/server/autoreply/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission('content.view');
    const { id } = await ctx.params;
    const rule = await getRule(id);
    if (!rule) return fail('not_found', 'ไม่พบกฎนี้', 404);
    return ok({ rule });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const patchSchema = z.object({
  name: z.string().trim().max(120).optional().nullable(),
  page_ids: z.array(z.string().uuid()).max(50).optional(),
  match_type: z.enum(['exact', 'contains', 'starts_with']).optional(),
  keywords: z.array(z.string().trim().max(100)).max(50).optional(),
  reply_text: z.string().trim().max(1800).optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().optional(),
  /** true = เก็บเข้ากรุ (ทางเดียวที่ใช้แทนการลบ) */
  archive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('content.manage');
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());

    if (body.archive) {
      await archiveRule(admin, id);
      return ok({ archived: true });
    }

    const current = await getRule(id);
    if (!current) return fail('not_found', 'ไม่พบกฎนี้', 404);

    // เปลี่ยนแค่สวิตช์เปิด-ปิด (ไม่ต้องส่งทั้งฟอร์มมา)
    const onlyActive =
      body.is_active !== undefined &&
      body.keywords === undefined &&
      body.reply_text === undefined &&
      body.match_type === undefined &&
      body.priority === undefined &&
      body.page_ids === undefined &&
      body.name === undefined;

    if (onlyActive) {
      const rule = await setRuleActive(admin, id, body.is_active!);
      return ok({ rule });
    }

    const rule = await saveRule(admin, id, {
      name: body.name !== undefined ? body.name : current.name,
      page_ids: body.page_ids ?? current.page_ids,
      match_type: body.match_type ?? current.match_type,
      keywords: body.keywords ?? current.keywords,
      reply_text: body.reply_text !== undefined ? body.reply_text : current.reply_text,
      priority: body.priority ?? current.priority,
      is_active: body.is_active ?? current.is_active,
    });
    return ok({ rule });
  } catch (err) {
    if (err instanceof RuleError) return fail('invalid_rule', err.message, 422);
    return toErrorResponse(err);
  }
}
