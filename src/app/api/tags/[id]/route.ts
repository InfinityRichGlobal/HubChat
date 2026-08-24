/** /api/tags/[id] — แก้ / ลบแท็ก (เจ้าของเท่านั้น) */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { ContentConflictError, deleteTag, updateTag } from '@/server/content/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sort_order: z.number().int().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission('content.manage');
    const { id } = await ctx.params;
    const tag = await updateTag(id, patchSchema.parse(await req.json()));
    if (!tag) return fail('not_found', 'ไม่พบแท็กนี้', 404);
    return ok({ tag });
  } catch (err) {
    if (err instanceof ContentConflictError) return fail('duplicate', err.message, 409);
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await requirePermission('content.manage');
    const { id } = await ctx.params;
    await deleteTag(id);
    return ok({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
