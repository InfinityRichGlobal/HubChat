/**
 * ตัวช่วยฝั่งเบราว์เซอร์สำหรับเปิด/ปิดแจ้งเตือน (รอบ 10)
 * ===========================================================================
 * ⚠️ ไฟล์นี้อยู่ฝั่งเบราว์เซอร์ ห้ามมีความลับใด ๆ
 *    กุญแจที่ใช้ตรงนี้เป็น "กุญแจสาธารณะ" ที่ตั้งใจให้เปิดเผยอยู่แล้ว
 *
 * 🔴 บทเรียนเรื่อง iPhone ที่ต้องบอกผู้ใช้ให้ชัด :
 *    บน iOS การขอสิทธิ์แจ้งเตือนจะสำเร็จเฉพาะเมื่อ
 *      1. เพิ่มลงหน้าจอโฮมแล้ว (เปิดเป็นแอป ไม่ใช่แท็บ Safari) และ
 *      2. ผู้ใช้กดปุ่มด้วยนิ้วจริง ๆ (เรียกอัตโนมัติตอนโหลดหน้าไม่ได้)
 *    ถ้าไม่ครบสองข้อ ระบบจะเงียบ ๆ ไม่ขึ้นอะไรเลย ซึ่งทำให้คนคิดว่าแอปพัง
 */

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'ios_needs_install' | 'insecure' ; message_th: string };

/** เปิดเป็นแอปที่ติดตั้งแล้วอยู่หรือเปล่า */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
  return window.matchMedia?.('(display-mode: standalone)').matches === true || iosStandalone === true;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPad รุ่นใหม่รายงานตัวเองว่าเป็น Mac จึงต้องดู touch ประกอบ
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function checkPushSupport(): PushSupport {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported', message_th: '' };

  if (!window.isSecureContext) {
    return {
      ok: false,
      reason: 'insecure',
      message_th: 'แจ้งเตือนใช้ได้เฉพาะเว็บที่เป็น https เท่านั้น — เปิดผ่านที่อยู่ https ก่อน',
    };
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (isIos() && !isStandalone()) {
      return {
        ok: false,
        reason: 'ios_needs_install',
        message_th: 'บน iPhone ต้อง "เพิ่มลงหน้าจอโฮม" ก่อน ถึงจะเปิดแจ้งเตือนได้',
      };
    }
    return {
      ok: false,
      reason: 'unsupported',
      message_th: 'เบราว์เซอร์นี้ไม่รองรับแจ้งเตือน — ลองใช้ Chrome หรือ Safari รุ่นใหม่',
    };
  }

  if (isIos() && !isStandalone()) {
    return {
      ok: false,
      reason: 'ios_needs_install',
      message_th: 'บน iPhone ต้อง "เพิ่มลงหน้าจอโฮม" ก่อน ถึงจะเปิดแจ้งเตือนได้',
    };
  }

  return { ok: true };
}

/** แปลงกุญแจ base64url ของ VAPID เป็นรูปแบบที่ PushManager ต้องการ */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function guessPlatform(): 'ios' | 'android' | 'desktop' {
  if (isIos()) return 'ios';
  if (typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)) return 'android';
  return 'desktop';
}

export type EnableResult =
  | { ok: true; endpoint: string }
  | { ok: false; message_th: string };

/**
 * เปิดแจ้งเตือนบนเครื่องนี้
 * ⚠️ ต้องถูกเรียกจากการกดปุ่มของผู้ใช้เท่านั้น ห้ามเรียกอัตโนมัติ
 */
export async function enablePush(): Promise<EnableResult> {
  const support = checkPushSupport();
  if (!support.ok) return { ok: false, message_th: support.message_th };

  const keyRes = await fetch('/api/notify/subscribe');
  const keyJson = (await keyRes.json()) as {
    ok: boolean;
    data?: { configured: boolean; public_key: string | null };
    error?: { message_th: string };
  };
  if (!keyJson.ok || !keyJson.data?.configured || !keyJson.data.public_key) {
    return {
      ok: false,
      message_th: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งกุญแจแจ้งเตือน — บอกเจ้าของร้านให้รัน npm run vapid ก่อน',
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      ok: false,
      message_th:
        permission === 'denied'
          ? 'เครื่องนี้เคยกด "ไม่อนุญาต" ไว้ — ต้องไปเปิดใหม่ในตั้งค่าเบราว์เซอร์ ปุ่มนี้ขอซ้ำไม่ได้แล้ว'
          : 'ยังไม่ได้กดอนุญาต',
    };
  }

  const reg = await navigator.serviceWorker.ready;

  /**
   * ⭐ ถ้าเคยสมัครไว้ด้วยกุญแจคนละอัน ต้องยกเลิกของเก่าก่อน
   *    ไม่งั้น subscribe จะโยน error ว่าสมัครซ้ำ แล้วผู้ใช้จะติดอยู่ตรงนี้ตลอดไป
   */
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    const sameKey =
      existing.options?.applicationServerKey &&
      btoa(String.fromCharCode(...new Uint8Array(existing.options.applicationServerKey as ArrayBuffer)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === keyJson.data.public_key;
    if (!sameKey) await existing.unsubscribe();
  }

  let sub: PushSubscription;
  try {
    sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true, // บังคับโดยเบราว์เซอร์ : ทุกแจ้งเตือนต้องมองเห็นได้
        applicationServerKey: urlBase64ToUint8Array(keyJson.data.public_key) as BufferSource,
      }));
  } catch (err) {
    return { ok: false, message_th: `สมัครรับแจ้งเตือนไม่สำเร็จ: ${String(err)}` };
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    return { ok: false, message_th: 'เบราว์เซอร์คืนข้อมูลการสมัครมาไม่ครบ ลองใหม่อีกครั้ง' };
  }

  const saveRes = await fetch('/api/notify/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      platform: guessPlatform(),
    }),
  });
  const saveJson = (await saveRes.json()) as { ok: boolean; error?: { message_th: string } };
  if (!saveJson.ok) {
    return { ok: false, message_th: saveJson.error?.message_th ?? 'บันทึกเครื่องนี้ไม่สำเร็จ' };
  }

  return { ok: true, endpoint: json.endpoint };
}

/** ปิดแจ้งเตือนบนเครื่องนี้ */
export async function disablePush(): Promise<{ ok: boolean; message_th?: string }> {
  if (!('serviceWorker' in navigator)) return { ok: true };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { ok: true };

  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await fetch('/api/notify/subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  return { ok: true };
}

/** เครื่องนี้เปิดแจ้งเตือนไว้อยู่หรือเปล่า */
export async function currentSubscription(): Promise<string | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub?.endpoint ?? null;
  } catch {
    return null;
  }
}
