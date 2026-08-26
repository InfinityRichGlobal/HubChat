import 'server-only';
/**
 * ตัวกระจายแจ้งเตือน (รอบ 10 — สเปกหัวข้อ 6.7)
 * ===========================================================================
 * เส้นทาง :  เหตุการณ์ → หาคนที่ควรได้รับ → เข้าคิว (กันซ้ำที่ฐานข้อมูล) → ส่ง
 *
 * 🔴 กฎเหล็ก :
 *   1. เหตุการณ์เดียว คนเดียว ช่องทางเดียว = แจ้งได้ครั้งเดียวตลอดกาล
 *      (unique index บน dedupe_key เป็นคนบังคับ ไม่ใช่โค้ด)
 *   2. Telegram ต้อง "รวบส่ง" ห้ามส่งทีละข้อความ
 *   3. ⚠️ แจ้งเตือนพังต้องไม่ทำให้ข้อความของลูกค้าพัง
 *      ทุกฟังก์ชันในนี้จึงกลืน error เอง ไม่โยนออกไปหาสายรับข้อมูล
 */
import { db } from '@/lib/supabase/admin';
import { serverEnv } from '@/config/env';
import {
  ALL_EVENTS, cleanEvents, dedupeKey, inQuietHours, shouldNotify,
  type NotifyAdmin, type NotifyEvent,
} from './events';
import { sendPushToAdmin, isPushConfigured } from './push';
import { isTelegramConfigured, sendTelegramBatch, type TelegramItem } from './telegram';

/** จำนวนงานที่หยิบมาส่งต่อรอบ — Telegram รวบได้ทีเดียวอยู่แล้ว */
const BATCH_LIMIT = 50;

export type DispatchInput = {
  event: NotifyEvent;
  page_id: string;
  /** สิ่งที่เหตุการณ์นี้อ้างถึง — ใช้เป็นส่วนหนึ่งของกุญแจกันซ้ำ */
  subject_id: string;
  conversation_id?: string | null;
  assigned_admin_id?: string | null;
  title: string;
  body: string;
  link?: string | null;
};

/** เวลาไทยตอนนี้ในรูปแบบ HH:MM */
function nowInBangkok(now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

type AdminWithPrefs = NotifyAdmin & {
  quiet_start: string | null;
  quiet_end: string | null;
};

async function loadAdmins(): Promise<AdminWithPrefs[]> {
  const { data: adminRows } = await db()
    .from('admins')
    .select('id,role,allowed_page_ids,is_active')
    .eq('is_active', true);

  const admins = (adminRows ?? []) as Array<{
    id: string;
    role: 'owner' | 'admin' | 'viewer';
    allowed_page_ids: string[] | null;
    is_active: boolean;
  }>;
  if (admins.length === 0) return [];

  const { data: prefRows } = await db()
    .from('notification_prefs')
    .select('admin_id,enabled_events,page_ids,quiet_hours_start,quiet_hours_end')
    .in('admin_id', admins.map((a) => a.id));

  const prefs = new Map(
    ((prefRows ?? []) as Array<{
      admin_id: string;
      enabled_events: string[] | null;
      page_ids: string[] | null;
      quiet_hours_start: string | null;
      quiet_hours_end: string | null;
    }>).map((p) => [p.admin_id, p]),
  );

  return admins.map((a) => {
    const p = prefs.get(a.id);
    return {
      id: a.id,
      role: a.role,
      allowed_page_ids: a.allowed_page_ids ?? [],
      is_active: a.is_active,
      // ยังไม่เคยตั้งค่า = เปิดทุกเหตุการณ์ (ค่าเริ่มต้นที่ปลอดภัยกว่าคือ "แจ้ง")
      enabled_events: p ? cleanEvents(p.enabled_events) : [...ALL_EVENTS],
      page_ids: p?.page_ids ?? [],
      quiet_start: p?.quiet_hours_start ?? null,
      quiet_end: p?.quiet_hours_end ?? null,
    };
  });
}

/**
 * เข้าคิวแจ้งเตือนหนึ่งเหตุการณ์
 *
 * ⚠️ ฟังก์ชันนี้ต้องไม่โยน error ออกไปเด็ดขาด
 *    ถูกเรียกจากสายรับข้อความของลูกค้า ซึ่งสำคัญกว่าแจ้งเตือนเสมอ
 */
export async function dispatchNotification(input: DispatchInput): Promise<{ queued: number }> {
  try {
    const admins = await loadAdmins();
    const nowHHMM = nowInBangkok();
    const pushOn = isPushConfigured();
    const telegramOn = isTelegramConfigured();

    if (!pushOn && !telegramOn) return { queued: 0 };

    let queued = 0;

    for (const admin of admins) {
      if (!shouldNotify(admin, {
        event: input.event,
        page_id: input.page_id,
        assigned_admin_id: input.assigned_admin_id ?? null,
      })) continue;

      /**
       * ⭐ ช่วงเวลาห้ามรบกวน : ไม่ส่ง push (เด้งบนหน้าจอ)
       *    แต่ยัง "เข้าคิว Telegram" ได้ เพราะกลุ่มไม่เด้งใส่หน้าคน
       *    และเจ้าของร้านมักอยากเห็นย้อนหลังตอนเช้า
       */
      const quiet = inQuietHours(nowHHMM, admin.quiet_start, admin.quiet_end);

      const channels: Array<'push' | 'telegram'> = [];
      if (pushOn && !quiet) channels.push('push');
      if (telegramOn) channels.push('telegram');

      for (const channel of channels) {
        const { data, error } = await db().rpc('queue_notification', {
          p_admin_id: admin.id,
          p_channel: channel,
          p_event: input.event,
          p_dedupe_key: dedupeKey(input.event, input.subject_id, admin.id, channel),
          p_page_id: input.page_id,
          p_conversation_id: input.conversation_id ?? null,
          p_title: input.title,
          p_body: input.body,
          p_link: input.link ?? null,
          p_payload: {},
        });
        if (error) {
          console.error(`[notify] เข้าคิวไม่สำเร็จ: ${error.message}`);
          continue;
        }
        const row = (Array.isArray(data) ? data[0] : data) as { created: boolean } | undefined;
        if (row?.created) queued += 1;
      }
    }

    return { queued };
  } catch (err) {
    // 🔴 ห้ามโยนต่อ — ข้อความของลูกค้าสำคัญกว่าแจ้งเตือนเสมอ
    console.error('[notify] กระจายแจ้งเตือนไม่สำเร็จ (ข้ามไป):', err);
    return { queued: 0 };
  }
}

/* ------------------------------------------------------------------------ */
/* ส่งของที่อยู่ในคิว                                                          */
/* ------------------------------------------------------------------------ */

export type FlushSummary = {
  push_sent: number;
  push_failed: number;
  push_disabled: number;
  telegram_batches: number;
  telegram_items: number;
  telegram_failed: number;
};

type JobRow = {
  id: string;
  admin_id: string;
  title: string;
  body: string;
  link: string | null;
  conversation_id: string | null;
};

function absoluteLink(link: string | null): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  const base = serverEnv().APP_BASE_URL;
  return base ? `${base.replace(/\/$/, '')}${link}` : null;
}

/**
 * ส่งของที่ค้างคิวทั้งหมด
 *
 * ⭐ Telegram : รวบทุกงานเป็นข้อความเดียว (สำคัญมาก ดู telegram.ts)
 * ⭐ Push     : ส่งรายคน เพราะแต่ละคนมีเครื่องของตัวเอง
 */
export async function flushNotifications(): Promise<FlushSummary> {
  const summary: FlushSummary = {
    push_sent: 0, push_failed: 0, push_disabled: 0,
    telegram_batches: 0, telegram_items: 0, telegram_failed: 0,
  };

  /**
   * โหลดรายชื่อแอดมินไว้ล่วงหน้าหนึ่งครั้ง
   * ใช้ตอนนับเลขบนไอคอน (ต้องรู้บทบาทกับสิทธิ์รายเพจของแต่ละคน)
   */
  const adminIndex = new Map((await loadAdmins()).map((a) => [a.id, a]));

  /* ---- Push ---- */
  if (isPushConfigured()) {
    const { data } = await db().rpc('claim_notifications', {
      p_channel: 'push',
      p_limit: BATCH_LIMIT,
    });
    const jobs = (data ?? []) as unknown as JobRow[];

    /**
     * ⭐ นับเลขบนไอคอนแอป "ครั้งเดียวต่อแอดมินหนึ่งคน" ต่อรอบ
     *    ไม่ใช่ต่อแจ้งเตือนหนึ่งอัน — คนเดียวอาจมี 10 งานในรอบเดียว
     *    ถ้านับทุกงานก็จะยิงคำถามเดิมใส่ฐานข้อมูล 10 ครั้งเพื่อได้เลขเดียวกัน
     */
    const badgeCache = new Map<string, number>();
    async function badgeFor(adminId: string): Promise<number> {
      const hit = badgeCache.get(adminId);
      if (hit !== undefined) return hit;
      const admin = adminIndex.get(adminId);
      const n = admin
        ? await unreadBadgeCount(adminId, admin.role, admin.allowed_page_ids)
        : 0;
      badgeCache.set(adminId, n);
      return n;
    }

    for (const job of jobs) {
      try {
        const result = await sendPushToAdmin(job.admin_id, {
          title: job.title,
          body: job.body,
          link: job.link ?? '/inbox',
          badge_count: await badgeFor(job.admin_id),
          tag: job.conversation_id ?? 'hubchat',
        });
        summary.push_sent += result.sent;
        summary.push_failed += result.failed;
        summary.push_disabled += result.disabled;

        if (result.sent === 0 && result.failed > 0) {
          await db().rpc('fail_notification', { p_job_id: job.id, p_error: 'ส่ง push ไม่สำเร็จทุกเครื่อง' });
        }
      } catch (err) {
        await db().rpc('fail_notification', { p_job_id: job.id, p_error: String(err).slice(0, 400) });
        summary.push_failed += 1;
      }
    }
  }

  /* ---- Telegram (รวบส่ง) ---- */
  if (isTelegramConfigured()) {
    const { data } = await db().rpc('claim_notifications', {
      p_channel: 'telegram',
      p_limit: BATCH_LIMIT,
    });
    const jobs = (data ?? []) as unknown as JobRow[];

    if (jobs.length > 0) {
      /**
       * ⚠️ กลุ่ม Telegram เป็นกลุ่มเดียวของร้าน ไม่ได้แยกรายคน
       *    จึงต้องตัดงานที่ซ้ำเรื่องเดียวกันของหลายแอดมินออก
       *    ไม่งั้นเรื่องเดียวจะโผล่ในกลุ่มหลายบรรทัด
       *
       * ⭐ เก็บ "งานทั้งหมดที่บรรทัดนี้เป็นตัวแทน" ไว้ด้วย
       *    เพราะถ้าบรรทัดนี้ส่งไม่สำเร็จ งานที่ถูกยุบรวมไปก็ต้องกลับเข้าคิวหมด
       */
      const byKey = new Map<string, { item: TelegramItem; jobs: JobRow[] }>();
      for (const job of jobs) {
        const key = `${job.title}|${job.body}`;
        const found = byKey.get(key);
        if (found) { found.jobs.push(job); continue; }
        byKey.set(key, {
          item: { title: job.title, body: job.body, link: absoluteLink(job.link) },
          jobs: [job],
        });
      }

      const groups = [...byKey.values()];
      const result = await sendTelegramBatch(groups.map((g) => g.item));
      summary.telegram_batches += 1;

      if (!result.ok) {
        // 🔴 ส่งไม่ได้ = คืนทุกงานกลับเข้าคิว (fail_notification จะยอมแพ้เองเมื่อครบ 3 ครั้ง)
        summary.telegram_failed += jobs.length;
        for (const job of jobs) {
          await db().rpc('fail_notification', { p_job_id: job.id, p_error: result.error_th });
        }
        console.error(`[notify] ส่ง Telegram ไม่สำเร็จ: ${result.error_th}`);
      } else {
        summary.telegram_items += result.used;

        /**
         * 🔴 จุดที่เงียบที่สุดของทั้งรอบ
         *    ข้อความ Telegram มีเพดานความยาว ส่วนที่ล้นไม่ได้ถูกส่งออกไป
         *    แต่ถูกหยิบออกจากคิวไปแล้ว (claim ตีเป็น sent ไว้ก่อน)
         *    ถ้าไม่คืนกลับ เหตุการณ์นั้นจะหายตลอดกาล เพราะกุญแจกันซ้ำบล็อกการเข้าคิวใหม่
         */
        const leftover = groups.slice(result.used).flatMap((g) => g.jobs);
        for (const job of leftover) {
          await db().rpc('requeue_notification', { p_job_id: job.id });
        }
        if (leftover.length > 0) {
          console.warn(`[notify] Telegram ยาวเกินหนึ่งข้อความ — คืน ${leftover.length} รายการเข้าคิวรอบถัดไป`);
        }
      }
    }
  }

  return summary;
}

/* ------------------------------------------------------------------------ */
/* เลขบนไอคอนแอป                                                              */
/* ------------------------------------------------------------------------ */

/**
 * นับแชทที่ยังไม่อ่านของแอดมินคนหนึ่ง — เอาไปขึ้นเลขแดงบนไอคอนแอป
 *
 * ⭐ ต้องนับ "เฉพาะเพจที่คนนี้มีสิทธิ์เห็น" เท่านั้น
 *    ไม่งั้นแอดมินจะเห็นเลข 5 บนไอคอน กดเข้ามาแล้วเจอ 2 แชท แล้วงงว่าหายไปไหน
 *    (และเป็นการบอกใบ้ว่ามีงานในเพจที่เขาไม่ควรรู้ว่ามีอยู่ด้วย)
 *
 * ⚠️ นับไม่ได้ = คืน 0 ไม่ใช่โยน error — เลขบนไอคอนไม่สำคัญพอจะทำให้อย่างอื่นพัง
 */
export async function unreadBadgeCount(
  adminId: string,
  role: 'owner' | 'admin' | 'viewer',
  allowedPageIds: string[],
): Promise<number> {
  try {
    let q = db()
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false);

    if (role !== 'owner') {
      if (allowedPageIds.length === 0) return 0;
      q = q.in('page_id', allowedPageIds);
    }

    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  } catch (err) {
    console.warn(`[notify] นับแชทที่ยังไม่อ่านไม่สำเร็จ (ข้ามไป) admin=${adminId}:`, err);
    return 0;
  }
}
