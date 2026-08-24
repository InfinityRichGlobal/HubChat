/**
 * ประตูรับ webhook จาก Meta (Messenger + Instagram)
 * ===========================================================================
 * นี่คือที่อยู่สาธารณะที่เดียวของระบบที่ไม่ต้อง login
 * จึงต้องระวังเป็นพิเศษ 3 อย่าง :
 *
 *   1. ⭐ ตรวจลายเซ็นทุกครั้ง (เช็คลิสต์ข้อ 2)
 *      ไม่ตรง = ปฏิเสธ ไม่ต้องดูเนื้อหาเลย
 *
 *   2. ⭐ ตอบให้เร็วที่สุด (สเปกหัวข้อ 6.3)
 *      รับ → วางลงคิว → ตอบ 200
 *      ห้ามแกะข้อความ ห้ามเขียนตารางแชท ห้ามยิงถาม Meta ก่อนตอบ
 *      เพราะถ้าตอบช้า Meta จะยิงซ้ำ แล้วจะกลายเป็นข้อความซ้ำ
 *
 *   3. ⭐ ห้ามบอกรายละเอียดภายในกลับไปในข้อความ error
 *      ที่อยู่นี้ใครก็ยิงมาลองได้
 *
 * งานหนักทั้งหมดทำ "หลังตอบไปแล้ว" ด้วย after() ของ Next.js
 */
import { after, type NextRequest } from 'next/server';
import { serverEnv } from '@/config/env';
import { enqueueWebhook } from '@/server/ingest/queue';
import { processWebhookBatch } from '@/server/ingest/processor';
import { verifyHubToken, verifyMetaSignature } from '@/server/ingest/signature';

// ต้องใช้ node:crypto ในการตรวจลายเซ็น จึงรันบน Node ไม่ใช่ Edge
export const runtime = 'nodejs';
// ห้าม cache เด็ดขาด ทุกคำขอคือของใหม่
export const dynamic = 'force-dynamic';

/* ------------------------------------------------------------------------ */
/* GET — Meta มาขอยืนยันว่าเราเป็นเจ้าของ URL นี้จริง (ทำครั้งเดียวตอนตั้งค่า)     */
/* ------------------------------------------------------------------------ */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  const expected = serverEnv().META_VERIFY_TOKEN;

  if (mode === 'subscribe' && verifyHubToken(token, expected) && challenge) {
    // ต้องตอบกลับเป็นข้อความล้วน ๆ ตามที่ Meta กำหนด ห้ามหุ้ม JSON
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  console.warn('[webhook] คำขอยืนยัน URL ไม่ผ่าน — ตรวจ META_VERIFY_TOKEN ให้ตรงกับที่กรอกใน Meta');
  return new Response('Forbidden', { status: 403 });
}

/* ------------------------------------------------------------------------ */
/* POST — เหตุการณ์จริงจาก Meta                                                */
/* ------------------------------------------------------------------------ */
export async function POST(req: NextRequest) {
  // ⚠️ ต้องอ่านเป็นข้อความดิบก่อนเสมอ ห้าม req.json()
  //    เพราะลายเซ็นคำนวณจากตัวอักษรชุดนี้เป๊ะ ๆ
  const rawBody = await req.text();

  const signature = verifyMetaSignature(
    rawBody,
    req.headers.get('x-hub-signature-256'),
    serverEnv().META_APP_SECRET,
  );

  if (!signature.ok) {
    console.warn(`[webhook] ปฏิเสธคำขอ: ${signature.message_th}`);
    // ตอบสั้น ๆ ไม่บอกเหตุผลกลับไป
    return new Response('Forbidden', { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // ลายเซ็นผ่านแต่เนื้อหาไม่ใช่ JSON — แปลกมาก และลองใหม่ไปก็เหมือนเดิม
    console.error('[webhook] ลายเซ็นผ่านแต่เนื้อหาไม่ใช่ JSON');
    return new Response('EVENT_RECEIVED', { status: 200 });
  }

  try {
    await enqueueWebhook(payload);
  } catch (err) {
    // วางลงคิวไม่ได้ = ฐานข้อมูลมีปัญหา
    // ต้องตอบ 500 เพื่อให้ Meta ยิงซ้ำ ไม่งั้นข้อความลูกค้าหายถาวร
    console.error('[webhook] วางงานลงคิวไม่สำเร็จ:', err);
    return new Response('Queue unavailable', { status: 500 });
  }

  // ⭐ ตรงนี้คือหัวใจ : สั่งให้ประมวลผล "หลังจากส่งคำตอบออกไปแล้ว"
  //    Meta จึงได้ 200 ทันที ส่วนงานจริงทำต่อเบื้องหลัง
  //    ถ้าเบื้องหลังพัง ก็ยังมีงานค้างอยู่ในคิวให้ worker มาเก็บทีหลัง
  after(async () => {
    try {
      await processWebhookBatch();
    } catch (err) {
      console.error('[webhook] ประมวลผลเบื้องหลังไม่สำเร็จ (งานยังอยู่ในคิว):', err);
    }
  });

  return new Response('EVENT_RECEIVED', { status: 200 });
}
