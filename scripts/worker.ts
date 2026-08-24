/**
 * ตัวกวาดคิว webhook แบบวนตลอดเวลา
 * -------------------------------------------------------------------------
 * รัน : npm run worker
 *
 * ปกติไม่จำเป็นต้องใช้ เพราะเว็บประมวลผลให้เองทันทีหลังตอบ Meta
 * ตัวนี้เป็น "ตาข่ายกันพลาด" สำหรับกรณี :
 *   • เซิร์ฟเวอร์รีสตาร์ตกลางทาง แล้วมีงานค้างในคิว
 *   • งานที่พังแล้วถูกเอากลับเข้าคิวเพื่อลองใหม่
 *   • วันหนึ่งย้ายไปรันบนแพลตฟอร์มที่ตัดงานเบื้องหลังทิ้งหลังตอบคำขอ
 *
 * ถ้าจะรันบน Railway ให้ตั้งเป็น service แยกอีกตัวโดยใช้คำสั่งนี้
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 2000);

let stopping = false;

async function main() {
  // import ทีหลังเพื่อให้ค่าจาก .env.local ถูกอ่านก่อนเสมอ
  const { processWebhookBatch } = await import('../src/server/ingest/processor');

  console.log(`[worker] เริ่มทำงาน ตรวจคิวทุก ${INTERVAL_MS} มิลลิวินาที (กด Ctrl+C เพื่อหยุด)`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`\n[worker] ได้รับสัญญาณ ${signal} — จะหยุดหลังทำงานชิ้นปัจจุบันเสร็จ`);
      stopping = true;
    });
  }

  while (!stopping) {
    try {
      const summary = await processWebhookBatch();
      if (summary.jobs > 0) {
        console.log(
          `[worker] ทำงาน ${summary.jobs} ชิ้น | เข้า ${summary.inbound_saved} | ออก ${summary.echo_saved} | ` +
            `ซ้ำ ${summary.duplicates} | ข้าม ${summary.ignored} | เพจไม่รู้จัก ${summary.unknown_page} | ` +
            `พัง ${summary.failed_jobs}`,
        );
      }
    } catch (err) {
      // ห้ามตาย — ฐานข้อมูลสะดุดชั่วคราวต้องกลับมาทำงานต่อได้เอง
      console.error('[worker] รอบนี้ผิดพลาด (จะลองใหม่):', err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }

  console.log('[worker] หยุดเรียบร้อย');
  process.exit(0);
}

main().catch((err) => {
  console.error('[worker] เริ่มทำงานไม่สำเร็จ:', err);
  process.exit(1);
});
