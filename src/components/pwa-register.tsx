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
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        // ลงทะเบียนไม่ได้ = ไม่มีแจ้งเตือน แต่แอปยังใช้งานได้ปกติทุกอย่าง
        console.warn('[pwa] ลงทะเบียน service worker ไม่สำเร็จ:', err);
      });
    };

    // รอให้หน้าโหลดเสร็จก่อน จะได้ไม่ไปแย่งแบนด์วิดท์ตอนเปิดแอปครั้งแรก
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
