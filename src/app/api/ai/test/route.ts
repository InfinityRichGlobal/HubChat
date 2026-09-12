import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { testAiPlayground, testGeminiApiKey } from '@/server/ai/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const testKeySchema = z.object({
  action: z.literal('test_key'),
  apiKey: z.string().trim().optional(),
  model: z.string().trim().optional(),
});

const playgroundSchema = z.object({
  action: z.literal('playground'),
  userMessage: z.string().trim().min(1, 'กรุณาพิมพ์ข้อความทดสอบ'),
  systemPrompt: z.string().optional(),
  knowledgeBase: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
});

const schema = z.discriminatedUnion('action', [testKeySchema, playgroundSchema]);

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = schema.parse(await req.json());

    if (body.action === 'test_key') {
      const result = await testGeminiApiKey(body.apiKey, body.model);
      return ok(result);
    }

    if (body.action === 'playground') {
      const reply = await testAiPlayground({
        userMessage: body.userMessage,
        systemPrompt: body.systemPrompt,
        knowledgeBase: body.knowledgeBase,
        model: body.model,
        temperature: body.temperature,
      });
      return ok({ reply });
    }

    return ok({});
  } catch (err) {
    return toErrorResponse(err);
  }
}
