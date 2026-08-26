import 'server-only';
/**
 * ตัวเดินตรวจ "เหตุการณ์ที่ไม่มีใครยิงมาบอก" (รอบ 10 — สเปกหัวข้อ 6.7)
 * ===========================================================================
 * แจ้งเตือน 3 ใน 5 อย่างเกิดจาก webhook (ลูกค้าทัก / ลูกค้าตอบ / คอมเมนต์)
 * แต่อีก 2 อย่างไม่มีใครยิงมาบอก เพราะมันคือ "การที่ไม่มีอะไรเกิดขึ้น" :
 *
 *   • idle_15min     — ลูกค้าทักแล้วเงียบ 15 นาที ยังไม่มีใครตอบ
 *   • window_closing — ใกล้หมดกรอบ 24 ชม. ที่ Meta ให้ตอบฟรี
 *
 * ทั้งสองอย่างต้องมีคน "เดินมาดู" เป็นระยะ จึงต้องมีไฟล์นี้
 *
 * 🔴 สองข้อที่พลาดไม่ได้ :
 *   1. ห้ามแจ้งซ้ำเรื่องเดิม — ตัวเดินตรวจถูกเรียกทุก 5 นาที ถ้ากุญแจกันซ้ำผิด
 *      แอดมินจะโดนเตือนเรื่องเดียวกัน 12 ครั้งต่อชั่วโมง แล้วปิดแจ้งเตือนทิ้ง
 *   2. "ยังไม่มีใครตอบ" ต้องดูจากข้อความจริงในฐานข้อมูล
 *      ห้ามใช้ is_read เพราะการ "เปิดอ่าน" ไม่เท่ากับการ "ตอบ"
 *      แอดมินเปิดดูแล้ววางมือถือลง ลูกค้าก็ยังรออยู่ดี
 */
import { db } from '@/lib/supabase/admin';
import { loadPolicyConfig } from '@/server/policy/config';
import { dispatchNotification } from './dispatch';

/** เงียบเกินกี่นาทีถึงเตือน — ตามสเปก */
export const IDLE_MINUTES = 15;
/** เหลือกรอบ 24 ชม. น้อยกว่ากี่ชั่วโมงถึงเตือน */
export const WINDOW_WARN_HOURS = 2;
/** ตรวจสูงสุดกี่ห้องต่อรอบ — กันรอบเดียวกินเวลาจนหมด timeout */
const MAX_ROWS = 200;

export type ScanSummary = {
  idle_queued: number;
  window_queued: number;
  scanned: number;
};

type ConvRow = {
  id: string;
  page_id: string;
  assigned_admin_id: string | null;
  last_customer_message_at: string | null;
  customer_id: string;
};

/**
 * ห้องไหน "ยังไม่มีใครตอบ" หลังข้อความล่าสุดของลูกค้า
 *
 * ⭐ ยิงคำถามเดียวสำหรับทุกห้อง แล้วมาแยกในหน่วยความจำ
 *    ไม่ใช่วนถามทีละห้อง — 200 ห้อง = 200 รอบไป-กลับฐานข้อมูล ช้าจนหมดเวลา
 */
async function unansweredIds(rows: ConvRow[]): Promise<Set<string>> {
  if (rows.length === 0) return new Set();

  // เวลาที่เก่าที่สุดในชุดนี้ — ข้อความที่เก่ากว่านั้นไม่ต้องดึงมาเลย
  const oldest = rows
    .map((r) => r.last_customer_message_at)
    .filter((v): v is string => Boolean(v))
    .sort()[0];

  /**
   * 🔴 sender_type ต้องเป็น 'admin' เท่านั้น ห้ามใช้แค่ direction = 'out'
   *
   *    เพราะข้อความขาออกมีสองแบบ : คนพิมพ์ กับ บอทตอบคีย์เวิร์ด
   *    ถ้านับบอทว่า "ตอบแล้ว" ห้องที่บอททักไป "สวัสดีค่ะ" แล้วไม่มีคนมาต่อ
   *    จะไม่มีใครได้รับแจ้งเตือนเลย — ซึ่งเป็นห้องที่ต้องเตือนที่สุดด้วยซ้ำ
   *    เพราะลูกค้าเข้าใจว่ามีคนคุยอยู่ แล้วรอยาวกว่าเดิม
   */
  const { data, error } = await db()
    .from('messages')
    .select('conversation_id,created_at')
    .in('conversation_id', rows.map((r) => r.id))
    .eq('direction', 'out')
    .eq('sender_type', 'admin')
    .eq('is_deleted', false)
    .gte('created_at', oldest);

  // ⚠️ อ่านไม่ได้ต้องดัง — ไม่ใช่คืนเซ็ตว่างแล้วไปเตือนซ้ำห้องที่ตอบไปแล้ว
  if (error) throw new Error(`อ่านข้อความเพื่อตรวจว่าตอบไปหรือยังไม่สำเร็จ: ${error.message}`);

  const repliedAfter = new Map<string, string>();
  for (const m of (data ?? []) as Array<{ conversation_id: string; created_at: string }>) {
    const prev = repliedAfter.get(m.conversation_id);
    if (!prev || m.created_at > prev) repliedAfter.set(m.conversation_id, m.created_at);
  }

  const out = new Set<string>();
  for (const r of rows) {
    if (!r.last_customer_message_at) continue;
    const replied = repliedAfter.get(r.id);
    // ตอบหลังข้อความล่าสุดของลูกค้าแล้ว = จบ ไม่ต้องเตือน
    if (replied && replied >= r.last_customer_message_at) continue;
    out.add(r.id);
  }
  return out;
}

function preview(text: string | null | undefined, max = 80): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '(ไม่มีข้อความ — อาจเป็นรูปหรือสติกเกอร์)';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * เดินตรวจหนึ่งรอบ
 *
 * ⚠️ ห้ามโยน error ออกไป — ตัวนี้ถูกเรียกจาก cron/worker ที่ทำงานอย่างอื่นต่อ
 */
export async function scanIdleAndClosing(now = new Date()): Promise<ScanSummary> {
  const summary: ScanSummary = { idle_queued: 0, window_queued: 0, scanned: 0 };

  try {
    const cfg = loadPolicyConfig();
    /**
     * ⭐ กรอบเวลาอ่านจาก Policy Engine ที่เดียว ห้ามเขียน 24 ตายลงไปตรงนี้
     *    (กฎเหล็กของโปรเจกต์ : ห้ามมีกฎของ Meta กระจายอยู่นอก Policy Engine)
     *    ถ้าเพจ Messenger กับ IG ตั้งไม่เท่ากัน ให้ยึดค่าที่ "สั้นกว่า" ไว้ก่อน
     *    เตือนเร็วไปยังพอทน เตือนช้าไปคือส่งไม่ได้แล้ว
     */
    const windows = [
      cfg.channels.messenger.STANDARD?.window_hours,
      cfg.channels.instagram.STANDARD?.window_hours,
    ].filter((v): v is number => typeof v === 'number' && v > 0);
    const windowHours = windows.length > 0 ? Math.min(...windows) : 24;

    const nowMs = now.getTime();
    const idleBefore = new Date(nowMs - IDLE_MINUTES * 60_000).toISOString();
    const windowStart = new Date(nowMs - windowHours * 3_600_000).toISOString();
    const warnAfter = new Date(nowMs - (windowHours - WINDOW_WARN_HOURS) * 3_600_000).toISOString();

    const { data, error } = await db()
      .from('conversations')
      .select('id,page_id,assigned_admin_id,last_customer_message_at,customer_id')
      .not('last_customer_message_at', 'is', null)
      .gte('last_customer_message_at', windowStart)
      .lte('last_customer_message_at', idleBefore)
      .order('last_customer_message_at', { ascending: true })
      .limit(MAX_ROWS);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as ConvRow[];
    summary.scanned = rows.length;
    if (rows.length === 0) return summary;

    const pending = await unansweredIds(rows);
    if (pending.size === 0) return summary;

    // ชื่อลูกค้า — ดึงทีเดียวทั้งชุด
    const names = new Map<string, string>();
    const { data: custRows, error: customerError } = await db()
      .from('customers')
      .select('id,name')
      .in('id', rows.map((r) => r.customer_id));
    if (customerError) throw new Error(`อ่านชื่อลูกค้าไม่สำเร็จ: ${customerError.message}`);
    for (const c of (custRows ?? []) as Array<{ id: string; name: string | null }>) {
      names.set(c.id, c.name || 'ลูกค้า');
    }

    const { data: prevRows, error: previewError } = await db()
      .from('conversations')
      .select('id,last_message_preview')
      .in('id', [...pending]);
    if (previewError) throw new Error(`อ่านข้อความตัวอย่างไม่สำเร็จ: ${previewError.message}`);
    const previews = new Map(
      ((prevRows ?? []) as Array<{ id: string; last_message_preview: string | null }>)
        .map((p) => [p.id, p.last_message_preview]),
    );

    for (const row of rows) {
      if (!pending.has(row.id)) continue;
      const stamp = row.last_customer_message_at!;
      const who = names.get(row.customer_id) ?? 'ลูกค้า';
      const link = `/inbox?c=${row.id}`;

      /* ---- เงียบเกิน 15 นาที : บอกทุกคน เพราะยังไม่มีใครรับ ---- */
      const idle = await dispatchNotification({
        event: 'idle_15min',
        page_id: row.page_id,
        // 🔴 ต้องมีเวลาข้อความล่าสุดอยู่ในกุญแจ ไม่งั้นเตือนได้ครั้งเดียวตลอดชีวิตห้อง
        subject_id: `${row.id}:${stamp}`,
        conversation_id: row.id,
        assigned_admin_id: row.assigned_admin_id,
        title: `⏰ ${who} รอมา ${IDLE_MINUTES} นาทีแล้ว`,
        body: preview(previews.get(row.id)),
        link,
      });
      summary.idle_queued += idle.queued;

      /* ---- ใกล้หมดกรอบ 24 ชม. : บอกคนที่รับแชทไว้ ---- */
      if (stamp <= warnAfter && row.assigned_admin_id) {
        const left = Math.max(
          0,
          Math.round((new Date(stamp).getTime() + windowHours * 3_600_000 - nowMs) / 60_000),
        );
        const closing = await dispatchNotification({
          event: 'window_closing',
          page_id: row.page_id,
          // กรอบหนึ่งรอบ = ข้อความล่าสุดหนึ่งครั้ง จึงใช้เวลาเดียวกันเป็นกุญแจ
          subject_id: `${row.id}:${stamp}`,
          conversation_id: row.id,
          assigned_admin_id: row.assigned_admin_id,
          title: `⚠️ เหลือเวลาตอบ ${who} อีก ${left} นาที`,
          body: 'พ้นกรอบเวลาแล้วจะส่งข้อความธรรมดาไม่ได้อีก',
          link,
        });
        summary.window_queued += closing.queued;
      }
    }

    return summary;
  } catch (err) {
    console.error('[notify] เดินตรวจแชทค้างไม่สำเร็จ (ข้ามรอบนี้):', err);
    return summary;
  }
}
