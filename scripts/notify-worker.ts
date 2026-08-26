/**
 * ตัวเดินตรวจ + ส่งแจ้งเตือน (รอบ 10)
 * -------------------------------------------------------------------------
 * รัน : npm run notify
 *
 * ทำสองอย่างวนไปเรื่อย ๆ :
 *   1. เดินตรวจแชทที่ลูกค้ารออยู่ (เงียบ 15 นาที / ใกล้หมดกรอบ 24 ชม.)
 *      — สองเรื่องนี้ไม่มี webhook ยิงมาบอก เพราะมันคือ "การที่ไม่มีอะไรเกิดขึ้น"
 *   2. ส่งของที่ค้างคิวออกไป (push รายเครื่อง / Telegram รวบเป็นข้อความเดียว)
 *
 * ⭐ ทางเลือกแทนการรันตัวนี้ : ตั้ง cron ให้ยิง POST /api/notify/flush
 *    พร้อมหัวข้อ Authorization: Bearer <CRON_SECRET> ทุก 5 นาที
 *    (บน Vercel ใช้แบบหลัง เพราะรันโปรเซสค้างไว้ไม่ได้)
 *
 * ⚠️ ห้ามตั้งถี่กว่า 1 นาที — Telegram จำกัด ~20 ข้อความ/นาทีต่อกลุ่ม
 *    ยิงถี่เกินจะโดนปลายทางหน่วง แล้วแจ้งเตือนจะมาช้ากว่าเดิม
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const INTERVAL_MS = Number(process.env.NOTIFY_INTERVAL_MS ?? 60_000);

let stopping = false;

async function main() {
  const { flushNotifications } = await import('../src/server/notify/dispatch');
  const { scanIdleAndClosing } = await import('../src/server/notify/scan');

  console.log(`[notify] เริ่มทำงาน ตรวจทุก ${Math.round(INTERVAL_MS / 1000)} วินาที (กด Ctrl+C เพื่อหยุด)`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`\n[notify] ได้รับสัญญาณ ${signal} — จะหยุดหลังรอบปัจจุบันเสร็จ`);
      stopping = true;
    });
  }

  while (!stopping) {
    try {
      // เดินตรวจก่อน แล้วค่อยส่ง — ของที่เพิ่งเข้าคิวจะได้ออกในรอบเดียวกัน
      const scan = await scanIdleAndClosing();
      const sent = await flushNotifications();

      const moved =
        scan.idle_queued + scan.window_queued + sent.push_sent + sent.telegram_items;
      if (moved > 0) {
        console.log(
          `[notify] ตรวจ ${scan.scanned} ห้อง | เข้าคิวใหม่ เงียบ ${scan.idle_queued} ใกล้หมดกรอบ ${scan.window_queued} | ` +
            `push ส่ง ${sent.push_sent} พัง ${sent.push_failed} ปลด ${sent.push_disabled} | ` +
            `telegram ${sent.telegram_items} รายการ`,
        );
      }
    } catch (err) {
      // ห้ามตาย — แจ้งเตือนพลาดหนึ่งรอบยังพอทน แต่ตัวเดินตรวจตายคือไม่มีใครเตือนอีกเลย
      console.error('[notify] รอบนี้ผิดพลาด (จะลองใหม่):', err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }

  console.log('[notify] หยุดเรียบร้อย');
  process.exit(0);
}

main().catch((err) => {
  console.error('[notify] เริ่มทำงานไม่สำเร็จ:', err);
  process.exit(1);
});
