/**
 * /api/canned — ชุดคำตอบ (สเปกหัวข้อ 5.1 / 5.6)
 * GET  : แอดมินทุกคนที่มีสิทธิ์ดูเนื้อหา (ใช้ตอนพิมพ์ `/` ในห้องแชท)
 * POST : เจ้าของเท่านั้น (ตารางสิทธิ์ 5.7 — แอดมินทั่วไปดูได้แต่แก้ไม่ได้)
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { ContentConflictError, createCanned, listCanned } from '@/server/content/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requirePermission('content.view');
    const items = await listCanned(req.nextUrl.searchParams.get('q') ?? undefined);
    return ok({ items });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const createSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกชื่อชุดคำตอบ').max(120),
  shortcut: z.string().trim().max(40).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),
  text: z.string().max(2000).optional().nullable(),
  sort_order: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requirePermission('content.manage');
    const body = createSchema.parse(await req.json());
    const item = await createCanned(body);
    return ok({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof ContentConflictError) return fail('duplicate', err.message, 409);
    return toErrorResponse(err);
  }
}
