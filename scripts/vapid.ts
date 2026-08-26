/**
 * สร้างคู่กุญแจ VAPID สำหรับแจ้งเตือน PWA (รอบ 10)
 * -------------------------------------------------------------------------
 * วิธีใช้ :
 *   npm run vapid
 * แล้วคัดลอกสามบรรทัดที่ได้ไปวางใน .env.local
 *
 * 🔴 ทำครั้งเดียวพอ แล้วเก็บไว้ตลอดไป
 *    ถ้าเปลี่ยนกุญแจ เครื่องที่เคยกดอนุญาตแจ้งเตือนไว้ "จะใช้ไม่ได้ทั้งหมด"
 *    ทุกคนต้องกดอนุญาตใหม่หมด — ไม่ใช่เรื่องที่อยากทำบ่อย
 *
 * ⚠️ VAPID_PRIVATE_KEY คือความลับ ห้าม commit ห้ามส่งให้ใคร ห้ามขึ้นหน้าเว็บ
 *    ส่วน VAPID_PUBLIC_KEY เปิดเผยได้ เบราว์เซอร์ต้องใช้อยู่แล้ว
 */
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log(`
สร้างกุญแจเรียบร้อย — คัดลอก 3 บรรทัดนี้ไปวางใน .env.local

VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
VAPID_SUBJECT=mailto:admin@example.com   # ← เปลี่ยนเป็นอีเมลจริงของร้าน

หมายเหตุ :
  • VAPID_SUBJECT ต้องเป็น mailto: หรือ https: เท่านั้น (ข้อกำหนดของมาตรฐาน)
    ปลายทางใช้ติดต่อกลับเวลาเซิร์ฟเวอร์เราส่งแจ้งเตือนผิดปกติ
  • ห้ามเอา VAPID_PRIVATE_KEY ไปใส่ในไฟล์ที่ commit ขึ้น GitHub เด็ดขาด
  • ต้องตั้ง APP_BASE_URL ด้วย เช่น APP_BASE_URL=https://chat.ร้านคุณ.com
    ไม่งั้นลิงก์ในแจ้งเตือน Telegram จะกดไม่ได้
`);
