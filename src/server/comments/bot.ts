import 'server-only';
/**
 * บอทคอมเมนต์อัตโนมัติ (สเปกแชทบอทตอบอัตโนมัติ)
 * ===========================================================================
 * ฟังก์ชันคุมการทำงานของบอทคอมเมนต์:
 *  1. อ่าน/บันทึกการตั้งค่าบอทคอมเมนต์ (เก็บใน app_settings: comment_bot_settings)
 *  2. กดไลก์อัตโนมัติ (auto_like)
 *  3. ตอบคอมเมนต์สาธารณะใต้โพสต์ (auto_reply_public)
 *  4. ดึงเข้าแชท / ทักส่วนตัว (auto_reply_private)
 *  5. ส่งเมนูสินค้า/โปรโมชั่นหลังดึงเข้าแชท (auto_send_catalog)
 *  6. ระบบคัดกรองคำ (filter_mode: 'all' หรือ 'keyword_only')
 */
import { db } from '@/lib/supabase/admin';
import type { PublicAdmin } from '@/types/db';
import type { MetaPage } from '@/server/meta/client';
import {
  likeComment,
  replyToCommentPublicly,
  sendPrivateReply,
  subscribePageWebhooks,
  COMMENT_CAPABILITIES,
} from '@/server/meta/comments';
import { generateCommentReply } from '@/server/ai/gemini';
import { listProducts, listPromotions } from '@/server/orders/service';
import {
  CommentBotSettingsSchema,
  type CommentBotSettings,
  type CommentBotRule,
  type CommentBotTestResult,
  DEFAULT_COMMENT_BOT_SETTINGS,
} from '@/types/comment-bot';

export type { CommentBotSettings, CommentBotRule, CommentBotTestResult };
export { DEFAULT_COMMENT_BOT_SETTINGS };

const SETTINGS_KEY = 'comment_bot_settings';

/** อ่านการตั้งค่าบอทคอมเมนต์ */
export async function getCommentBotSettings(): Promise<CommentBotSettings> {
  try {
    const { data, error } = await db()
      .from('app_settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle();

    if (error || !data) return { ...DEFAULT_COMMENT_BOT_SETTINGS };
    const parsed = CommentBotSettingsSchema.safeParse(data.value);
    if (!parsed.success) return { ...DEFAULT_COMMENT_BOT_SETTINGS };
    return parsed.data;
  } catch (err) {
    console.error('[comment-bot] อ่านการตั้งค่าไม่สำเร็จ:', err);
    return { ...DEFAULT_COMMENT_BOT_SETTINGS };
  }
}

/** บันทึกการตั้งค่าบอทคอมเมนต์ */
export async function saveCommentBotSettings(
  admin: PublicAdmin,
  raw: unknown,
): Promise<CommentBotSettings> {
  const settings = CommentBotSettingsSchema.parse(raw);
  const { error } = await db()
    .from('app_settings')
    .upsert(
      {
        key: SETTINGS_KEY,
        value: settings,
        updated_by: admin.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    );

  if (error) throw new Error(`บันทึกการตั้งค่าบอทคอมเมนต์ไม่สำเร็จ: ${error.message}`);
  return settings;
}

/** ตรวจสอบข้อความกับกฎและคีย์เวิร์ด */
export function matchKeyword(text: string, kw: string, matchType: 'contains' | 'exact' | 'starts_with' = 'contains'): boolean {
  const normText = text.trim().toLowerCase();
  const normKw = kw.trim().toLowerCase();
  if (!normText || !normKw) return false;

  if (matchType === 'exact') return normText === normKw;
  if (matchType === 'starts_with') return normText.startsWith(normKw);
  return normText.includes(normKw);
}

/** แทนที่ตัวแปรในข้อความ */
export function formatMessage(template: string, name: string | null): string {
  const customerName = name?.trim() || 'คุณลูกค้า';
  return template.replace(/\{name\}/g, customerName).trim();
}

/** จัดรูปแบบเมนูสินค้าและโปรโมชั่นสำหรับส่งในแชทเมื่อดึงเข้าแชท */
export async function formatCatalogText(): Promise<string | null> {
  try {
    const [products, promotions] = await Promise.all([
      listProducts(true),
      listPromotions(true),
    ]);
    if (products.length === 0 && promotions.length === 0) return null;

    const lines: string[] = ['🛍️ เมนูสินค้าและโปรโมชั่นแนะนำ:'];
    if (promotions.length > 0) {
      lines.push('');
      lines.push('🔥 โปรโมชั่นพิเศษ:');
      for (const promo of promotions.slice(0, 5)) {
        lines.push(`• 🎁 ${promo.name}`);
      }
    }
    if (products.length > 0) {
      lines.push('');
      lines.push('📦 รายการสินค้า:');
      for (const p of products.slice(0, 8)) {
        const priceStr = p.price > 0 ? ` — ${p.price.toLocaleString('th-TH')} บาท` : '';
        const variantStr = p.variant ? ` (${p.variant})` : '';
        lines.push(`• ${p.name}${variantStr}${priceStr}`);
      }
    }
    lines.push('');
    lines.push('👉 พิมพ์ชื่อสินค้าหรือจำนวนที่สนใจเพื่อสอบถามหรือสั่งซื้อได้เลยนะคะ');
    return lines.join('\n');
  } catch (err) {
    console.warn('[comment-bot] ดึงข้อมูลสินค้า/โปรโมชั่นไม่สำเร็จ:', err);
    return null;
  }
}

/**
 * ทำงานบอทคอมเมนต์อัตโนมัติเมื่อมีคอมเมนต์ใหม่เข้ามา
 */
export async function processCommentAutoReply(
  page: MetaPage,
  ev: {
    comment_id: string;
    message: string | null;
    from_name: string | null;
    is_from_page: boolean;
  },
  savedCommentRowId: string | null,
): Promise<void> {
  // คอมเมนต์ของเพจเราเอง ไม่ต้องตอบ
  if (ev.is_from_page) return;

  // ป้องกันการตอบซ้ำ: หากคอมเมนต์นี้เคยตอบสาธารณะไปแล้ว ให้ข้ามทันที
  if (savedCommentRowId) {
    const { data: existing } = await db()
      .from('comments')
      .select('replied_public')
      .eq('id', savedCommentRowId)
      .maybeSingle();

    if (existing?.replied_public) {
      console.log(`[comment-bot] คอมเมนต์ ${ev.comment_id} เคยตอบสาธารณะไปแล้ว ข้ามการตอบซ้ำ`);
      return;
    }
  }

  const settings = await getCommentBotSettings();

  // ถ้าไม่ได้เปิดฟีเจอร์ใดเลย ไม่ต้องทำต่อ
  const anyEnabled = settings.auto_like || settings.auto_reply_public || settings.auto_reply_private;
  if (!anyEnabled) return;

  const msg = (ev.message ?? '').trim();

  // ค้นหากฎเฉพาะคำ (rules) ที่ตรง
  let matchedRule: CommentBotRule | null = null;
  for (const r of settings.rules) {
    if (!r.is_active) continue;
    if (matchKeyword(msg, r.keyword, r.match_type)) {
      matchedRule = r;
      break;
    }
  }

  // ตรวจสอบเงื่อนไขตัวกรองคำ (filter_mode)
  let shouldReply = true;
  if (settings.filter_mode === 'keyword_only') {
    if (matchedRule) {
      shouldReply = true;
    } else {
      const hasKeywordMatch = settings.filter_keywords.some((kw) =>
        matchKeyword(msg, kw, 'contains'),
      );
      shouldReply = hasKeywordMatch;
    }
  }

  if (!shouldReply) {
    return;
  }

  const replyMode = settings.reply_mode || 'ai';
  const capabilities = COMMENT_CAPABILITIES[page.platform] ?? {
    like: false,
    unlike: false,
    publicReply: false,
    privateReply: false,
    hide: false,
    delete: false,
  };

  // 1. กดไลก์อัตโนมัติ
  if (settings.auto_like && capabilities.like) {
    try {
      const likeRes = await likeComment(page, ev.comment_id);
      if (likeRes.ok) {
        console.log(`[comment-bot] 👍 กดไลก์คอมเมนต์ ${ev.comment_id} สำเร็จ (${page.platform})`);
        if (savedCommentRowId) {
          await db()
            .from('comments')
            .update({ is_liked: true })
            .eq('id', savedCommentRowId);
        }
      } else {
        console.warn(`[comment-bot] กดไลก์คอมเมนต์ ${ev.comment_id} ไม่สำเร็จ:`, likeRes.error_th);
      }
    } catch (err) {
      console.error(`[comment-bot] เกิดข้อผิดพลาดขณะกดไลก์คอมเมนต์:`, err);
    }
  } else if (settings.auto_like && !capabilities.like) {
    console.info(`[comment-bot] แพลตฟอร์ม ${page.platform} ไม่รองรับการกดไลก์อัตโนมัติ`);
  }

  // 2. ตอบคอมเมนต์สาธารณะใต้โพสต์
  if (settings.auto_reply_public && capabilities.publicReply) {
    let replyText: string | null = null;

    // หากมีกฎเฉพาะคำที่ระบุคำตอบสาธารณะไว้ ให้ใช้กฎนั้นก่อน
    if (matchedRule?.public_reply?.trim()) {
      replyText = formatMessage(matchedRule.public_reply.trim(), ev.from_name);
    } else if (replyMode === 'ai') {
      // โหมด AI: ให้ Gemini นำคลังความรู้ร้านค้าและคำถามลูกค้ามาคิดคำตอบอัจฉริยะ
      try {
        const aiReply = await generateCommentReply(msg || '(ส่งรูปหรือสติกเกอร์)', {
          fromName: ev.from_name,
          mode: 'public',
          instruction: settings.public_reply_instruction,
        });
        if (aiReply?.trim()) {
          replyText = aiReply.trim();
        }
      } catch (aiErr) {
        console.warn('[comment-bot] AI ตอบคอมเมนต์ไม่สำเร็จ ตกไปใช้ Template สำรอง:', aiErr);
      }
    }

    // Fallback: ใช้ Template หาก AI ตอบไม่ได้ หรือผู้ใช้เลือกโหมด Template
    if (!replyText && settings.public_reply_template?.trim()) {
      replyText = formatMessage(settings.public_reply_template.trim(), ev.from_name);
    }

    if (replyText) {
      try {
        const publicRes = await replyToCommentPublicly(page, ev.comment_id, replyText);
        if (publicRes.ok) {
          console.log(`[comment-bot] ↩️ ตอบคอมเมนต์ใต้โพสต์ ${ev.comment_id} สำเร็จ (${replyMode})`);
          if (savedCommentRowId) {
            await db().rpc('finish_public_reply', {
              p_comment_row_id: savedCommentRowId,
              p_admin_id: null,
              p_text: replyText,
            });
          }
        } else {
          console.warn(`[comment-bot] ตอบคอมเมนต์ใต้โพสต์ ${ev.comment_id} ไม่สำเร็จ:`, publicRes.error_th);
          if (savedCommentRowId) {
            await db()
              .from('comments')
              .update({ last_error_th: publicRes.error_th })
              .eq('id', savedCommentRowId);
          }
        }
      } catch (err) {
        console.error(`[comment-bot] เกิดข้อผิดพลาดขณะตอบคอมเมนต์ใต้โพสต์:`, err);
      }
    }
  } else if (settings.auto_reply_public && !capabilities.publicReply) {
    console.info(`[comment-bot] แพลตฟอร์ม ${page.platform} ไม่รองรับการตอบคอมเมนต์สาธารณะ`);
  }

  // 3. ทักแชทส่วนตัว (Private Reply / DM)
  if (settings.auto_reply_private && savedCommentRowId && capabilities.privateReply) {
    let dmText: string | null = null;

    // หากมีกฎเฉพาะคำที่ระบุคำตอบส่วนตัวไว้ ให้ใช้กฎนั้น
    if (matchedRule?.private_reply?.trim()) {
      dmText = formatMessage(matchedRule.private_reply.trim(), ev.from_name);
    } else if (replyMode === 'ai') {
      // โหมด AI: ให้ Gemini เขียนข้อความทักทายต้อนรับเข้าแชทอย่างสุภาพและตรงคำถาม
      try {
        const aiDm = await generateCommentReply(msg || '(ส่งรูปหรือสติกเกอร์)', {
          fromName: ev.from_name,
          mode: 'private',
          instruction: settings.private_reply_instruction,
        });
        if (aiDm?.trim()) {
          dmText = aiDm.trim();
        }
      } catch (aiErr) {
        console.warn('[comment-bot] AI สร้างข้อความทักแชทไม่สำเร็จ ตกไปใช้ Template สำรอง:', aiErr);
      }
    }

    // Fallback: ใช้ Template ทักส่วนตัว
    if (!dmText) {
      const rawPrivateTemplate =
        settings.private_reply_template?.trim() || settings.public_reply_template?.trim();
      if (rawPrivateTemplate) {
        dmText = formatMessage(rawPrivateTemplate, ev.from_name);
      }
    }

    // หากมีรูปภาพจากคลังสื่อสำหรับ Private Reply:
    if (settings.private_reply_image_url?.trim()) {
      const imgUrl = settings.private_reply_image_url.trim();
      dmText = dmText ? `${dmText}\n\n${imgUrl}` : imgUrl;
    }

    // หากเปิด auto_send_catalog (ส่งเมนูสินค้า+โปรฯ หลังดึงเข้าแชท): แนบเมนูและโปรโมชั่นเข้ากับข้อความ
    if (settings.auto_send_catalog) {
      const catalog = await formatCatalogText();
      if (catalog) {
        dmText = dmText ? `${dmText}\n\n${catalog}` : catalog;
      }
    }

    if (dmText) {
      try {
        // จองสิทธิ์ตอบส่วนตัวกับฐานข้อมูล
        const { data: claimData, error: claimErr } = await db().rpc('claim_private_reply', {
          p_comment_row_id: savedCommentRowId,
          p_admin_id: null,
        });

        const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as
          | { won: boolean; reason_th: string | null }
          | undefined;

        if (claimErr || !claim?.won) {
          console.warn(
            `[comment-bot] จองสิทธิ์ทักส่วนตัวไม่สำเร็จ (${claim?.reason_th ?? claimErr?.message})`,
          );
        } else {
          const privateRes = await sendPrivateReply(page, ev.comment_id, dmText);
          if (privateRes.ok) {
            console.log(`[comment-bot] 💌 ทักส่วนตัวจากคอมเมนต์ ${ev.comment_id} สำเร็จ (${page.platform})`);
            await db().rpc('finish_private_reply', {
              p_comment_row_id: savedCommentRowId,
              p_text: dmText,
              p_conversation_id: null,
              p_customer_id: null,
            });
          } else {
            console.warn(
              `[comment-bot] ทักส่วนตัวจากคอมเมนต์ ${ev.comment_id} ไม่สำเร็จ (${page.platform}):`,
              privateRes.error_th,
            );
            if (!privateRes.outcome_unknown) {
              await db().rpc('release_private_reply', {
                p_comment_row_id: savedCommentRowId,
                p_error_th: privateRes.error_th,
              });
            }
          }
        }
      } catch (err) {
        console.error(`[comment-bot] เกิดข้อผิดพลาดขณะทักส่วนตัว:`, err);
      }
    }
  } else if (settings.auto_reply_private && !capabilities.privateReply) {
    console.info(`[comment-bot] แพลตฟอร์ม ${page.platform} ไม่รองรับการทักแชทส่วนตัว`);
  }
}

/**
 * สมัครรับ Webhook สำหรับข้อความและคอมเมนต์ (feed/comments) ให้ทุกเพจ Facebook และ Instagram ที่เปิดใช้งานอยู่
 */
export async function subscribeAllPages(): Promise<{
  results: Array<{ id: string; name: string; ok: boolean; error_th: string | null }>;
  total: number;
  succeeded: number;
  message_th: string;
}> {
  const { data: pages, error } = await db()
    .from('pages')
    .select('id,platform,page_id,page_name,display_name,access_token,is_active')
    .in('platform', ['facebook', 'instagram'])
    .eq('is_active', true);

  if (error) throw new Error(`อ่านรายชื่อเพจไม่สำเร็จ: ${error.message}`);

  const list = (pages ?? []) as Array<{
    id: string;
    platform: 'facebook' | 'instagram';
    page_id: string;
    page_name: string;
    display_name: string | null;
    access_token: string | null;
    is_active: boolean;
  }>;

  const results: Array<{ id: string; name: string; ok: boolean; error_th: string | null }> = [];
  for (const p of list) {
    const res = await subscribePageWebhooks({
      id: p.id,
      platform: p.platform,
      page_id: p.page_id,
      access_token: p.access_token,
    });
    results.push({
      id: p.id,
      name: p.display_name || p.page_name,
      ok: res.ok,
      error_th: res.ok ? null : res.error_th,
    });
  }

  const succeeded = results.filter((r) => r.ok).length;
  return {
    results,
    total: results.length,
    succeeded,
    message_th: `เชื่อมต่อ Webhook สำหรับคอมเมนต์และข้อความให้ ${succeeded} จาก ${results.length} เพจเรียบร้อยแล้ว`,
  };
}

/** สำหรับ backward-compatibility */
export const subscribeAllFacebookPages = subscribeAllPages;

/**
 * ทดสอบการทำงานของบอทคอมเมนต์แบบจำลอง (Dry-run)
 */
export async function testCommentBot(input: {
  comment_text: string;
  commenter_name?: string;
  settings?: CommentBotSettings;
}): Promise<CommentBotTestResult> {
  const settings = input.settings || await getCommentBotSettings();
  const msg = (input.comment_text || '').trim();
  const name = (input.commenter_name || '').trim() || 'คุณลูกค้า';

  // 1. ค้นหากฎเฉพาะคำ (rules) ที่ตรง
  let matchedRule: CommentBotRule | null = null;
  for (const r of settings.rules) {
    if (!r.is_active) continue;
    if (matchKeyword(msg, r.keyword, r.match_type)) {
      matchedRule = r;
      break;
    }
  }

  // 2. ตรวจสอบเงื่อนไขตัวกรองคำ (filter_mode)
  let passes_filter = true;
  let filter_reason = 'ผ่านการกรอง (ตอบทุกคอมเมนต์)';
  if (settings.filter_mode === 'keyword_only') {
    const matchedFilterKw = (settings.filter_keywords || []).find((kw) =>
      matchKeyword(msg, kw, 'contains')
    );
    if (matchedFilterKw) {
      passes_filter = true;
      filter_reason = `ตรวจพบคีย์เวิร์ด "${matchedFilterKw}"`;
    } else {
      passes_filter = false;
      filter_reason = 'ไม่พบคีย์เวิร์ดที่กำหนดในคอมเมนต์';
    }
  }

  // 3. ไลก์
  const would_like = settings.auto_like && passes_filter;

  // 4. ตอบใต้โพสต์
  let would_reply_public = false;
  let public_reply_mode: 'ai' | 'template' | 'rule' | 'none' = 'none';
  let public_reply_text: string | null = null;

  if (matchedRule && matchedRule.public_reply) {
    would_reply_public = true;
    public_reply_mode = 'rule';
    public_reply_text = formatMessage(matchedRule.public_reply, name);
  } else if (settings.auto_reply_public && passes_filter) {
    would_reply_public = true;
    if (settings.reply_mode === 'ai') {
      try {
        const aiText = await generateCommentReply(msg, {
          fromName: name,
          mode: 'public',
          instruction: settings.public_reply_instruction,
        });
        if (aiText) {
          public_reply_mode = 'ai';
          public_reply_text = aiText;
        } else {
          public_reply_mode = 'template';
          public_reply_text = formatMessage(settings.public_reply_template, name);
        }
      } catch {
        public_reply_mode = 'template';
        public_reply_text = formatMessage(settings.public_reply_template, name);
      }
    } else {
      public_reply_mode = 'template';
      public_reply_text = formatMessage(settings.public_reply_template, name);
    }
  }

  // 5. ดึงเข้าแชทส่วนตัว
  let would_reply_private = false;
  let private_reply_mode: 'ai' | 'template' | 'rule' | 'none' = 'none';
  let private_reply_text: string | null = null;

  if (matchedRule && matchedRule.private_reply) {
    would_reply_private = true;
    private_reply_mode = 'rule';
    private_reply_text = formatMessage(matchedRule.private_reply, name);
  } else if (settings.auto_reply_private && passes_filter) {
    would_reply_private = true;
    if (settings.reply_mode === 'ai') {
      try {
        const aiText = await generateCommentReply(msg, {
          fromName: name,
          mode: 'private',
          instruction: settings.private_reply_instruction,
        });
        if (aiText) {
          private_reply_mode = 'ai';
          private_reply_text = aiText;
        } else {
          private_reply_mode = 'template';
          private_reply_text = formatMessage(settings.private_reply_template, name);
        }
      } catch {
        private_reply_mode = 'template';
        private_reply_text = formatMessage(settings.private_reply_template, name);
      }
    } else {
      private_reply_mode = 'template';
      private_reply_text = formatMessage(settings.private_reply_template, name);
    }
  }

  // 6. แคตตาล็อก
  let catalog_attached = false;
  let catalog_preview: string | null = null;
  if (would_reply_private && settings.auto_send_catalog) {
    catalog_preview = await formatCatalogText();
    catalog_attached = Boolean(catalog_preview);
  }

  return {
    matched_rule: matchedRule,
    passes_filter,
    filter_reason,
    would_like,
    would_reply_public,
    public_reply_mode,
    public_reply_text,
    would_reply_private,
    private_reply_mode,
    private_reply_text,
    private_reply_image_url: settings.private_reply_image_url ?? null,
    catalog_attached,
    catalog_preview,
  };
}
