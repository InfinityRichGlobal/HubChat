'use client';
/**
 * ลงทะเบียน Service Worker (รอบ 10)
 * ===========================================================================
 * ต้องทำจากฝั่งเบราว์เซอร์เท่านั้น จึงเป็น client component ตัวเล็ก ๆ ตัวเดียว
 * ที่ไม่แสดงอะไรบนหน้าจอเลย
 *
 * ⚠️ Service Worker ทำงานเฉพาะบน https หรือ localhost เท่านั้น
 *    เปิดผ่าน http://192.168.x.x จะลงทะเบียนไม่ได้ — ไม่ใช่บั๊กของเรา
 *    (นี่คือเหตุผลที่ต้องใช้ Cloudflare Tunnel ตอนทดสอบบนมือถือ)
 */
import { useEffect } from 'react';

export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        // สั่งอัปเดต Service Worker ทันทีเมื่อเปิดแอป
        void registration.update();
      } catch (err) {
        console.warn('[pwa] ลงทะเบียน service worker ไม่สำเร็จ:', err);
      }
    };

    // รอให้หน้าโหลดเสร็จก่อน จะได้ไม่ไปแย่งแบนด์วิดท์ตอนเปิดแอปครั้งแรก
    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', () => void register(), { once: true });

    // เมื่อสลับกลับเข้ามาในแอป ให้ตรวจหาอัปเดต Service Worker เสมอ
    const checkUpdate = () => {
      if (document.visibilityState === 'visible' && registration) {
        void registration.update().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', checkUpdate);

    return () => {
      document.removeEventListener('visibilitychange', checkUpdate);
    };
  }, []);

  return null;
}
