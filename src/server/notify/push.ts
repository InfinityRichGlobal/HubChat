import 'server-only';
/**
 * แจ้งเตือนผ่าน PWA Push (รอบ 10 — สเปกหัวข้อ 6.7 ก.)
 * ===========================================================================
 * ⚠️ ข้อจำกัดของ iPhone ที่ต้องบอกผู้ใช้ให้ชัด :
 *    แจ้งเตือนบน iOS ทำงาน **เฉพาะเมื่อติดตั้งลงหน้าจอโฮมแล้ว** เท่านั้น
 *    เปิดจาก Safari เฉย ๆ จะขอสิทธิ์ไม่ได้เลย
 *    หน้าเว็บจึงต้องตรวจแล้วสอนวิธีติดตั้ง ไม่ใช่ปล่อยให้ผู้ใช้งงว่าทำไมไม่ได้
 *
 * 🔴 ปลายทางตอบ 404/410 = ผู้ใช้ถอนการติดตั้ง/ล้างข้อมูลเบราว์เซอร์
 *    ต้องปิดเครื่องนั้นทันที ไม่ใช่ยิงต่อไปเรื่อย ๆ จนโดนปลายทางแบนทั้งเซิร์ฟเวอร์
 */
import webpush from 'web-push';
import { db } from '@/lib/supabase/admin';
import { getRuntimeSetting } from '@/server/settings/service';

export type PushPayload = {
  title: string;
  body: string;
  link?: string | null;
  /** จำนวนแชทที่ยังไม่อ่าน — เอาไปขึ้น badge บนไอคอนแอป */
  badge_count?: number;
  tag?: string;
};

let configuredSignature: string | null = null;

/** ตั้งค่า VAPID ครั้งเดียวต่อโปรเซส */
async function ensureConfigured(): Promise<boolean> {
  const [publicKey, privateKey, subject] = await Promise.all([
    getRuntimeSetting('VAPID_PUBLIC_KEY'), getRuntimeSetting('VAPID_PRIVATE_KEY'), getRuntimeSetting('VAPID_SUBJECT'),
  ]);

  if (!publicKey || !privateKey) return false;
  const signature = `${publicKey}:${privateKey}:${subject ?? ''}`;
  if (configuredSignature === signature) return true;

  webpush.setVapidDetails(subject || 'mailto:admin@hubchat.local', publicKey, privateKey);
  configuredSignature = signature;
  return true;
}

export async function isPushConfigured(): Promise<boolean> {
  const [publicKey, privateKey] = await Promise.all([
    getRuntimeSetting('VAPID_PUBLIC_KEY'), getRuntimeSetting('VAPID_PRIVATE_KEY'),
  ]);
  return Boolean(publicKey && privateKey);
}

export async function publicVapidKey(): Promise<string | null> {
  return getRuntimeSetting('VAPID_PUBLIC_KEY');
}

export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** เครื่องทั้งหมดของแอดมินคนหนึ่งที่ยังใช้งานอยู่ */
export async function liveSubscriptions(adminId: string): Promise<PushSubscriptionRow[]> {
  const { data, error } = await db()
    .from('push_subscriptions')
    .select('id,endpoint,p256dh,auth')
    .eq('admin_id', adminId)
    .is('disabled_at', null);
  if (error) throw new Error(`อ่านอุปกรณ์รับแจ้งเตือนไม่สำเร็จ: ${error.message}`);
  return (data ?? []) as PushSubscriptionRow[];
}

export type PushResult = {
  sent: number;
  disabled: number;
  failed: number;
};

/**
 * ส่งแจ้งเตือนไปทุกเครื่องของแอดมินคนหนึ่ง
 *
 * ⚠️ ต้องไม่โยน error ออกไป — แจ้งเตือนพังต้องไม่ทำให้งานอื่นในคิวพัง
 */
export async function sendPushToAdmin(adminId: string, payload: PushPayload): Promise<PushResult> {
  const result: PushResult = { sent: 0, disabled: 0, failed: 0 };
  if (!(await ensureConfigured())) return result;

  const subs = await liveSubscriptions(adminId);
  if (subs.length === 0) return result;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    link: payload.link ?? '/inbox',
    badge_count: payload.badge_count ?? 0,
    tag: payload.tag ?? 'hubchat',
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 3600 },
      );
      result.sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 0;

      /**
       * 🔴 404 / 410 = ปลายทางบอกว่า "ไม่มีเครื่องนี้แล้ว"
       *    ต้องปิดทันที ยิงต่อไม่มีประโยชน์และเสี่ยงโดนแบน
       */
      if (status === 404 || status === 410) {
        await db().rpc('disable_push_subscription', {
          p_endpoint: sub.endpoint,
          p_reason: `ปลายทางตอบ ${status}`,
        });
        result.disabled += 1;
        continue;
      }

      result.failed += 1;
      console.warn(`[push] ส่งไม่สำเร็จ (endpoint=${sub.endpoint.slice(0, 40)}…): ${String(err)}`);
    }
  }

  return result;
}

/* ------------------------------------------------------------------------ */
/* สมัคร / ยกเลิกรับแจ้งเตือน                                                  */
/* ------------------------------------------------------------------------ */

export type SubscribeInput = {
  admin_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label?: string | null;
  /** ชนิดเครื่อง — ใช้ตอบคำถาม "ทำไม iPhone ฉันไม่เด้ง" ได้เร็วขึ้น */
  platform?: 'ios' | 'android' | 'desktop' | null;
  user_agent?: string | null;
};

export async function saveSubscription(input: SubscribeInput): Promise<void> {
  /**
   * ⭐ endpoint เดียวกัน = เครื่องเดียวกัน
   *    upsert เพื่อไม่ให้เปิดหน้าเว็บซ้ำ ๆ แล้วได้แจ้งเตือนหลายรอบต่อหนึ่งเหตุการณ์
   */
  const { error } = await db()
    .from('push_subscriptions')
    .upsert(
      {
        admin_id: input.admin_id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        device_label: input.device_label ?? null,
        platform: input.platform ?? null,
        user_agent: input.user_agent?.slice(0, 300) ?? null,
        last_used_at: new Date().toISOString(),
        disabled_at: null,
        failure_count: 0,
      },
      { onConflict: 'endpoint' },
    );
  if (error) throw new Error(`บันทึกการสมัครรับแจ้งเตือนไม่สำเร็จ: ${error.message}`);
}

export async function removeSubscription(adminId: string, endpoint: string): Promise<void> {
  // ⚠️ ลบได้เฉพาะเครื่องของตัวเอง — กันการยัด endpoint ของคนอื่นมาลบ
  await db().from('push_subscriptions').delete().eq('admin_id', adminId).eq('endpoint', endpoint);
}
