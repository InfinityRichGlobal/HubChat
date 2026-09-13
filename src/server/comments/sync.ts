import 'server-only';
/**
 * ดึงคอมเมนต์ล่าสุดจาก Meta Graph API (Facebook Page + Instagram) เข้าระบบ
 * ===========================================================================
 * ทำไมต้องมีตัวนี้:
 *   1. Meta Webhook ส่งเฉพาะเหตุการณ์ที่เกิดขึ้นหลัง Subscribe และใน Dev Mode
 *      จะส่งเฉพาะเหตุการณ์จากผู้ใช้ที่เป็นบทบาทของแอปเท่านั้น (Admins/Testers)
 *      ลูกค้าทั่วไปหรือเพจอื่นมาคอมเมนต์ Meta จะไม่ส่ง Webhook เข้ามา
 *   2. การดึงผ่าน Graph API ช่วยให้คอมเมนต์ทั้งหมดบนโพสต์ไหลเข้าระบบได้ครบถ้วน
 *   3. ทุกคอมเมนต์ใหม่ที่ดึงเข้ามา จะวิ่งผ่านบอทตอบอัตโนมัติ (CommentBot) และแจ้งเตือนทันที
 */
import { db } from '@/lib/supabase/admin';
import { fetchPageRecentComments } from '@/server/meta/comments';
import type { MetaPage } from '@/server/meta/client';
import { getFilterWords, saveIncomingComment } from './service';
import { processCommentAutoReply } from './bot';
import { syncCommentProfile } from '@/server/meta/profile-sync';
import { dispatchNotification, flushNotifications } from '@/server/notify/dispatch';

export type CommentSyncSummary = {
  pages_checked: number;
  comments_seen: number;
  comments_saved: number;
  errors: Array<{ page_id: string; error_th: string }>;
};

export async function syncPageComments(targetPageId?: string): Promise<CommentSyncSummary> {
  let query = db()
    .from('pages')
    .select('id,platform,page_id,page_name,display_name,access_token,is_active')
    .in('platform', ['facebook', 'instagram'])
    .eq('is_active', true);

  if (targetPageId) {
    query = query.eq('id', targetPageId);
  }

  const { data: pages, error } = await query;
  if (error) {
    throw new Error(`อ่านรายชื่อเพจไม่สำเร็จ: ${error.message}`);
  }

  const filterWords = await getFilterWords();
  const summary: CommentSyncSummary = {
    pages_checked: 0,
    comments_seen: 0,
    comments_saved: 0,
    errors: [],
  };

  for (const p of pages ?? []) {
    summary.pages_checked += 1;
    const metaPage: MetaPage = {
      id: p.id,
      platform: p.platform as 'facebook' | 'instagram',
      page_id: p.page_id,
      access_token: p.access_token,
    };

    const res = await fetchPageRecentComments(metaPage, 5);
    if (!res.ok) {
      summary.errors.push({
        page_id: p.id,
        error_th: res.error_th || 'ดึงคอมเมนต์ไม่สำเร็จ',
      });
      continue;
    }

    summary.comments_seen += res.comments.length;

    for (const c of res.comments) {
      const isFromPage =
        (c.from_id !== null && c.from_id === p.page_id) ||
        (c.from_name !== null && (c.from_name === p.page_name || c.from_name === p.display_name));

      try {
        const saved = await saveIncomingComment(
          {
            page_id: p.id,
            comment_id: c.id,
            post_id: c.post_id,
            parent_comment_id: c.parent_id ?? null,
            from_id: c.from_id,
            from_name: c.from_name,
            from_username: c.from_username,
            message: c.message,
            permalink: c.permalink_url ?? null,
            attachment_url: null,
            is_from_page: isFromPage,
            commented_at: c.created_time,
            raw: { id: c.id, post_id: c.post_id, from: { id: c.from_id, name: c.from_name }, message: c.message },
          },
          filterWords,
        );

        if (!saved.duplicate && saved.id) {
          summary.comments_saved += 1;

          // ดึงรูปโปรไฟล์/ข้อมูลลูกค้าถ้ามี
          if (c.from_id && !isFromPage) {
            void syncCommentProfile(metaPage, saved.id, c.from_id, c.from_username ?? null, c.from_name);
          }

          // รันบอทคอมเมนต์อัตโนมัติ (ไลก์, ตอบใต้โพสต์, ทักแชทส่วนตัว)
          if (!isFromPage) {
            await processCommentAutoReply(
              metaPage,
              {
                comment_id: c.id,
                message: c.message,
                from_name: c.from_name,
                is_from_page: false,
              },
              saved.id,
            );

            // ส่ง Notification เข้าเครื่องแอดมิน
            const title = saved.matched
              ? `💭 คอมเมนต์เข้าคำว่า "${saved.matched}"`
              : `💬 มีคอมเมนต์ใหม่ใต้โพสต์`;

            await dispatchNotification({
              event: 'new_comment',
              page_id: p.id,
              subject_id: saved.id,
              conversation_id: null,
              title,
              body: `${c.from_name || 'ลูกค้า'}: ${(c.message || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '(ไม่มีข้อความ)'}`,
              link: '/comments',
            });
          }
        }
      } catch (saveErr) {
        console.warn(`[comment-sync] บันทึกคอมเมนต์ ${c.id} ไม่สำเร็จ:`, saveErr);
      }
    }
  }

  // ส่งแจ้งเตือนที่ค้างคิวทันทีถ้ามีคอมเมนต์ใหม่ถูกบันทึก
  if (summary.comments_saved > 0) {
    void flushNotifications().catch((err) =>
      console.warn('[comment-sync] flushNotifications ไม่สำเร็จ:', err)
    );
  }

  return summary;
}

let lastSyncTimestamp = 0;

export async function syncPageCommentsThrottled(minIntervalMs = 15_000): Promise<CommentSyncSummary | null> {
  const now = Date.now();
  if (now - lastSyncTimestamp < minIntervalMs) {
    return null;
  }
  lastSyncTimestamp = now;
  return syncPageComments();
}
