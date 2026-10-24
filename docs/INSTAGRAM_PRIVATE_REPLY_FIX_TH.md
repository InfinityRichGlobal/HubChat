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

## การแก้ General Instagram DM และ Upload Attachment (รอบปรับปรุงถัดมา)

- `src/server/meta/client.ts::sendToMeta` และ `uploadAttachmentToMeta`: ตรวจสอบหากเป็นเพจ Instagram (`page.platform === 'instagram'`) จะหา Facebook Page ID ที่เชื่อมต่อกับ Instagram ผ่าน `resolveInstagramMessagingPage(page, metaGet)` ก่อนส่ง
- เพิ่ม in-memory cache ใน `resolveInstagramMessagingPage` (อายุ 5 นาที) เพื่อไม่ให้มี network overhead ทำ GET `/me` ซ้ำทุกข้อความ
- หาก lookup ล้มเหลวหรือไม่ตรง จะหยุดส่งและคืนข้อผิดพลาดระดับ client โดยไม่เรียก Send API / Attachment API ป้องกันผลลัพธ์ไม่ทราบผล
- เพิ่มชุดทดสอบ `src/server/meta/__tests__/send-to-meta-instagram.test.ts` (4 tests) ยืนยันว่า Facebook ยังยิงตรงตามเดิม ส่วน Instagram ยิงผ่าน Facebook Page ID พร้อมยืนยันการแคชและการป้องกันตัวตนไม่ตรง

## สิ่งที่ยังต้องยืนยันหลังได้รับสิทธิ์จาก Meta

### ตรวจซ้ำ commit `0c77b53` และแก้ต่อ — 24 ต.ค. 23:12 น. ไทย

ยืนยัน `0c77b53` อยู่บน `main` และ Vercel deployment สำเร็จ 23:00:43 น. รัน typecheck และ tests เดิมผ่าน 707 ข้อ แต่ยังพบข้อผิดพลาดที่ tests เดิมไม่ครอบคลุม จึงยังไม่ควรรับรอง “พร้อม 100%”

1. **Attachment Upload ขาด `platform=instagram`:** เอกสาร [Meta Attachment Upload](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/attachment-upload) ระบุ field นี้สำหรับ Page endpoint ทั้งแบบ URL และไฟล์จาก server เพิ่มใน multipart เฉพาะ Instagram และตรวจ payload ใน regression test แล้ว
2. **Cache ใช้ผลตัวตนเก่าหลังเปลี่ยน token:** cache เดิมผูกเฉพาะ record ID/IG ID เพิ่ม fingerprint ของ encrypted credential เพื่อให้เปลี่ยน token แล้วต้องตรวจ linked Page ใหม่ก่อน POST ยังคง TTL 5 นาที และทดสอบหมดอายุ/บัญชีเชื่อมไม่ตรงด้วย
3. **Lookup failure ถูกทับเป็น permanent/400:** คืน HTTP/code/subcode/trace ของ Meta ตามจริง รักษา policy failure แบบห้าม retry และ transient failure แบบ retry ได้ เฉพาะ timeout ของ GET ตรวจตัวตนเป็น safely unsent ส่วน timeout หลัง POST ส่งข้อความยังเป็น ambiguous และห้ามส่งซ้ำตามเดิม

เพิ่ม 8 tests และเพิ่มข้อยืนยัน payload ใน test เดิม: ก่อนแก้มี 6 เคส fail ยืนยันว่าจับปัญหาได้จริง หลังแก้ชุดเฉพาะ Meta/comment ผ่าน 43 ข้อ ไม่ใช้ live customer send ในรอบนี้ ผลตรวจเต็มชุดดู WORK_STATUS_TH.md

### ข้อจำกัดที่ยังคงอยู่

- Scope อยู่ใน token ไม่เท่ากับ Advanced Access; App Published ไม่เท่ากับ App Review ผ่าน
- Runtime App ID คือ `1762855681523459` (HubChat); `2229730894588783` เป็น SuperiCez Studio คนละแอป
- ตรวจหน้า App Review ล่าสุด 24 ต.ค. ประมาณ 22:10 น. ยัง **อยู่ระหว่างการตรวจสอบ** ต้องยืนยันหลังสิทธิ์ผ่านด้วย DM/คอมเมนต์ใหม่จนเห็นผลฝั่งผู้รับ
- อ่านคอมเมนต์แล้วคง error เป็นพฤติกรรมที่ถูกต้อง ห้ามล้าง failure/ตั้ง success เพื่อทำให้ยอด “ต้องตรวจสอบ” เป็นศูนย์

แผนรับงานต่อและผลทดสอบรอบล่าสุด: [HANDOFF_ANTIGRAVITY_TH.md](HANDOFF_ANTIGRAVITY_TH.md), [WORK_STATUS_TH.md](WORK_STATUS_TH.md)
