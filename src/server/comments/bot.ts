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
import { likeComment, replyToCommentPublicly, sendPrivateReply, subscribePageWebhooks } from '@/server/meta/comments';
import {
  CommentBotSettingsSchema,
  type CommentBotSettings,
  type CommentBotRule,
  DEFAULT_COMMENT_BOT_SETTINGS,
} from '@/types/comment-bot';

export type { CommentBotSettings, CommentBotRule };
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
function matchKeyword(text: string, kw: string, matchType: 'contains' | 'exact' | 'starts_with' = 'contains'): boolean {
  const normText = text.trim().toLowerCase();
  const normKw = kw.trim().toLowerCase();
  if (!normText || !normKw) return false;

  if (matchType === 'exact') return normText === normKw;
  if (matchType === 'starts_with') return normText.startsWith(normKw);
  return normText.includes(normKw);
}

/** แทนที่ตัวแปรในข้อความ */
function formatMessage(template: string, name: string | null): string {
  const customerName = name?.trim() || 'คุณลูกค้า';
  return template.replace(/\{name\}/g, customerName).trim();
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

  // 1. กดไลก์อัตโนมัติ
  if (settings.auto_like) {
    try {
      const likeRes = await likeComment(page, ev.comment_id);
      if (likeRes.ok) {
        console.log(`[comment-bot] 👍 กดไลก์คอมเมนต์ ${ev.comment_id} สำเร็จ`);
      } else {
        console.warn(`[comment-bot] กดไลก์คอมเมนต์ ${ev.comment_id} ไม่สำเร็จ:`, likeRes.error_th);
      }
    } catch (err) {
      console.error(`[comment-bot] เกิดข้อผิดพลาดขณะกดไลก์คอมเมนต์:`, err);
    }
  }

  // 2. ตอบคอมเมนต์สาธารณะใต้โพสต์
  if (settings.auto_reply_public) {
    const rawTemplate =
      matchedRule?.public_reply?.trim() || settings.public_reply_template?.trim();

    if (rawTemplate) {
      const replyText = formatMessage(rawTemplate, ev.from_name);
      try {
        const publicRes = await replyToCommentPublicly(page, ev.comment_id, replyText);
        if (publicRes.ok) {
          console.log(`[comment-bot] ↩️ ตอบคอมเมนต์ใต้โพสต์ ${ev.comment_id} สำเร็จ`);
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
  }

  // 3. ทักแชทส่วนตัว (Private Reply / DM)
  if (settings.auto_reply_private && savedCommentRowId) {
    const rawPrivateTemplate =
      matchedRule?.private_reply?.trim() ||
      settings.private_reply_template?.trim() ||
      settings.public_reply_template?.trim();

    if (rawPrivateTemplate) {
      const dmText = formatMessage(rawPrivateTemplate, ev.from_name);
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
            console.log(`[comment-bot] 💌 ทักส่วนตัวจากคอมเมนต์ ${ev.comment_id} สำเร็จ`);
            await db().rpc('finish_private_reply', {
              p_comment_row_id: savedCommentRowId,
              p_text: dmText,
              p_conversation_id: null,
              p_customer_id: null,
            });
          } else {
            console.warn(
              `[comment-bot] ทักส่วนตัวจากคอมเมนต์ ${ev.comment_id} ไม่สำเร็จ:`,
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
  }
}

/**
 * สมัครรับ Webhook สำหรับคอมเมนต์ (feed) ให้ทุกเพจ Facebook ที่เปิดใช้งานอยู่
 */
export async function subscribeAllFacebookPages(): Promise<{
  results: Array<{ id: string; name: string; ok: boolean; error_th: string | null }>;
  total: number;
  succeeded: number;
  message_th: string;
}> {
  const { data: pages, error } = await db()
    .from('pages')
    .select('id,platform,page_id,page_name,display_name,access_token,is_active')
    .eq('platform', 'facebook')
    .eq('is_active', true);

  if (error) throw new Error(`อ่านรายชื่อเพจไม่สำเร็จ: ${error.message}`);

  const list = (pages ?? []) as Array<{
    id: string;
    platform: 'facebook';
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
    message_th: `เชื่อมต่อ Webhook สำหรับคอมเมนต์ (feed) ให้ ${succeeded} จาก ${results.length} เพจเรียบร้อยแล้ว`,
  };
}
