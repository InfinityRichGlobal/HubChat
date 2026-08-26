import 'server-only';
/**
 * ค่าตั้งแจ้งเตือนรายคน (รอบ 10)
 * ===========================================================================
 * ⚠️ ทุกฟังก์ชันในไฟล์นี้รับ "แอดมินที่ล็อกอินอยู่" เข้ามา
 *    และใช้ id ของคนนั้นเสมอ ไม่มีทางระบุ id ของคนอื่นได้
 */
import { db } from '@/lib/supabase/admin';
import type { PublicAdmin } from '@/types/db';
import { ALL_EVENTS, cleanEvents, EVENT_LABEL_TH, type NotifyEvent } from './events';

export const NOTIFICATION_SELECTS = {
  prefs: 'enabled_events,page_ids,quiet_hours_start,quiet_hours_end,sound_enabled',
  pages: 'id,page_name,display_name,platform',
  jobs: 'id,admin_id,title,body,link,conversation_id',
} as const;

export type PrefsPayload = {
  enabled_events: NotifyEvent[];
  page_ids: string[];
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  sound_enabled: boolean;
};

export type PrefsView = PrefsPayload & {
  /** เพจที่คนนี้มีสิทธิ์ดู — หน้าเว็บเอาไปทำรายการติ๊ก */
  pages: Array<{ id: string; name: string; platform: string }>;
  events: Array<{ key: NotifyEvent; label_th: string }>;
};

/** ตัดเวลาให้เหลือ HH:MM — Postgres คืน time มาเป็น "22:00:00" */
function trimTime(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{2}:\d{2})/.exec(v);
  return m ? m[1] : null;
}

async function visiblePages(admin: PublicAdmin) {
  /**
   * 🔴 ชื่อคอลัมน์คือ page_name / display_name ไม่ใช่ name
   *    เคยเขียนเป็น name แล้วรายการเพจว่างเปล่าแบบ "เงียบ ๆ" — ไม่มี error ให้เห็น
   *    ผลคือทุกคนตั้งค่าเพจไม่ได้เลย โดยไม่มีอะไรบอกว่าทำไม
   *    บทเรียนเดียวกับ D-50 / D-61 / D-69 : อ่านฐานข้อมูลพลาดต้อง "ดัง" ไม่ใช่ "เงียบ"
   */
  let q = db()
    .from('pages')
    .select(NOTIFICATION_SELECTS.pages)
    .eq('is_active', true)
    .order('page_name');

  // เจ้าของเห็นทุกเพจ คนอื่นเห็นเฉพาะที่ได้รับสิทธิ์
  if (admin.role !== 'owner') {
    const allowed = admin.allowed_page_ids ?? [];
    if (allowed.length === 0) return [];
    q = q.in('id', allowed);
  }

  const { data, error } = await q;
  // ⚠️ อ่านไม่ได้ต้องโยนออกไป ไม่ใช่คืนรายการว่างแล้วให้คนใช้เดาเอง
  if (error) throw new Error(`อ่านรายการเพจไม่สำเร็จ: ${error.message}`);

  return (
    (data ?? []) as Array<{
      id: string; page_name: string | null; display_name: string | null; platform: string;
    }>
  ).map((p) => ({
    id: p.id,
    name: p.display_name || p.page_name || '(ยังไม่ตั้งชื่อ)',
    platform: p.platform,
  }));
}

export async function getPrefs(admin: PublicAdmin): Promise<PrefsView> {
  const { data, error } = await db()
    .from('notification_prefs')
    .select(NOTIFICATION_SELECTS.prefs)
    .eq('admin_id', admin.id)
    .maybeSingle();

  if (error) throw new Error(`อ่านค่าตั้งแจ้งเตือนไม่สำเร็จ: ${error.message}`);
  const row = data as {
    enabled_events: string[] | null;
    page_ids: string[] | null;
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
    sound_enabled: boolean | null;
  } | null;

  return {
    // ยังไม่เคยตั้งค่า = เปิดทุกอย่าง (ค่าเริ่มต้นที่ปลอดภัยกว่าคือ "แจ้ง")
    enabled_events: row ? cleanEvents(row.enabled_events) : [...ALL_EVENTS],
    page_ids: row?.page_ids ?? [],
    quiet_hours_start: trimTime(row?.quiet_hours_start) ?? '22:00',
    quiet_hours_end: trimTime(row?.quiet_hours_end) ?? '08:00',
    sound_enabled: row?.sound_enabled ?? true,
    pages: await visiblePages(admin),
    events: ALL_EVENTS.map((k) => ({ key: k, label_th: EVENT_LABEL_TH[k] })),
  };
}

export async function savePrefs(
  admin: PublicAdmin,
  input: {
    enabled_events: string[];
    page_ids: string[];
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
    sound_enabled: boolean;
  },
): Promise<PrefsView> {
  /**
   * 🔴 กรองเพจให้เหลือเฉพาะที่คนนี้มีสิทธิ์จริง ๆ
   *    ถ้าไม่กรอง คนที่ไม่มีสิทธิ์ดูเพจ A สามารถยัด id ของเพจ A มาได้
   *    แล้วจะ "เลือกรับ" เพจนั้นได้ทั้งที่ไม่ควรเห็น
   *    (shouldNotify กันไว้อีกชั้นอยู่แล้ว แต่ข้อมูลขยะไม่ควรลงฐานข้อมูลตั้งแต่แรก)
   */
  const allowed = new Set((await visiblePages(admin)).map((p) => p.id));
  const pageIds = [...new Set(input.page_ids.filter((id) => allowed.has(id)))];

  const events = cleanEvents(input.enabled_events);

  const { error } = await db()
    .from('notification_prefs')
    .upsert(
      {
        admin_id: admin.id,
        enabled_events: events,
        page_ids: pageIds,
        quiet_hours_start: input.quiet_hours_start,
        quiet_hours_end: input.quiet_hours_end,
        sound_enabled: input.sound_enabled,
      },
      { onConflict: 'admin_id' },
    );

  if (error) throw new Error(`บันทึกค่าตั้งแจ้งเตือนไม่สำเร็จ: ${error.message}`);
  return getPrefs(admin);
}
