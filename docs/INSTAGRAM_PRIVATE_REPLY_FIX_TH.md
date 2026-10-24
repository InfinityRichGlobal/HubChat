# แก้เส้นทาง Instagram Private Reply — 24 ตุลาคม 2026

HubChat ใช้ Facebook Page Access Token บน `graph.facebook.com` และเก็บ Instagram account ID ใน `pages.page_id` สำหรับรับ webhook และจัดการคอมเมนต์

เอกสาร Meta ของ Messenger API for Instagram ระบุให้ส่ง Private Reply ผ่าน `/{FACEBOOK_PAGE_ID}/messages` พร้อม `recipient.comment_id` แต่ adapter เดิมนำ Instagram account ID มาใช้เป็นผู้ส่ง

อ้างอิง: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies (อ่านจากเอกสาร Meta โดยตรง วันที่ 24 ตุลาคม 2026)

## พฤติกรรมหลังแก้

- อ่าน `me?fields=id,instagram_business_account` ด้วย token เดิม และตรวจบัญชี IG ให้ตรงกับรายการที่กำลังส่ง
- ส่งผ่าน Facebook Page ID ที่ตรวจได้ โดยไม่เปลี่ยน ID ที่ใช้รับ webhook และจัดการ public comment
- ถ้าตรวจตัวตนไม่ได้ จะไม่ส่งข้อความและคืนสิทธิ์จอง เพราะยังไม่ได้เรียก Send API
- ถ้าส่งแล้วไม่ทราบผล จะไม่ลอง endpoint อื่นและไม่เปิดให้ส่งซ้ำ ตามระบบป้องกันข้อความซ้ำเดิม
- การเปิดอ่านหรือทำเครื่องหมายอ่านแล้วไม่ล้าง `last_error_th` และไม่นำรายการที่ยังส่งไม่สำเร็จออกจาก “ต้องตรวจสอบ”

## การตรวจสอบ

ทดสอบการเลือก Page ID, บัญชีเชื่อมไม่ตรง, lookup ล้มเหลว, การไม่ fallback หลังส่งแล้วไม่ทราบผล และการเก็บข้อผิดพลาดหลังอ่านคอมเมนต์

ตรวจแบบอ่านอย่างเดียวกับ token จริงแล้ว ยืนยันว่าการหาเพจ Facebook ที่เชื่อมกับ Instagram ทำงานสำเร็จ

Commit `62bb33c` ขึ้น production สำเร็จ 24 ตุลาคม 2026 เวลา 21:32:49 น. ไทย ผ่าน typecheck, 703 unit/architecture tests ใน 38 files, lint และ build; check-db ผ่าน 40 ตาราง

## Log ทดสอบจริงหลัง deploy

เวลาทั้งหมดเป็นเวลาไทย วันที่ 24 ตุลาคม 2026 บันทึกเฉพาะผลเทคนิค ไม่เก็บชื่อ/ID ลูกค้า รหัสผ่าน หรือ token ในเอกสารนี้

| รอบ | ผล Meta | ข้อสรุปที่ยืนยันได้ |
|---|---|---|
| ก่อนแก้ endpoint | `200 / 2534066`, trace `AET_FkV6dJvFnaTHnzZlceX` | ไม่สำเร็จ ไม่ใช่หลักฐานว่าแค่รอสิทธิ์แล้วโค้ดเดิมถูกต้อง |
| หลัง `62bb33c` ประมาณ 21:39 น. | `-1 / 2534023`, trace `A9KNVUrquzHgFLvqdr37ITB` | ยังไม่สำเร็จ; `replied_private=false`, text/time ว่าง และไม่มี success activity log |
| อ่าน conversation ของลูกค้ารายเดิมแบบ read-only | HTTP 403, `200 / 2534048`, trace `AwWOl-u01MUTErhdAkPjTFz` | Meta ระบุชัดว่าไม่มี Advanced Access ของ `instagram_manage_messages` และผู้รับไม่มีบทบาทบนแอป |

Meta Business Suite มีบทสนทนาที่แอดมินคุยกับลูกค้ารายนี้ก่อนทดสอบ จึงไม่ใช่เคสสะอาดสำหรับ private reply ครั้งแรก ยังไม่ยืนยันความหมายของ `2534023` จากเอกสารทางการ จึงไม่สรุปจาก subcode เพียงอย่างเดียว และไม่นับข้อความที่ส่งจาก Business Suite เป็นผลสำเร็จของ HubChat

ผู้ใช้ให้สิทธิ์ทดสอบส่งถึงลูกค้าจริงสองครั้งแยกกัน ใช้แล้วทั้งสองครั้ง รอบจัดเอกสารไม่ได้ส่งเพิ่มเติม การตรวจครั้งใหม่ควรใช้บัญชี/คอมเมนต์ทดสอบใหม่ที่ยังไม่เคย private reply พร้อมอำนาจให้ส่งที่ครอบคลุมการทดสอบนั้น

## สิ่งที่การแก้นี้ยังไม่ครอบคลุม

- General DM ผ่าน `src/server/meta/client.ts::sendToMeta` ยังประกอบ `/{page.page_id}/messages` ต้องตรวจชนิด token และ ID สำหรับ Facebook Login แยกจาก private reply ก่อนสรุปว่า IG messaging แก้ครบ
- Scope อยู่ใน token ไม่เท่ากับ Advanced Access; App Published ไม่เท่ากับ App Review ผ่าน
- Runtime App ID คือ `1762855681523459` (HubChat); `2229730894588783` เป็น SuperiCez Studio คนละแอป
- ตรวจหน้า App Review ล่าสุด 24 ต.ค. ประมาณ 22:10 น. ยัง **อยู่ระหว่างการตรวจสอบ** ต้องยืนยันหลังสิทธิ์ผ่านด้วย DM/คอมเมนต์ใหม่จนเห็นผลฝั่งผู้รับ
- อ่านคอมเมนต์แล้วคง error เป็นพฤติกรรมที่ถูกต้อง ห้ามล้าง failure/ตั้ง success เพื่อทำให้ยอด “ต้องตรวจสอบ” เป็นศูนย์

แผนรับงานต่อและผลทดสอบรอบล่าสุด: [HANDOFF_ANTIGRAVITY_TH.md](HANDOFF_ANTIGRAVITY_TH.md), [WORK_STATUS_TH.md](WORK_STATUS_TH.md)
