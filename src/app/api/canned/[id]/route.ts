/**
 * /api/canned/[id] — แก้ / ลบ / นับการใช้ชุดคำตอบ
 *
 * PATCH  : เจ้าของเท่านั้น
 * DELETE : เจ้าของเท่านั้น
 * POST   : "หยิบไปใช้" — แอดมินทุกคนที่ตอบแชทได้ (แค่บวกตัวนับ)
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { bumpCannedUse, ContentConflictError, deleteCanned, updateCanned } from '@/server/content/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  shortcut: z.string().trim().max(40).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),
  text: z.string().max(2000).optional().nullable(),
  images: z.array(z.object({
    url: z.string().url('ลิงก์รูปไม่ถูกต้อง'),
    name: z.string().max(160).optional(),
    mime: z.string().max(80).optional(),
  })).min(1, 'ชุดคำตอบต้องมีรูปอย่างน้อย 1 รูป').max(10).optional(),
  sort_order: z.number().int().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission('content.manage');
    const { id } = await ctx.params;
    const item = await updateCanned(id, patchSchema.parse(await req.json()));
    if (!item) return fail('not_found', 'ไม่พบชุดคำตอบนี้', 404);
    return ok({ item });
  } catch (err) {
    if (err instanceof ContentConflictError) return fail('duplicate', err.message, 409);
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await requirePermission('content.manage');
    const { id } = await ctx.params;
    await deleteCanned(id);
    return ok({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** แอดมินหยิบชุดคำตอบไปวางในช่องพิมพ์ — บวกตัวนับไว้จัดลำดับ */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    await requirePermission('chat.reply');
    const { id } = await ctx.params;
    await bumpCannedUse(id);
    return ok({ counted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
