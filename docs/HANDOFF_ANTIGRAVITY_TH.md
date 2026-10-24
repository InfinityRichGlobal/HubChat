# HubChat — ส่งต่องานให้ Antigravity

อัปเดต 24 ตุลาคม 2026 ประมาณ 23:12 น. เวลาไทย (UTC+7)

## 1. ข้อสรุปที่ต้องเข้าใจตรงกัน

HubChat มีโค้ดและระบบ production แล้ว แต่ยังไม่รับรองว่าการรับส่ง Facebook/Instagram กับลูกค้าทั่วไปผ่านครบวงจร โดยเฉพาะ Instagram DM และ Private Reply ที่ยังไม่มีหลักฐานส่งสำเร็จหลังแก้ล่าสุด General DM/Attachment routing แก้แล้วใน `0c77b53` และรอบตรวจต่อแก้ payload/cache/error เพิ่ม ต้องทดสอบจริงหลังสิทธิ์พร้อมก่อนรับรองการใช้งาน

- Repo: `https://github.com/InfinityRichGlobal/HubChat.git` / branch `main`
- Workspace: `/Users/ice/Documents/HubChat`
- Production: `https://hubchat-omega.vercel.app`
- ลำดับโค้ด: `62bb33c` แก้ Private Reply → `0c77b53` แก้ General DM/Attachment (Vercel success 23:00:43 น.) → รอบตรวจต่อแก้ upload platform, cache token rotation และ lookup errors ดู `git log` และ WORK_STATUS_TH.md
- ก่อนเริ่มทั้งรอบจัดเอกสารและตรวจ `0c77b53` working tree สะอาด และ `main` ตรง `origin/main`; แยก commit เอกสารกับ commit โค้ดเมื่ออ่านประวัติ
- Next.js 16.3.2, React 19.2.8, TypeScript 5, Tailwind 4, Supabase PostgreSQL/Storage, Vercel, Meta Graph v26.0
- ลำดับอ่าน: `AGENTS.md` → เอกสารนี้ → `WORK_STATUS_TH.md` → คู่มือเฉพาะส่วน

## 2. แยก Meta App ให้ถูกตัว

| รายการ | ตัวที่ใช้กับ HubChat |
|---|---|
| Meta App | **HubChat — `1762855681523459`** |
| Business | `112620037485313` |
| App Review submission | `1763008511508176` |
| Facebook Page | `1092394950630960` |
| Instagram account | `17841437051021247` |

อ่าน `runtime_settings.META_APP_ID` และ local env รอบนี้ได้ `1762855681523459` ตรงกัน ค่าใน runtime settings มีลำดับความสำคัญเหนือ env

แท็บที่เจ้าของเปิดตอนเริ่มงานเป็น **SuperiCez Studio — `2229730894588783`** หน้า API testing ของแอปนั้นแสดง Messenger/Page ทดสอบเสร็จ และ Instagram กำลังทดสอบ สถานะนี้ไม่ใช่ผล App Review ของ HubChat และไม่ใช่หลักฐานว่า production เปลี่ยนไปใช้แอปนั้น ห้ามสลับ App ID/token/webhook ข้ามแอปจากการเห็นแท็บนี้อย่างเดียว

ตรวจ [หน้า App Review ของ HubChat](https://developers.facebook.com/apps/1762855681523459/app-review/?business_id=112620037485313) รอบนี้พบ **“อยู่ระหว่างการตรวจสอบ”** โดยมี `instagram_manage_messages` ในคำขอ พร้อมสิทธิ์รวม 15 รายการ ดูรายการใน `META_APP_REVIEW_TH.md` ไม่ต้องเริ่มคำขอใหม่หรือยกเลิกคำขอเดิมเพื่อแก้สถานะเอกสาร

## 3. สถานะแต่ละส่วนของชิ้นงาน

| ส่วน | สิ่งที่มี/แก้แล้ว | หลักฐานและข้อจำกัด |
|---|---|---|
| เข้าสู่ระบบและสิทธิ์ | owner/admin/viewer, จำกัดเพจ, session/CSRF, บังคับเปลี่ยนรหัส, ออกจากหน้าบังคับเปลี่ยนรหัสได้เมื่อรหัสชั่วคราวหาย | มี regression tests; ไม่เก็บรหัสบัญชีตรวจใน Git |
| Inbox | แชท FB/IG, ค้นหา/กรอง, pagination, รูปแอดมิน, แท็ก/โน้ต/ข้อมูลลูกค้า, ล็อกกันตอบชน, ร่างข้อความแยกบัญชี/ห้องในแท็บเดิม | UI และข้อมูลจำลองตรวจแล้ว; ไม่เท่ากับ IG ลูกค้าจริงเข้าครบ; ใช้ polling ไม่ใช่ Supabase Realtime |
| Comments | กรองสถานะ, ก่อนหน้า/ถัดไป, เตือนร่างค้าง, ชื่อ/รูปผู้ตอบหรือบอท, แยก public/private/error | เปิดอ่านไม่ล้างข้อผิดพลาดแล้ว; มี guard กันส่งซ้ำ แต่ไม่อ้าง exactly-once |
| ลิงก์คอมเมนต์/แชท | เปิดโพสต์ต้นทาง/คอมเมนต์ FB, IG ใช้ media permalink, เปิดห้องลูกค้าจาก ID และเพจที่ตรงกัน | ไม่เดาจากชื่อ; กดเปิดแชทไม่ส่งข้อความ; ถ้ายังไม่มีห้องใน HubChat ไม่รับประกันว่าจะเปิดห้องได้; ไม่อ้างว่า IG กระโดดถึงคอมเมนต์รายอันได้เสมอ |
| IG Private Reply | แก้ endpoint ให้ใช้ Facebook Page ที่เชื่อมและตรวจ IG ตรงกันก่อน POST | deploy แล้ว แต่ทดสอบจริงครั้งล่าสุดยังไม่สำเร็จ; รายละเอียดในหัวข้อ 4 |
| DM ปกติและนโยบายส่ง | `sendMessage()` → policy → transport, claim/idempotency; IG General DM/Attachment ใช้ linked Page แล้ว พร้อมแก้ upload platform/cache/error | regression ตรวจ endpoint/payload/การเปลี่ยน token/timeout แล้ว ยังต้องยืนยันผลจริงหลังสิทธิ์พร้อม |
| Webhook/คิว | ตรวจลายเซ็น, กัน event ซ้ำ, แยกผลแต่ละ event, backoff/lease fencing, กู้คิวจาก scheduler | รอบนี้ pending/processing = 0, failed = 0; ล่าสุด #1796 done 22:02:18 น.; สถิติคิวไม่ยืนยันว่า event นั้นเป็น IG DM |
| Auto-reply/AI | กฎคีย์เวิร์ด, human handoff, บอทคอมเมนต์, Gemini/AI assist และหน้าตั้งค่า | ต้องคง policy/claim; ยังไม่ได้ทดสอบสดทุกกฎ/ทุกช่องทางในรอบเอกสารนี้; การนำเข้าคอมเมนต์เก่าไม่ควรกระตุ้นตอบอัตโนมัติ |
| ลูกค้า/ออเดอร์/สินค้า | ลูกค้าและโน้ต, สินค้า/โปรโมชัน, สร้างออเดอร์จากแชท, ผูกสลิป, COD/โอน, สถานะจัดส่ง | เส้นทางขายผ่าน PostgreSQL regression รอบก่อน; ไม่ใช่หลักฐานธุรกรรมเงินจริงหรือยืนยันสลิปกับธนาคาร |
| เลขพัสดุ | CSV → จับคู่ → ยืนยันลงเลข → เลือกแจ้งลูกค้า, กัน import/แจ้งซ้ำ | ไม่รองรับ `.xlsx` ตรง ๆ ให้แปลง CSV UTF-8; ลงเลขไม่ส่งข้อความเอง; การแจ้งขึ้นกับ policy/สิทธิ์ Meta |
| สื่อ/ไฟล์ | Supabase Storage bucket `media`, สำเนาสื่อ, คลังสื่อ/โฟลเดอร์/พรีวิว, รูปแอดมิน | ใช้ Supabase ไม่ใช่ R2; bucket เป็น public URL ผู้มีลิงก์เปิดได้ ต้องคงคำอธิบายนี้ใน Privacy |
| Dashboard/ส่งข้อความ/วินิจฉัย | สถิติยอดขายและงานภายใน, SLA, `/send-status`, heartbeat/คิว/เหตุผิดพลาดเป็นภาษาคน | ไม่ใช่ Instagram Insights; read/delivery/reaction webhook ยังถูกข้าม จึงไม่ใช่ตัวรับรองลูกค้าอ่านหรือได้รับทุกข้อความ |
| แจ้งเตือน/PWA | Telegram, Web Push, worker ทุก 5 นาที, ingest recovery ทุก 1 นาที | scheduler เปิดอยู่; heartbeat notifications 22:05:16 และ ingest 22:07:01 ไม่มี last error; ยังต้องยืนยันถึงอุปกรณ์จริง |
| Compliance | Privacy/Terms สาธารณะ, signed data deletion callback, หน้าตรวจคำขอ/ลบไฟล์และข้อมูลสัมพันธ์ | ทดสอบลบจริงเฉพาะ DB ทดสอบ; ไม่ทดสอบลบข้อมูลลูกค้าจริง; scope ภายนอกต้องตรวจตามคู่มือ |
| LINE/OAuth ร้านค้าอื่น | มีบางองค์ประกอบหน้าตา/ไอคอน แต่ไม่มี LINE messaging integration หรือ self-service OAuth onboarding ที่ยืนยันพร้อม | ไม่อยู่ในขอบเขตรับส่งที่เสร็จแล้ว ห้ามใช้ README เดิมที่อ้าง FB + IG + LINE เป็นหลักฐาน |

## 4. ปัญหา Instagram: แยกบั๊กโค้ดออกจากสิทธิ์และเคสทดสอบ

### สิ่งที่แก้และขึ้นระบบแล้ว

`62bb33c` เพิ่ม `src/server/meta/instagram-messaging-page.ts` เพื่ออ่าน `me?fields=id,instagram_business_account` ด้วย token เดิม ตรวจ linked IG ให้ตรง แล้วส่ง Private Reply ผ่าน `/{FACEBOOK_PAGE_ID}/messages` พร้อม `recipient.comment_id` โดยคง IG ID เดิมสำหรับ webhook/comment

หาก lookup ล้มเหลวก่อน POST คืน claim ได้; หาก POST แล้วผลไม่แน่นอน ห้าม fallback ไป endpoint อื่นหรือส่งซ้ำ อ่านเอกสารของ Facebook Login/Messenger API for Instagram อย่าปนกับ Instagram Login

แก้ `setHandled` และ UI ไม่ล้าง `last_error_th` เมื่ออ่านคอมเมนต์ด้วย การอ่านแล้วกับการส่งสำเร็จเป็นคนละสถานะ

### หลักฐานจริง 24 ตุลาคม

- ก่อนแก้ endpoint: Private Reply ไม่สำเร็จ `200 / 2534066`
- หลัง deploy: ผู้ใช้อนุญาตอีกหนึ่งครั้ง ผลยังไม่สำเร็จ `-1 / 2534023` ประมาณ 21:39 น. ไทย; `replied_private=false`, ไม่มี private reply text/time และไม่มี success activity log จากการทดสอบนั้น
- ตรวจ Meta Business Suite พบว่าแอดมินเคยคุยกับลูกค้ารายนี้แล้วก่อนการทดสอบ จึงไม่ใช่เคสสะอาดสำหรับการทักครั้งแรก ห้ามตีความว่าข้อความใน Business Suite เป็นข้อความที่ HubChat ส่งสำเร็จ และยังไม่ฟันธงความหมายของ subcode จากเลขอย่างเดียว
- การอ่าน conversation ของลูกค้าทั่วไปตอบ **HTTP 403, code 200, subcode 2534048** พร้อมข้อความ Meta ชัดเจนว่าแอปไม่มี Advanced Access ของ `instagram_manage_messages` และผู้รับไม่มีบทบาทบนแอป นี่คือหลักฐานข้อจำกัดสิทธิ์
- Token มีชื่อ scope และยังใช้อ่านตัวตนได้ ไม่ได้แปลว่า Advanced Access ผ่านแล้ว
- รูปตั้งค่าที่เจ้าของส่งแสดง Allow access to messages เปิดแล้ว; ไม่ควรให้เปลี่ยน Creator/Business หรือเปิดสวิตช์เดิมซ้ำโดยไม่มีหลักฐานปัญหาใหม่
- สิทธิ์ให้ลองส่งถึงลูกค้าจริงสองครั้งก่อนหน้าใช้แล้วทั้งสองครั้ง รอบจัดเอกสารนี้ไม่ได้ส่งใหม่ ห้ามนำการอนุญาตเดิมมาใช้ส่งครั้งที่สาม

ดู log เทคนิค/code paths เพิ่มใน `INSTAGRAM_PRIVATE_REPLY_FIX_TH.md` โดยไม่บันทึก token/รหัสผ่าน/เนื้อหาประวัติลูกค้าใน repo

## 5. การทดสอบและสิ่งที่ผลทดสอบรับรอง

| การตรวจ | หลักฐานล่าสุด |
|---|---|
| TypeScript | รันซ้ำ 24 ต.ค. รอบแก้ upload/cache/lookup ผ่าน |
| Unit/architecture | รันซ้ำ ผ่าน **715 tests / 39 files** |
| ESLint | รันซ้ำ ผ่าน ไม่มี error/warning |
| `check-db` ฐานจริง | รอบส่งต่องาน 22:10 น. ผ่าน **40 ตาราง**, คอลัมน์/RPC กันซ้ำ, scheduler, บัญชีเจ้าของ; รอบแก้ upload/cache ไม่มี migration |
| Production build | รันผ่านหลังแก้ upload/cache/lookup ต่อจาก `0c77b53` |
| PostgreSQL regression | หลักฐานรอบก่อน **318 tests / 19 files**; รอบนี้ไม่ได้รันซ้ำ เพราะ local port 55432 ไม่เปิด |
| Vercel | ยืนยัน `0c77b53` deployment completed/success เวลา 23:00:43 น.; commit แก้ต่อดูประวัติ Git/deployment ล่าสุด |
| ลูกค้า IG รับส่งครบวงจร | **ยังไม่ผ่านการยืนยัน**; ห้ามอนุมานจาก unit tests/build/คิวว่าง |

## 6. งานถัดไปเรียงลำดับ พร้อมเกณฑ์จบ

1. **ยืนยัน IG DM ปกติ/รูปหลังแก้:** การเลือก linked Page, upload platform, cache เมื่อเปลี่ยน token และแยก GET/POST failure มี regression แล้ว ห้ามย้อนใช้ IG ID บน Page-token endpoint หรือข้าม policy การผ่าน tests ไม่ปิดงานทดสอบ conversations/backfill และผู้รับจริง
2. **ติดตามคำขอ HubChat ตัวเดิม:** ต้องเห็น Advanced Access รายสิทธิ์จริง ไม่ใช้ Published/API test completed แทน ถ้าถูกปฏิเสธให้ใช้เหตุผลจริงแก้เฉพาะจุด ไม่ยกเลิก/ยื่นใหม่ขณะยัง pending โดยไม่จำเป็น
3. **หลังสิทธิ์พร้อม ทดสอบด้วยบัญชีทดสอบที่ไม่มีบทบาทในแอป:** DM ใหม่และคอมเมนต์ใหม่ที่ยังไม่เคย private reply; ตาม timestamp + event/message ID → webhook → queue → DB → UI → ส่งครั้งเดียว → ตรวจฝั่งผู้รับ ทั้ง Facebook และ Instagram
4. **ตรวจ recovery:** เหตุการณ์ซ้ำไม่ตอบซ้ำ, ผลไม่แน่นอนไม่ retry, เปิดอ่านไม่ล้าง error, ข้อมูลจากคน/เพจอื่นไม่ปน แล้วบันทึกผลผ่าน/ไม่ผ่านจริง
5. **ตรวจอุปกรณ์และงานขาย:** ยืนยัน Telegram/Push ถึงอุปกรณ์, ทดลอง flow ออเดอร์/สลิป/เลขพัสดุด้วยข้อมูลทดสอบ; ไม่ถือว่าการตอบ HTTP 200 แปลว่ามือถือเห็นแจ้งเตือนแล้ว
6. **ปิดงานด้วยหลักฐาน:** อัปเดต `WORK_STATUS_TH.md` และ incident log ระบุ commit, เวลาไทย, command/results และข้อจำกัดที่ยังเหลือ จึงค่อยรับรองแต่ละฟังก์ชันตามผลจริง

## 7. กติกาทำงานต่อและตำแหน่งไฟล์

- อ่าน `AGENTS.md` และ `git status -sb` ก่อนแก้ทุกครั้ง; หากมีงานค้างจากอีก Agent ต้องรักษาไว้ ใช้ `git pull --ff-only` เมื่อ working tree พร้อม ห้าม reset/force push ทับงาน
- อ่านคู่มือ Next ที่ `node_modules/next/dist/docs/` ก่อนแก้ code; ใช้ `src/proxy.ts`, await dynamic APIs ตาม AGENTS
- ทุกการส่งต้องผ่าน policy/claim ที่ออกแบบไว้; private comments มี guard เฉพาะ ห้ามใช้ direct Graph POST เป็นทางลัดทดสอบ
- ห้ามเผยแพร่ `.env.local`, access token, app secret, session/encryption keys หรือรหัสบัญชีผู้ตรวจ
- หลังแก้รัน `npm run typecheck` และ `npm test`; เพิ่ม lint/build ตามงาน และ `test:pg` เมื่อแตะ DB/transaction/concurrency ใช้เฉพาะฐาน local `hubchat_*test`
- คำสั่ง/เส้นทางจริง: `/settings/autoreply`, `/orders/tracking`, `/settings/notifications`, `/settings/pages`, `/settings/data-deletion`, `/send-status`
- คู่มือ: `META_APP_REVIEW_TH.md`, `INSTAGRAM_PRIVATE_REPLY_FIX_TH.md`, `RUNTIME_OPERATIONS_TH.md`, `TRACKING_TH.md`, `STORAGE.md`, `NOTIFICATIONS.md`, `BACKFILL_TH.md`
- `DEFERRED_REVIEW.md` มีบันทึกเก่ารอบ 2–4 ให้ใช้ตารางสถานะปัจจุบันด้านบนก่อน ไม่เปิดงานที่แก้แล้วซ้ำจากข้อความประวัติ
