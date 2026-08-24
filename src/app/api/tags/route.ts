/**
 * /api/tags — แท็ก
 * GET  : แอดมินทุกคนที่ตอบแชทได้ (ใช้ติดแท็กในห้องแชทและกรองในลิสต์)
 * POST : เจ้าของเท่านั้น
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { ContentConflictError, createTag, listTags } from '@/server/content/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    const tags = await listTags();
    return ok({ tags });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อแท็ก').max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'สีต้องเป็นรหัสแบบ #rrggbb').optional(),
  sort_order: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requirePermission('content.manage');
    const tag = await createTag(createSchema.parse(await req.json()));
    return ok({ tag }, { status: 201 });
  } catch (err) {
    if (err instanceof ContentConflictError) return fail('duplicate', err.message, 409);
    return toErrorResponse(err);
  }
}
