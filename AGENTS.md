<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# HubChat — Agent & Multi-Tool Guide (Antigravity / Codex / Claude)

เอกสารนี้ใช้เป็นบริบทกลางสำหรับ AI Agents ทุกตัวที่ทำงานในโปรเจกต์ **HubChat** เพื่อให้เข้าใจโครงสร้าง ปลายทาง (Endpoints) และกฎเหล็กของระบบตรงกัน 100%

---

## 1. ภาพรวมระบบและ Tech Stack
- **Framework:** Next.js `16.3.2` (App Router), React `19`, TypeScript `5`, Tailwind CSS `v4`
- **Database:** Supabase PostgreSQL (check-db ตรวจ 40 ตาราง ณ 24 ต.ค. 2026 พร้อม RLS, RPC Functions และ Triggers)
- **File Storage:** Supabase Storage (Bucket ชื่อ `media` แบบ Public CDN สำหรับเก็บรูปแชท สลิปโอนเงิน และวิดีโอถาวร)
- **Hosting & Deployment:** Vercel (`.vercel/project.json` ผูกกับโปรเจกต์ `hubchat`)
- **Integrations:**
  - **Meta Graph API (`v26.0`):** Facebook Messenger, Instagram Direct, Facebook/Instagram Comments & Private Replies
  - **Notifications:** Telegram Bot API + Web Push (VAPID PWA)
  - *(หมายเหตุ: ระบบนี้ทำงานผ่าน Next.js API + Supabase โดยตรง ไม่ได้ใช้ Google Apps Script)*

---

## 2. ปลายทาง (Endpoints) และการตั้งค่าสภาพแวดล้อม
1. **Environment Variables (`.env.local`):**
   - ในเครื่อง Local มีไฟล์ `.env.local` ที่ตั้งค่าเชื่อมกับ Supabase, Meta, Telegram และกุญแจเข้ารหัสจริงไว้ครบแล้ว (ดูคำอธิบายแต่ละตัวแปรได้ที่ `.env.example`)
   - **ห้าม** commit ไฟล์ `.env.local` หรือแสดงค่า Secret (`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `META_APP_SECRET`, `VAPID_PRIVATE_KEY`) ออกมาในโค้ดหรือข้อความตอบกลับเด็ดขาด
2. **Git & GitHub:**
   - Remote: `https://github.com/InfinityRichGlobal/HubChat.git` (กิ่งหลัก: `main`)
3. **Production (Vercel):**
   - URL หลัก: `https://hubchat-omega.vercel.app`
   - Cron งานกู้คิว/แจ้งเตือนตั้งบน Supabase (`pg_cron` + `pg_net` + Vault) ตาม `docs/RUNTIME_OPERATIONS_TH.md`; `vercel.json` ไม่ตั้ง cron ซ้ำ
4. **Meta Webhook & Public Compliance Endpoints:**
   - Webhook รับข้อมูลแชท/คอมเมนต์: `/api/webhooks/meta`
   - Data Deletion Callback (Meta บังคับ): `/api/webhooks/meta/data-deletion` และหน้าตรวจสอบสถานะ `/api/compliance/data-deletion-status`
   - หน้าสาธารณะสำหรับ Meta App Review: `/privacy` และ `/terms`

---

## 3. โครงสร้างโฟลเดอร์สำคัญ
- `src/proxy.ts` — ตัวดักจับ Request ของ Next.js 16 (แทน `middleware.ts` เดิม) ดูแลเรื่อง Session Cookie, CSRF และเปิด Public Routes
- `src/app/(app)/` — หน้าจอฝั่งแอดมินทั้งหมด (ต้องล็อกอิน):
  - `inbox/` — หน้าแชทรวมศูนย์ (Messenger / IG), แท็ก, โน้ตลูกค้า, สร้างออเดอร์, ส่งรูป/สลิป
  - `comments/` — ระบบจัดการคอมเมนต์โพสต์และตั้งค่าบอทตอบคอมเมนต์/ทักแชทอัตโนมัติ (Private Reply)
  - `orders/` & `orders/tracking/` — จัดการออเดอร์ สลิป และนำเข้าเลขพัสดุ CSV (Tracking Import)
  - `settings/autoreply/` — กฎตอบแชทอัตโนมัติและคีย์เวิร์ด
  - `dashboard/` — สถิติภาพรวมและ SLA การตอบแชท
  - `settings/` — จัดการเพจที่เชื่อมต่อ, แอดมิน, แจ้งเตือน, และตรวจสุขภาพระบบ
- `src/app/api/` — API Route Handlers ทั้งหมด
- `src/server/` — ลอจิกฝั่ง Server แยกตามโดเมน (`ingest`, `messaging`, `policy`, `meta`, `comments`, `autoreply`, `orders`, `tracking`, `storage`, `notify`, `compliance` ฯลฯ)
- `supabase/migrations/` — ไฟล์ SQL สร้างตารางและฟังก์ชันทั้งหมด เรียงตามลำดับ `0001_init.sql` ถึงไฟล์ล่าสุด
- `docs/` — คู่มือภาษาไทย (`META_SETUP_TH.md`, `STORAGE.md`, `NOTIFICATIONS.md`, `TRACKING_TH.md`, `BACKFILL_TH.md`)

---

## 4. คำสั่งที่ใช้บ่อย (Scripts)
```bash
npm run dev          # รันเซิร์ฟเวอร์พัฒนา (Next.js 16)
npm run typecheck    # ตรวจชนิดข้อมูล TypeScript (tsc --noEmit)
npm run lint         # ตรวจ ESLint
npm test             # รัน Unit Tests ด้วย Vitest
npm run check-db     # ตรวจสอบการเชื่อมต่อและตารางบน Supabase จริง (scripts/check-db.ts)
npm run worker       # รันตัวประมวลผลคิว Webhook แยกโปรเซส (scripts/worker.ts)
npm run notify       # รันตัวตรวจแชทค้าง/แจ้งเตือนแยกโปรเซส (scripts/notify-worker.ts)
```
*(หมายเหตุ: ชื่อสคริปต์ตรวจ DB ใน `package.json` คือ `npm run check-db`)*

---

## 5. กฎเหล็กในการแก้ไขโค้ดและทำงานร่วมกันหลาย Agent
1. **ห้ามลบ `<!-- BEGIN:nextjs-agent-rules -->` ด้านบนสุดของไฟล์นี้** เพราะ `next dev` จะสร้างซ้ำอัตโนมัติ
2. **Next.js 16 Rules:**
   - ใช้ `src/proxy.ts` เท่านั้น (ห้ามสร้าง `src/middleware.ts`)
   - ใน Route Handlers และ Pages ต้อง `await params`, `await searchParams`, `await cookies()`, `await headers()` เสมอ
3. **Message Policy Engine (`src/server/policy/`):**
   - ทุกการส่งข้อความออกหาลูกค้าต้องผ่าน Policy Engine ห้ามยิง Graph API ข้ามการตรวจสิทธิ์
   - กฎของ **Facebook Messenger** และ **Instagram Direct** แยกกันคนละชุด ห้ามใช้ปนกัน
4. **Public Access สำหรับ Meta Compliance:**
   - ห้ามบล็อกการเข้าถึง `/privacy`, `/terms`, `/api/webhooks/meta/*`, และ `/api/compliance/data-deletion-status` ใน `src/proxy.ts`
5. **การทำงานร่วมกันผ่าน `.git` (Antigravity + Codex):**
   - ก่อนเริ่มแก้ไขไฟล์ ให้เช็ก `git status` เสมอเพื่อดูว่ามีงานค้างจากอีก Agent หรือไม่
   - หลังแก้ไขเสร็จ ต้องรัน `npm run typecheck` และ `npm test` ให้ผ่านทุกครั้งก่อนจบงานหรือ commit

## 6. สถานะและการส่งต่องาน

- อ่าน [docs/HANDOFF_ANTIGRAVITY_TH.md](docs/HANDOFF_ANTIGRAVITY_TH.md) และ [docs/WORK_STATUS_TH.md](docs/WORK_STATUS_TH.md) ก่อนสรุปความพร้อม โดยดูวันที่ของหลักฐานเสมอ
- Production ใช้ Meta App **HubChat `1762855681523459`**; App `2229730894588783` คือ **SuperiCez Studio** ไม่ใช่ตัวเดียวกัน ตรวจ runtime settings ก่อนเปลี่ยนการเชื่อมต่อ
- Unit tests/build/deployment ผ่าน ไม่ใช่หลักฐานว่า Meta Advanced Access ผ่านหรือข้อความถึงลูกค้าจริงแล้ว
- การแก้ IG Private Reply, General DM/Attachment และผลตรวจ cache/error อยู่ใน [docs/INSTAGRAM_PRIVATE_REPLY_FIX_TH.md](docs/INSTAGRAM_PRIVATE_REPLY_FIX_TH.md); ต้องแยกผล regression ออกจากผลส่งจริงหลังสิทธิ์พร้อม
- `DEFERRED_REVIEW.md` เก็บประวัติรอบต้นด้วย ให้ใช้ตารางอัปเดตด้านบนก่อน ไม่เปิดงานเก่าซ้ำจากข้อความประวัติ
