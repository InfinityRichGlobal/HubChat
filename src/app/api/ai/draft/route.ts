import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { generateAiDraft } from '@/server/ai/assist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const draftSchema = z.object({
  mode: z.enum(['reply', 'relationship']),
  conversationId: z.string().min(1, 'ต้องระบุ conversationId'),
  categoryId: z.string().optional(),
  customerMessage: z.string().optional(),
  customerName: z.string().optional(),
  customInstruction: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = draftSchema.parse(await req.json());

    const result = await generateAiDraft({
      mode: body.mode,
      conversationId: body.conversationId,
      categoryId: body.categoryId,
      customerMessage: body.customerMessage,
      customerName: body.customerName,
      customInstruction: body.customInstruction,
    });

    return ok(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
