# ชุดเตรียม App Review — HubChat

อัปเดต 21 ตุลาคม 2026 — เป็นร่างสำหรับตรวจและใช้กรอก ยังไม่ได้ส่ง App Review

## สถานะและขอบเขต

- Business Verification แสดง **ตรวจสอบยืนยันแล้ว** (วันที่ใน Meta: 20 ตุลาคม 2026)
- App Review ยังไม่ได้ส่ง แต่หน้า Developer แสดงแอปเผยแพร่แล้ว; การเผยแพร่ไม่ยืนยันว่า Advanced Access ผ่าน
- เพิ่มแพลตฟอร์ม Website และ URL ของระบบจริงแล้วในวันที่ 21 ตุลาคม เพื่อแก้ตัวกั้นขั้นคำแนะนำผู้ตรวจสอบ
- เปิดแบบฟอร์ม submission `1763008511508176` ได้แล้ว มีหัวข้อการตรวจสอบยืนยัน, การตั้งค่าแอพ, การใช้งานที่อนุญาต, การจัดการข้อมูล และคำแนะนำของผู้ตรวจสอบ; ปุ่มส่งยังปิดใช้งาน ไม่ได้กรอกคำรับรองแทนเจ้าของ
- HubChat ปัจจุบันเป็นเครื่องมือภายในของ Blisse Thailand สำหรับเพจ/บัญชีที่เจ้าของตั้งค่าเอง ไม่พบขั้นตอน OAuth ให้ร้านค้าอื่นเชื่อมบัญชีด้วยตนเองในโค้ด
- หน้าเชื่อมเพจใช้ Page/Instagram ID และ token ที่แอดมินตั้งค่าฝั่งเซิร์ฟเวอร์ อย่าอ้างในคลิปว่ามีปุ่ม Facebook Login สำหรับ onboarding หากยังไม่มี
- ผลทดสอบจำลองและ webhook ตัวอย่างไม่แทนคลิปข้อความ/คอมเมนต์จากบัญชีทดสอบจริง

### บันทึกแบบร่างใน Meta วันที่ 21 ตุลาคม (รอบกรอกข้อมูล)

- บันทึกคำแนะนำทดสอบเว็บและ URL `/login` แล้ว ระบุชัดว่า staff ใช้บัญชี HubChat ไม่ใช่ Facebook Login; ยังไม่ได้ส่ง credential ให้ Meta
- เจ้าของยืนยันว่าไม่เคยให้ข้อมูลผู้ใช้แก่หน่วยงานรัฐตามคำขอด้านความมั่นคงแห่งชาติใน 12 เดือนที่ผ่านมา จึงเลือก “ไม่ได้ให้”; เจ้าของแจ้งว่าไม่เคยจัดทำขั้นตอนดังกล่าว จึงเลือก “ไม่ใช่ทุกข้อที่กล่าวมา” ไม่อ้างว่ามีนโยบายเฉพาะที่ใช้งานอยู่
- บันทึกคำอธิบายการใช้งานจริง 10 รายการ: `pages_messaging`, `instagram_manage_comments`, `pages_read_user_content`, `pages_manage_engagement`, `pages_manage_metadata`, `instagram_manage_messages`, `pages_read_engagement`, `instagram_basic`, Business Asset User Profile Access และ `pages_show_list`
- Messenger เลือกเพจ Blisse Thailand และใส่ขั้นตอนทดสอบรับข้อความ → Inbox → ตอบหนึ่งครั้ง → ตรวจฝั่ง Messenger; เปิดแบบฟอร์มซ้ำยืนยันข้อความและเพจยังอยู่
- Meta แสดง API test completed สำหรับ `pages_messaging`, `instagram_manage_comments`, `pages_read_user_content`, `pages_manage_engagement`, `pages_manage_metadata`, `pages_read_engagement`, `instagram_basic` ที่เปิดตรวจ ข้อนี้ไม่ใช่ผลผ่าน App Review หรือหลักฐาน end-to-end จากลูกค้าทั่วไป
- พบ dependency ในแบบฟอร์มจริง: `pages_show_list` จำเป็นร่วมกับสิทธิ์อ่าน/จัดการคอมเมนต์ อ่านโพสต์ และสมัคร webhook จึงคงไว้และอธิบายตรง ๆ ว่าแอปยังไม่มี `/me/accounts` onboarding
- ยังไม่ได้ติ๊กข้อตกลงการใช้งานรายสิทธิ์ อัปโหลดคลิป หรือกดส่งคำขอ; การกดบันทึกคำอธิบายทำได้โดยไม่ต้องรับรองว่าหลักฐานครบ
- ตรวจสินทรัพย์ใน HubChat พบเพียง Blisse Thailand สองช่องทาง (Facebook 35 บทสนทนา/74 คอมเมนต์, Instagram 2 บทสนทนา/1 คอมเมนต์ ณ เวลาตรวจ) จึงยังไม่มีสินทรัพย์ทดสอบแยกที่ยืนยันว่าปลอดข้อมูลลูกค้าจริง การเลือกเพจในฟอร์ม Messenger ไม่ใช่การเปิดประวัติ HubChat ให้ผู้ตรวจ
- แบบจัดการข้อมูลยังต้องระบุผู้ประมวลผลพร้อมประเทศที่ประมวลผลจริง ไม่ใช้ประเทศสำนักงานใหญ่แทนประเทศประมวลผล และไม่เดาประเทศจากชื่อผู้ให้บริการ
- เจ้าของอนุญาตอย่างชัดเจนให้ผู้ตรวจ Meta เข้าถึงประวัติแชท คอมเมนต์ และออเดอร์ของ Blisse Thailand ทั้ง Facebook และ Instagram แล้ว สร้างบัญชี `meta-review@blisseglobal.com` ชื่อ Meta App Review ระดับ admin ให้เฉพาะสองสินทรัพย์นี้ ไม่ให้ owner หรือสิทธิ์จัดการ token
- บัญชีถูกสร้างและ UI ยืนยันสิทธิ์ทั้งสองช่องทาง แต่หน้าต่างรหัสชั่วคราวไม่ได้คงอยู่ จึงยังไม่ได้ส่ง password ให้ Meta หรือทดสอบ login บัญชีนี้ ต้องให้เจ้าของตั้ง credential ตามขั้นตอนส่งมอบของเครื่องมือเบราว์เซอร์ ไม่ใส่รหัสผ่านใน Git หรือแชท

## รายการคำขอปัจจุบันที่พบใน Meta

หน้าร่างคำขอวันที่ 20 ต.ค. มี 20 รายการ:

`Human Agent`, `Business Asset User Profile Access`, `instagram_business_basic`,
`instagram_business_manage_messages`, `instagram_business_content_publish`,
`instagram_business_manage_insights`, `instagram_business_manage_comments`,
`instagram_manage_comments`, `instagram_manage_engagement`, `pages_read_user_content`,
`pages_manage_engagement`, `pages_show_list`, `pages_manage_metadata`,
`pages_utility_messaging`, `pages_messaging`, `business_management`,
`instagram_manage_messages`, `pages_read_engagement`, `public_profile`, `instagram_basic`.

**ยังไม่ได้ถอนหรือเปลี่ยนสิทธิ์ใน Meta** เพราะหน้าจอระบุว่าปุ่มถอนลบสิทธิ์ออกจากแอปด้วย ไม่ใช่แค่จากคำขอตรวจ

## จับคู่กับการใช้งานที่มีในโค้ด

ตารางนี้เป็นรายการเตรียมหลักฐานจากโค้ด ไม่ใช่การรับรองสิทธิ์จาก Meta:

| สิทธิ์/ฟีเจอร์ | สิ่งที่ต้องอธิบายและสาธิต | หลักฐานในโค้ด |
|---|---|---|
| `pages_messaging` | รับ Messenger เข้า Inbox และแอดมินตอบกลับบัญชีทดสอบ | `src/server/messaging/`, `src/server/ingest/` |
| `pages_manage_metadata` | สมัคร webhook ของเพจที่แอดมินมีสิทธิ์ | `src/server/meta/facebook-comments.ts` |
| `pages_read_engagement`, `pages_read_user_content` | อ่านโพสต์/คอมเมนต์มาแสดงใน Comments | `fetchFacebookRecentComments` |
| `pages_manage_engagement` | ตอบ/ซ่อนคอมเมนต์บนเพจของธุรกิจ | `src/server/meta/facebook-comments.ts` |
| `instagram_basic` | อ่านข้อมูลบัญชีและสื่อของ Instagram ที่เชื่อมกับเพจ | `page-check.ts`, `instagram-comments.ts` |
| `instagram_manage_messages` | รับ/ตอบ DM และ private reply จากคอมเมนต์ตาม policy | `src/server/messaging/`, `sendInstagramPrivateReply` |
| `instagram_manage_comments` | อ่าน/ตอบ/ซ่อนคอมเมนต์ Instagram | `src/server/meta/instagram-comments.ts` |
| Business Asset User Profile Access | ชื่อ/รูปที่ API อนุญาต เพื่อแยกผู้สนทนาใน Inbox | `src/server/meta/profile.ts` |
| `business_management` | มี adapter สำหรับย้ายบทสนทนาไปสแปม แต่ต้องตรวจข้อกำหนด endpoint และสิทธิ์จริงก่อนอ้างว่าจำเป็น | `src/server/meta/moderation.ts` |
| `instagram_manage_engagement` | มี adapter ไลก์/เลิกไลก์ ต้องตรวจข้อกำหนด Graph version และสาธิตจริงก่อนรวมในคำขอ | `likeInstagramComment`, `unlikeInstagramComment` |

สิ่งที่ควรพักจากการยื่นหลักจนมีหลักฐาน:

- `instagram_business_*`: เป็นชุดชื่อสิทธิ์อีกเส้นทางหนึ่ง ร่างปัจจุบันปนกับ `instagram_*`; โค้ดที่ตรวจใช้ Graph client กับบัญชีที่เชื่อมเพจ ไม่พบ onboarding ผ่าน Instagram Login จึงไม่ควรอ้างว่าใช้ทั้งสองเส้นทางโดยไม่มีหลักฐาน
- `instagram_business_content_publish`, `instagram_business_manage_insights`: ไม่พบ flow เผยแพร่โพสต์หรืออ่าน Instagram Insights สำหรับสาธิต Dashboard ของ HubChat ใช้ข้อมูลภายใน ไม่ใช่หลักฐานการใช้ Instagram Insights
- `public_profile`: ไม่พบ flow OAuth ใน UI ปัจจุบัน; ส่วน `pages_show_list` เป็น dependency ที่ Meta ระบุในแบบฟอร์ม ต้องคงไว้ระหว่างตรวจความจำเป็น ไม่อ้างว่ารายการเพจจากฐานข้อมูลเป็นการเรียก `/me/accounts`
- `pages_utility_messaging`: ต้องมีเทมเพลตจริงที่อนุมัติและเส้นทางส่งที่เปิดใช้งาน ไม่ใช้ตัวอย่าง STANDARD message แทน
- Human Agent: ใช้เฉพาะมนุษย์ตอบตามเงื่อนไขที่อนุมัติ ต้องมีหลักฐานการใช้งานจริงก่อนเปิด ไม่ใช้เพื่อบอทหรือขยายเวลาขายอัตโนมัติ

## คำอธิบายแอปภาษาอังกฤษ

> HubChat is an internal customer service and order management application used by authorized staff of Blisse Thailand. It consolidates messages and comments from the business's connected Facebook Page and Instagram professional account. Staff use the inbox to respond to customer inquiries, manage comments, and record order and delivery details provided by customers. Messaging requests are checked by a channel-specific policy engine. The current deployment uses administrator-configured business assets and server-side tokens; it does not offer self-service onboarding for unrelated businesses.

## ร่างคำอธิบายรายฟังก์ชัน

ใช้เฉพาะส่วนที่มีคลิปจริงประกอบ ปรับชื่อสิทธิ์ตาม flow ที่ Meta เปิดให้แอป:

**Messenger**

> We use this permission to receive customer-initiated messages sent to our business Page and allow authorized staff to reply from HubChat's Inbox. Message content and permitted profile information are displayed only to staff with access to the connected Page. Please follow the Messenger demonstration: send a unique test message to the Page, locate it in HubChat, reply as a staff member, and verify the reply in the customer's Messenger conversation.

**Page webhook subscriptions**

> We use this permission to subscribe our authorized business Page to the webhook fields needed for incoming messages and comments. The webhook receiver verifies Meta's request signature before queueing events for processing. The demonstration shows the connected Page and a new event arriving in HubChat. Access tokens and application secrets are not shown in the recording.

**Facebook comments**

> We read comments on our business Page's posts to display them in HubChat's Comments workspace. Authorized staff can reply to and moderate these comments. The demonstration shows a test comment on a business-owned test post, the same comment in HubChat, one public reply, and the resulting reply on Facebook. The application records send attempts to prevent duplicate replies.

**Instagram**

> We use the connected Instagram professional account to handle customer-initiated direct messages and comments on the business's own media. Authorized staff can read and reply from HubChat. Separate demonstrations show a direct message and a comment, including the result visible to the test customer. Private replies are subject to the application's policy checks and are not used to contact arbitrary users.

**Permitted customer profile information**

> We display the customer name and profile image returned by Meta, where available, so authorized staff can identify the conversation they are handling. Missing profile fields are not inferred. Profile information is associated with the relevant customer service conversation and is not sold.

## บัญชีและทางเข้าให้ผู้ตรวจ

- URL: `https://hubchat-omega.vercel.app/login`
- หน้าใช้งาน: `/inbox`, `/comments`
- หน้าเจ้าของตั้งค่าเพจ: `/settings/pages` — ไม่ให้ผู้ตรวจใช้บัญชีเจ้าของจริงหรือเห็น token
- ต้องเตรียมบัญชีตรวจเฉพาะที่มีสิทธิ์เฉพาะสินทรัพย์ทดสอบ และตรวจว่าเข้าสู่ระบบได้จริงก่อนส่ง
- ใส่ credential เฉพาะช่องปลอดภัยของ Meta เมื่อพร้อม ไม่เก็บใน Git/คู่มือ/วิดีโอ
- อย่าใส่บัญชีปลอมหรือรหัส placeholder แล้วส่งตรวจ
- หน้าข้อมูลสาธารณะ: `/privacy`, `/terms`
- Data deletion callback: `/api/webhooks/meta/data-deletion` (มี alias `/api/meta/data-deletion`)

## สคริปต์คลิปและเกณฑ์ผ่าน

### คลิป A — Messenger

1. เปิดเพจทดสอบและ HubChat โดยเห็นชื่อสินทรัพย์ตรงกัน
2. ใช้บัญชีทดสอบที่มีสิทธิ์กับแอป ส่งข้อความ `REVIEW-FB-<วันเวลา>`
3. เปิด Inbox เห็นข้อความเดียวกัน พร้อมเวลารับและชื่อเพจ
4. แอดมินตอบหนึ่งครั้ง แล้วแสดงข้อความนั้นฝั่ง Messenger
5. รีเฟรช HubChat ยืนยันข้อความไม่เพิ่มซ้ำ

### คลิป B — คอมเมนต์ Facebook

1. ใช้โพสต์ทดสอบของธุรกิจและบัญชีทดสอบที่ได้รับอนุญาต
2. คอมเมนต์ `REVIEW-COMMENT-<วันเวลา>`
3. เปิด Comments ค้นหารายการ เปิดรายละเอียดและแสดงโพสต์ต้นทาง
4. ตอบสาธารณะหนึ่งครั้ง แล้วแสดงคำตอบหนึ่งรายการใน Facebook
5. หากสาธิตบอท ให้ใช้กฎทดสอบกับโพสต์นี้โดยเฉพาะ ไม่เปิดตอบย้อนหลังทั้งเพจ
6. การซ่อน/คืนคอมเมนต์สาธิตเฉพาะคอมเมนต์ทดสอบ ไม่ลบคอมเมนต์ลูกค้า

### คลิป C — Instagram

ทำ DM และคอมเมนต์ซ้ำตาม A/B บนบัญชี Instagram Professional ที่เชื่อมจริง
อย่าใช้คลิป Facebook แทน Instagram และอย่าใช้ webhook sample แทนเหตุการณ์จริง

### บันทึกหลักฐานแต่ละเคส

| เคส | เวลาส่ง/เขตเวลา | Event/queue ID | ข้อมูลเข้า Inbox/Comments | ผลตอบฝั่งลูกค้า | จำนวนตอบ | ผล |
|---|---|---|---|---|---|---|
| FB DM | ยังไม่ทดสอบรอบยื่น | — | — | — | — | รอหลักฐานจริง |
| FB comment | ยังไม่ทดสอบรอบยื่น | — | — | — | — | รอหลักฐานจริง |
| IG DM | ยังไม่ทดสอบรอบยื่น | — | — | — | — | รอหลักฐานจริง |
| IG comment | ยังไม่ทดสอบรอบยื่น | — | — | — | — | รอหลักฐานจริง |

## ก่อนกดส่ง

- [ ] เลือก scope ที่ใช้งานจริงและมีหลักฐาน แก้รายการที่ปน onboarding คนละแบบ
- [ ] เปิด deployment ที่มี Privacy ตรงกับข้อมูลที่เก็บและผู้ประมวลผลจริง
- [ ] บัญชีตรวจแยกเข้าสู่ระบบได้และไม่เห็นข้อมูลลูกค้าจริง
- [ ] คลิปจริงของแต่ละช่องทางครบ ไม่เปิด secrets และไม่อ้างผลจำลองเป็นผลจริง
- [ ] ตรวจคำตอบเรื่องผู้ประมวลผลข้อมูลให้ครอบคลุม Supabase, Vercel และ Telegram/Web Push/Gemini เมื่อใช้
- [ ] เจ้าของตรวจคำรับรองและขอบเขตสิทธิ์ก่อนส่ง

## แหล่งอ้างอิงสำหรับตรวจซ้ำก่อนยื่น

- หน้าคำขอจริง: https://developers.facebook.com/apps/1762855681523459/app-review/
- แนวทางตรวจแอปจากลิงก์ใน dashboard: https://developers.facebook.com/docs/resp-plat-initiatives/appreview/
- หลักฐานระบบ/งานค้าง: [WORK_STATUS_TH.md](WORK_STATUS_TH.md)
- การดูแลคิวและคำขอลบข้อมูล: [RUNTIME_OPERATIONS_TH.md](RUNTIME_OPERATIONS_TH.md)
