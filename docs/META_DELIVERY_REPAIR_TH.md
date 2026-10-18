# บันทึกซ่อมทางรับข้อความและการตอบคอมเมนต์ — 18 ตุลาคม 2026

## สาเหตุที่แก้

- `ingest_comment` เดิมรายงานรายการซ้ำเป็นรายการใหม่เมื่อ `ON CONFLICT DO UPDATE` สำเร็จ ทำให้การ sync เรียกบอทซ้ำ
- บอทตอบสาธารณะตรวจสถานะแล้วส่งโดยไม่มีการจองในฐานข้อมูล หลาย worker จึงส่งพร้อมกันได้
- การเปิด/รีเฟรชรายการแชทและคอมเมนต์เคยเรียก worker และ sync ซึ่งอาจส่งข้อความโดยที่ผู้ใช้เพียงเปิดหน้า
- เมื่อบันทึกคอมเมนต์ล้มเหลว worker เคยปิดคิวเป็นสำเร็จ และเหตุการณ์อื่นใน payload อาจไม่ได้ประมวลผล
- backfill เคยหยุดกลางหน้าเมื่อใช้เวลาเกิน 6.5 วินาทีแล้วเลื่อน cursor ทำให้ข้ามห้องที่เหลือ
- หลัง private reply เคยใช้ลูกค้าล่าสุดของทั้งเพจมาแทนผู้เขียนคอมเมนต์ ซึ่งอาจเป็นคนละคน

## พฤติกรรมใหม่

- RPC แยกการ insert ใหม่กับข้อมูลซ้ำจริง และเติมโปรไฟล์โดยไม่กระตุ้นการตอบใหม่
- บอทจองสิทธิ์ตอบสาธารณะด้วย atomic UPDATE ก่อนเรียก Meta ถ้า timeout หรือบันทึกผลหลังส่งไม่ได้ จะเก็บสถานะและไม่ส่งซ้ำอัตโนมัติ แอดมินต้องตรวจผลบน Meta ก่อนตอบเอง
- การตอบสาธารณะกับ private reply มีสถานะแยกกัน การ replay จึงกู้ขั้นที่ยังไม่เริ่มได้
- GET รายการอ่านข้อมูลเท่านั้น ปุ่มนำเข้าคอมเมนต์เป็น POST ที่ตรวจสิทธิ์รายเพจ และไม่ตอบคอมเมนต์ย้อนหลังอัตโนมัติ
- worker ทำเหตุการณ์ที่เหลือต่อและเก็บงานที่ล้มเหลวไว้ retry; backfill ทำทั้งหน้าก่อนเลื่อน cursor

## ลำดับติดตั้ง

1. รัน `supabase/migrations/20261018_comment_delivery_hardening.sql` ก่อน deploy โค้ด ไฟล์รันซ้ำได้และไม่ลบข้อมูลคอมเมนต์
2. รัน `npm run check-db` ซึ่งตรวจทั้งตาราง คอลัมน์จองสิทธิ์ และ RPC ด้วย argument NULL ที่ไม่แตะคอมเมนต์จริง
3. รัน `npm run typecheck`, `npm test`, `npm run lint`, `npm run test:pg`, `npm run build`
4. Deploy และทดสอบจากบัญชีทดสอบ Facebook/Instagram จริง ทั้ง DM และคอมเมนต์ ตรวจคิวเป็น done และไม่มีคำตอบซ้ำ

Migration ลงผ่าน SQL Editor บนโปรเจกต์ Supabase ที่ตรงกับ `.env.local` แล้วในวันที่ 18 ตุลาคม 2026 และ `check-db` ผ่าน ไม่ได้บันทึกประวัติลงตาราง migration ของ Supabase CLI; การรันซ้ำไม่มีผลเสีย

### สถานะหลังนำขึ้นจริง

- โค้ดแก้ไข commit `c0ab12c` ขึ้น `main` และ Vercel Production สำเร็จที่ `https://hubchat-omega.vercel.app` วันที่ 18 ตุลาคม 2026
- ตรวจ HTTP หลัง deploy: inbox, comments, orders, orders/tracking, dashboard, settings, API รายการแชท/คอมเมนต์, health, privacy และ terms ได้ 200
- webhook ว่างที่ลงลายเซ็นถูกต้องได้ 200 และคิวหมายเลข 87 เป็น `done` ใน attempt 1 ไม่มี error; ลายเซ็นผิดถูกปฏิเสธ 403 ไม่มีข้อความทดสอบส่งไปหาลูกค้า
- Instagram เชื่อมกับ Facebook Page ถูกบัญชี แต่ `subscribed_apps` เดิมว่าง จึงเรียก `subscribeInstagramPageWebhooks` ของโปรเจกต์สำเร็จ และอ่านยืนยันว่ามี subscription ของ messages, messaging_postbacks, messaging_seen, message_reactions, messaging_referral, messaging_optins และ comments แล้ว
- ยังรอทดสอบ DM/คอมเมนต์จากบัญชีจริง และเข้าตรวจ App Mode/สิทธิ์ใน Meta for Developers จึงยังไม่ระบุว่าการรับจากผู้ใช้ทั่วไปผ่าน end-to-end

### ผลทดสอบจากบัญชีจริงเพิ่มเติม

ผู้ใช้ยืนยันว่าส่งแชทและคอมเมนต์ด้วย Facebook ชื่อ Papleng Pimlaphat ไปยัง Blisse Thailand แล้ว:

- Conversations API พบแชทขาเข้าของบัญชีนี้เวลา 22:25:57 น. (Asia/Bangkok) วันที่ 18 ตุลาคม 2026 แต่คิว webhook ไม่มีรายการใหม่หลัง diagnostic #87
- Vercel Request Logs ช่วง 22:05–22:35 พบ `/api/webhooks/meta` เพียงสองรายการเวลา 22:23:24 (200) และ 22:23:27 (403) ซึ่งเป็นการทดสอบลายเซ็นถูก/ผิดของเราเอง ไม่มีคำขอในช่วงข้อความจริง จึงยังไม่ใช่ปัญหาที่ worker หรือหน้าจอซ่อนข้อมูล
- เรียก `subscribeFacebookPageWebhooks` ซ้ำสำเร็จและอ่านยืนยัน HubChat app พร้อม fields messages และ feed แล้ว ต้องทดสอบเหตุการณ์ใหม่หลังการเชื่อมซ้ำและตรวจ App Mode/Advanced Access ใน Meta
- นำเข้าประวัติหน้าแรกด้วย `backfillPageConversations` เพื่อกู้ข้อมูลที่ตกหล่น: 3 ห้อง, 26 ข้อความใหม่, 2 ซ้ำ, ไม่ข้ามรายการ แชท Papleng เวลา 22:25:57 อยู่ใน HubChat แล้ว การนำเข้าครั้งนี้ไม่ส่งข้อความออก
- Comments API พบคอมเมนต์ใหม่เวลา 22:26:44 น. แต่ไม่ส่ง `from.id` หรือ `from.name` จึงยังยืนยันผู้เขียนจาก API ไม่ได้ นำเข้าคอมเมนต์นี้โดยคงผู้เขียนว่าง ไม่เดาว่าเป็น Papleng; เรียกบันทึกซ้ำแล้วได้ `duplicate: true` และ row id เดิม ไม่มีการเรียกบอทตอบย้อนหลัง
- ยังติดการเข้าสู่ระบบ Meta for Developers ในเบราว์เซอร์ของงานนี้ เพื่อดูข้อจำกัดการส่ง webhook ฝั่ง Meta; ห้ามสรุปว่า real-time ผ่านแล้วจากผลนำเข้าประวัติ

## การทดสอบฐานข้อมูลแบบแยกจาก production

ใช้ PostgreSQL เฉพาะทดสอบที่ user มีสิทธิ์สร้าง/ลบฐานข้อมูล ชุดทดสอบจะสร้างใหม่และลบฐานข้อมูลชื่อ `hubchat_pgtest` ทุกชุด ห้ามชี้ไป production

ตัวอย่างเมื่อมี Docker:

```bash
docker run --name hubchat-pg-test -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55432:5432 -d postgres:18
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGPASSWORD=postgres npm run test:pg
docker stop hubchat-pg-test
```

ผลตรวจรอบนี้: unit/API 664 ผ่าน, PostgreSQL 293 ผ่านและไม่ skip, typecheck/build ผ่าน, lint ไม่มี error และมีคำเตือนเดิม 50 รายการ การทดสอบส่งข้อความใช้ Meta transport จำลอง ไม่ส่งหาลูกค้าจริง

## ขอบเขตของหลักฐาน

- token ที่ตั้งไว้ตรวจ identity ได้ และ production รับ webhook ว่างที่เซ็นลายเซ็นถูกต้องเข้าคิวจนเป็น done ได้
- ผลดังกล่าวยืนยันฝั่ง endpoint/คิว แต่ยังไม่ยืนยันว่า Meta ส่งเหตุการณ์จากผู้ใช้จริง ต้องทดสอบจากบัญชีจริงหลัง deploy
- การสมัคร webhook, App Mode, สิทธิ์ Advanced Access และการเปิดรับข้อความของ Instagram ต้องตรวจใน Meta for Developers
- Vercel cron ปัจจุบันรันกู้คิววันละครั้ง การรับปกติใช้ `after()` ของ webhook ถ้าต้องการกู้คิวถี่กว่านี้ต้องรัน `npm run worker` ต่อเนื่องหรือมี scheduler ที่รองรับ
- การแก้นี้เน้นทางรับแชท/คอมเมนต์และกันตอบซ้ำ ไม่ใช่การรับรองว่าทุกฟีเจอร์และทุก integration ผ่าน end-to-end แล้ว
