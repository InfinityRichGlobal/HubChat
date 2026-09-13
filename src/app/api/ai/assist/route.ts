import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireOwner } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import {
  getAssistCategories,
  saveAssistCategories,
  getRelationCategories,
  saveRelationCategories,
  getGlobalAssistPrompt,
  saveGlobalAssistPrompt,
  type AiCategory,
} from '@/server/ai/assist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const categorySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อหมวดหมู่'),
  icon: z.string().trim().min(1),
  description: z.string().trim(),
  prompt: z.string().trim().min(1, 'กรุณาระบุคำสั่งสอนในหมวดนี้'),
  is_default: z.boolean().optional(),
});

const postSchema = z.object({
  action: z.enum(['save_assist', 'save_relation', 'save_global']),
  assistCategories: z.array(categorySchema).optional(),
  relationCategories: z.array(categorySchema).optional(),
  globalPrompt: z.string().max(10000).optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    const [assistCategories, relationCategories, globalPrompt] = await Promise.all([
      getAssistCategories(),
      getRelationCategories(),
      getGlobalAssistPrompt(),
    ]);

    return ok({
      assistCategories,
      relationCategories,
      globalPrompt,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireOwner();
    const body = postSchema.parse(await req.json());

    if (body.action === 'save_assist' && body.assistCategories) {
      await saveAssistCategories(admin, body.assistCategories);
      return ok({ message: 'บันทึกหมวดหมู่ AI ช่วยคิดสำเร็จ' });
    }

    if (body.action === 'save_relation' && body.relationCategories) {
      await saveRelationCategories(admin, body.relationCategories);
      return ok({ message: 'บันทึกหมวดหมู่ข้อความสัมพันธ์สำเร็จ' });
    }

    if (body.action === 'save_global' && body.globalPrompt !== undefined) {
      await saveGlobalAssistPrompt(admin, body.globalPrompt);
      return ok({ message: 'บันทึกคำสั่งสอนส่วนกลางสำเร็จ' });
    }

    return ok({});
  } catch (err) {
    return toErrorResponse(err);
  }
}
