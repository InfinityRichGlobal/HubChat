import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireOwner } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { getAiSettings } from '@/server/ai/gemini';
import { getCommentBotSettings, saveCommentBotSettings } from '@/server/comments/bot';
import { saveRuntimeSetting } from '@/server/settings/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  apiKey: z.string().trim().optional(),
  systemPrompt: z.string().max(20000).optional(),
  knowledge: z.string().max(30000).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  temperature: z.number().min(0).max(1).optional(),
  autoReplyComments: z.boolean().optional(),
  enableCommentSuggest: z.boolean().optional(),
  enableChatAssist: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    const [settings, botSettings] = await Promise.all([
      getAiSettings(),
      getCommentBotSettings().catch(() => null),
    ]);
    const isAutoReplyOn = botSettings ? botSettings.auto_reply_public : settings.autoReplyComments;

    return ok({
      hasApiKey: Boolean(settings.apiKey),
      hintLast4: settings.apiKey ? settings.apiKey.slice(-4) : null,
      systemPrompt: settings.systemPrompt,
      knowledge: settings.knowledge,
      model: settings.model,
      temperature: settings.temperature,
      autoReplyComments: isAutoReplyOn,
      enableCommentSuggest: settings.enableCommentSuggest,
      enableChatAssist: settings.enableChatAssist,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireOwner();
    const body = updateSchema.parse(await req.json());

    if (body.apiKey !== undefined && body.apiKey.trim().length > 0) {
      await saveRuntimeSetting(admin, 'GEMINI_API_KEY', body.apiKey.trim());
    }
    if (body.systemPrompt !== undefined) {
      await saveRuntimeSetting(admin, 'AI_SYSTEM_PROMPT', body.systemPrompt.trim());
    }
    if (body.knowledge !== undefined) {
      await saveRuntimeSetting(admin, 'AI_STORE_KNOWLEDGE', body.knowledge.trim());
    }
    if (body.model !== undefined) {
      await saveRuntimeSetting(admin, 'AI_MODEL', body.model.trim());
    }
    if (body.temperature !== undefined) {
      await saveRuntimeSetting(admin, 'AI_TEMPERATURE', String(body.temperature));
    }
    if (body.autoReplyComments !== undefined) {
      await saveRuntimeSetting(admin, 'AI_AUTO_REPLY_COMMENTS', body.autoReplyComments ? 'on' : 'off');
      try {
        const botSettings = await getCommentBotSettings();
        botSettings.auto_reply_public = body.autoReplyComments;
        if (body.autoReplyComments) {
          botSettings.reply_mode = 'ai';
        }
        await saveCommentBotSettings(admin, botSettings);
      } catch (botErr) {
        console.warn('[ai-settings] ซิงค์กับ comment_bot_settings ไม่สำเร็จ:', botErr);
      }
    }
    if (body.enableCommentSuggest !== undefined) {
      await saveRuntimeSetting(admin, 'AI_ENABLE_COMMENT_SUGGEST', body.enableCommentSuggest ? 'on' : 'off');
    }
    if (body.enableChatAssist !== undefined) {
      await saveRuntimeSetting(admin, 'AI_ENABLE_CHAT_ASSIST', body.enableChatAssist ? 'on' : 'off');
    }

    return ok({ saved: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
