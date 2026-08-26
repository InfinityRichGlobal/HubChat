/* eslint-disable */
/**
 * Service Worker ของ HubChat (รอบ 10)
 * ===========================================================================
 * ไฟล์นี้ทำงานอยู่ "นอก" แอป React ทำงานต่อแม้ปิดแท็บไปแล้ว
 * จึงเป็นที่เดียวที่รับแจ้งเตือนตอนแอดมินไม่ได้เปิดหน้าเว็บอยู่ได้
 *
 * 🔴 กฎเหล็กของไฟล์นี้ :
 *   1. ห้ามแคชหน้าเว็บของแอปเด็ดขาด
 *      แชทเปลี่ยนทุกวินาที ถ้าแคชไว้ แอดมินจะเห็นข้อความเก่าแล้วตอบผิดคน
 *      แคชได้แค่หน้า "ออฟไลน์" หน้าเดียวที่ไม่มีข้อมูลลูกค้าอยู่ในนั้น
 *
 *   2. ห้ามใส่ความลับใด ๆ ลงไฟล์นี้
 *      ไฟล์นี้ดาวน์โหลดได้จากเบราว์เซอร์ตรง ๆ ที่ /sw.js ใครก็เปิดอ่านได้
 *
 *   3. กดแจ้งเตือนแล้วต้อง "เข้าไปที่ห้องแชทนั้น" ไม่ใช่เปิดหน้าแรก
 *      และถ้าแอปเปิดค้างอยู่แล้ว ต้องใช้แท็บเดิม ไม่ใช่เปิดแท็บใหม่ซ้อนกันเรื่อย ๆ
 *
 * ⚠️ iPhone : แจ้งเตือนทำงานเฉพาะเมื่อ "เพิ่มลงหน้าจอโฮม" แล้วเท่านั้น
 *    เปิดจาก Safari เฉย ๆ จะไม่มีวันได้รับแจ้งเตือน ไม่ใช่บั๊กของเรา
 */

const OFFLINE_URL = '/offline.html';
const CACHE_NAME = 'hubchat-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL])).catch(() => undefined),
  );
  // เวอร์ชันใหม่ต้องมาแทนของเก่าทันที ไม่ต้องรอปิดทุกแท็บ
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/**
 * ⭐ ขอไฟล์ทุกอย่างจากเน็ตเสมอ
 *    แคชถูกใช้เฉพาะตอนเน็ตหลุด และเฉพาะการเปิดหน้า (navigate) เท่านั้น
 */
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return cached || new Response('ออฟไลน์', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }),
  );
});

/* ------------------------------------------------------------------------ */
/* แจ้งเตือนเข้า                                                              */
/* ------------------------------------------------------------------------ */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: 'HubChat', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'HubChat';
  const link = payload.link || '/inbox';

  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    /**
     * ⭐ tag = ห้องแชท → แจ้งเตือนของห้องเดิมทับของเก่า ไม่กองเป็นสิบอัน
     *    renotify ให้สั่นซ้ำได้เมื่อมีข้อความใหม่จริง ๆ
     */
    tag: payload.tag || 'hubchat',
    renotify: true,
    data: { link },
    dir: 'ltr',
    lang: 'th',
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // เลขบนไอคอนแอป — รองรับเฉพาะบางระบบ ไม่รองรับก็ไม่พัง
      if (typeof payload.badge_count === 'number' && 'setAppBadge' in self.navigator) {
        try {
          if (payload.badge_count > 0) await self.navigator.setAppBadge(payload.badge_count);
          else await self.navigator.clearAppBadge();
        } catch (_) {}
      }
    })(),
  );
});

/**
 * 🔴 กดแจ้งเตือน = ต้องเข้าห้องแชทนั้น
 *    และต้องใช้แท็บที่เปิดอยู่แล้วถ้ามี ไม่งั้นแอดมินจะมีสิบแท็บใน 1 ชั่วโมง
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  /**
   * ⭐ กดแจ้งเตือน = กำลังจะเข้าไปดู → ลบเลขแดงบนไอคอนทิ้ง
   *    ถ้าไม่ลบ เลขจะค้างอยู่จนกว่าจะมีแจ้งเตือนอันถัดไปมาอัปเดต
   *    แล้วผู้ใช้จะเห็นเลขค้างทั้งที่อ่านหมดแล้ว
   */
  if ('clearAppBadge' in self.navigator) {
    try { self.navigator.clearAppBadge(); } catch (_) {}
  }
  const link = (event.notification.data && event.notification.data.link) || '/inbox';

  event.waitUntil(
    (async () => {
      const target = new URL(link, self.location.origin);
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      for (const client of all) {
        // แท็บของแอปเราเปิดอยู่แล้ว → พาไปหน้าที่ต้องการในแท็บเดิม
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) {
            try { await client.navigate(target.href); } catch (_) {}
          }
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

/** ผู้ใช้ปัดแจ้งเตือนทิ้ง — ไม่ต้องทำอะไร แต่ดักไว้ไม่ให้เบราว์เซอร์บ่น */
self.addEventListener('notificationclose', () => {});
