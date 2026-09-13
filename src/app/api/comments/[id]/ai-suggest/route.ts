import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { getComment } from '@/server/comments/service';
import { generateCommentReply } from '@/server/ai/gemini';
import {
  getCommentBotSettings,
  matchKeyword,
  formatMessage,
  formatCatalogText,
} from '@/server/comments/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  mode: z.enum(['public', 'private']).default('public'),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    const comment = await getComment(admin, id);
    if (!comment.message) {
      return fail('empty_comment', 'คอมเมนต์นี้ไม่มีข้อความให้ AI วิเคราะห์', 400);
    }

    const settings = await getCommentBotSettings();
    const msg = comment.message.trim();
    const name = comment.from_name || 'คุณลูกค้า';

    // 1. ค้นหากฎเฉพาะคำ (rules) ที่ตรงกับคีย์เวิร์ดที่ผู้ใช้เทรนไว้ในบอท
    let matchedRule = null;
    for (const r of settings.rules) {
      if (!r.is_active) continue;
      if (matchKeyword(msg, r.keyword, r.match_type)) {
        matchedRule = r;
        break;
      }
    }

    let suggestion: string | null = null;
    let image_url: string | null = null;

    if (body.mode === 'public') {
      // โหมดตอบใต้โพสต์
      if (matchedRule?.public_reply?.trim()) {
        suggestion = formatMessage(matchedRule.public_reply.trim(), name);
      } else if (settings.reply_mode === 'ai') {
        try {
          const aiText = await generateCommentReply(msg, {
            fromName: name,
            mode: 'public',
            instruction: settings.public_reply_instruction,
          });
          if (aiText?.trim()) suggestion = aiText.trim();
        } catch (err) {
          console.warn('[ai-suggest] AI สร้างคำตอบไม่สำเร็จ ตกไปใช้ Template:', err);
        }
      }

      if (!suggestion && settings.public_reply_template?.trim()) {
        suggestion = formatMessage(settings.public_reply_template.trim(), name);
      }
    } else {
      // โหมดทักแชทส่วนตัว (Private)
      if (matchedRule?.private_reply?.trim()) {
        suggestion = formatMessage(matchedRule.private_reply.trim(), name);
      } else if (settings.reply_mode === 'ai') {
        try {
          const aiText = await generateCommentReply(msg, {
            fromName: name,
            mode: 'private',
            instruction: settings.private_reply_instruction,
          });
          if (aiText?.trim()) suggestion = aiText.trim();
        } catch (err) {
          console.warn('[ai-suggest] AI สร้างคำตอบทักแชทไม่สำเร็จ ตกไปใช้ Template:', err);
        }
      }

      if (!suggestion) {
        const rawTemplate = settings.private_reply_template?.trim() || settings.public_reply_template?.trim();
        if (rawTemplate) {
          suggestion = formatMessage(rawTemplate, name);
        }
      }

      if (settings.auto_send_catalog) {
        const catalog = await formatCatalogText();
        if (catalog) {
          suggestion = suggestion ? `${suggestion}\n\n${catalog}` : catalog;
        }
      }

      if (settings.private_reply_image_url?.trim()) {
        image_url = settings.private_reply_image_url.trim();
      }
    }

    // หากยังไม่มีคำตอบ ให้ใช้ generateCommentReply แบบทั่วไป
    if (!suggestion) {
      suggestion = await generateCommentReply(msg, {
        fromName: name,
        mode: body.mode,
        instruction: body.mode === 'public' ? settings.public_reply_instruction : settings.private_reply_instruction,
      });
    }

    return ok({ suggestion, image_url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
