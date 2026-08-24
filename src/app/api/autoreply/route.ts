/**
 * /api/autoreply — กฎตอบอัตโนมัติ (สเปกหัวข้อ 5.5)
 *
 * 🔴 กฎพวกนี้ทำให้ระบบส่งข้อความหาลูกค้าเองโดยไม่มีคนกด
 *    จึงจำกัดสิทธิ์แก้ไว้ที่ 'content.manage' และตรวจความถูกต้องฝั่งเซิร์ฟเวอร์เสมอ
 *    ห้ามเชื่อการตรวจฝั่งหน้าเว็บ เพราะใครก็ยิง API ตรงได้
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { listRules, saveRule, RuleError } from '@/server/autoreply/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requirePermission('content.view');
    const rules = await listRules(req.nextUrl.searchParams.get('archived') === '1');
    return ok({ rules });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const schema = z.object({
  name: z.string().trim().max(120).optional().nullable(),
  page_ids: z.array(z.string().uuid()).max(50).optional(),
  match_type: z.enum(['exact', 'contains', 'starts_with']).optional(),
  keywords: z.array(z.string().trim().max(100)).max(50),
  reply_text: z.string().trim().min(1, 'ต้องมีข้อความตอบกลับ').max(1800),
  priority: z.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const admin = await requirePermission('content.manage');
    const body = schema.parse(await req.json());
    const rule = await saveRule(admin, null, body);
    return ok({ rule }, { status: 201 });
  } catch (err) {
    if (err instanceof RuleError) return fail('invalid_rule', err.message, 422);
    return toErrorResponse(err);
  }
}
