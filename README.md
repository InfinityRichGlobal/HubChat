# HubChat — ระบบรวมแชท FB + IG (เฟส 1)

รอบที่ 1 : ฐานของระบบ + ฐานข้อมูล + ระบบเข้าสู่ระบบ
**ยังไม่มีหน้าแชท** — ตามที่ตกลงกันไว้

---

## ทำอะไรไปแล้วบ้างในรอบนี้

| หัวข้อในสเปก | สถานะ |
|---|---|
| 2. สแต็ก — Next.js + TypeScript + Tailwind + shadcn/ui | ✅ |
| 3. ฐานข้อมูล — ทุกตาราง + index | ✅ 26 ตาราง / 97 index |
| 5.7 หน้าจัดการแอดมิน + สิทธิ์ 3 ระดับ | ✅ |
| 9. เช็คลิสต์ความปลอดภัย (ข้อที่เกี่ยวกับ login) | ✅ |
| อ่านค่าตั้งระบบจาก env เท่านั้น | ✅ |
| คอมเมนต์ภาษาไทยในโค้ดทุกส่วนสำคัญ | ✅ |

---

## ติดตั้งครั้งแรก — 6 ขั้น

> ทำตามลำดับ ห้ามข้าม ถ้าติดตรงไหนให้หยุดตรงนั้นแล้วบอก

### ขั้น 1 — ลงโปรแกรมที่ต้องใช้

ต้องมี **Node.js เวอร์ชัน 20 ขึ้นไป** ในเครื่อง
เช็คด้วยคำสั่ง `node -v` ถ้าไม่มีให้โหลดจาก nodejs.org

```bash
git clone https://github.com/InfinityRichGlobal/HubChat.git
cd HubChat
npm install
```

### ขั้น 2 — สร้างโปรเจกต์ Supabase

1. เข้า supabase.com → **New project**
2. ตั้งชื่อ `hubchat` เลือก region **Southeast Asia (Singapore)** — ใกล้ไทยที่สุด
3. ตั้ง Database Password แล้ว**จดไว้**
4. รอสร้างเสร็จประมาณ 2 นาที

### ขั้น 3 — สร้างตารางทั้งหมด

1. ใน Supabase เมนูซ้าย → **SQL Editor** → **New query**
2. เปิดไฟล์ `supabase/migrations/0001_init.sql` ในโปรเจกต์นี้
3. **คัดลอกทั้งไฟล์** ไปวางในช่อง แล้วกด **Run** (มุมขวาล่าง)
4. ต้องขึ้น `Success. No rows returned`

> ไฟล์นี้รันซ้ำได้ ไม่พัง ถ้าไม่แน่ใจว่ารันครบ กด Run ใหม่ได้เลย

### ขั้น 4 — ใส่ค่าตั้งระบบ

```bash
cp .env.example .env.local
```

เปิดไฟล์ `.env.local` แล้วเติมค่า :

**จาก Supabase → Project Settings → API**

| ช่องใน .env.local | เอามาจาก |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (กด Reveal ก่อน) |

**สร้างเองด้วยคำสั่ง** (macOS / Linux เปิด Terminal, Windows ใช้ Git Bash)

```bash
openssl rand -base64 48    # เอาค่าที่ได้ไปใส่ SESSION_SECRET
openssl rand -base64 32    # เอาค่าที่ได้ไปใส่ ENCRYPTION_KEY
```

**บัญชีเจ้าของ** — เติม 3 บรรทัดนี้

```
OWNER_NAME=ชื่อคุณ
OWNER_EMAIL=อีเมลที่จะใช้ล็อกอิน
OWNER_PASSWORD=รหัสชั่วคราว        # เว้นว่างไว้ก็ได้ ระบบจะสุ่มให้
```

### ขั้น 5 — ตรวจว่าต่อติดแล้วสร้างบัญชีเจ้าของ

```bash
npm run check-db      # ต้องขึ้น ✅ ครบทั้ง 26 ตาราง
npm run create-owner  # สร้างบัญชีเจ้าของ — รันได้ครั้งเดียว
```

รันเสร็จแล้ว **ลบ `OWNER_NAME` / `OWNER_EMAIL` / `OWNER_PASSWORD` ออกจาก `.env.local`**

### ขั้น 6 — เปิดใช้งาน

```bash
npm run dev
```

เปิด <http://localhost:3000> → เข้าสู่ระบบด้วยอีเมลกับรหัสชั่วคราว
ระบบจะบังคับให้ตั้งรหัสผ่านใหม่ทันที

---

## คำสั่งที่ใช้บ่อย

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | เปิดเซิร์ฟเวอร์สำหรับพัฒนา |
| `npm run build` | สร้างเวอร์ชันจริง (ต้องผ่านก่อน deploy เสมอ) |
| `npm start` | รันเวอร์ชันจริง |
| `npm run typecheck` | ตรวจว่าโค้ดไม่มีที่ผิดชนิดข้อมูล |
| `npm test` | รันชุดทดสอบระบบ login |
| `npm run check-db` | ตรวจว่าตารางในฐานข้อมูลครบไหม |
| `npm run create-owner` | สร้างบัญชีเจ้าของ (ครั้งเดียว) |

---

## โครงโฟลเดอร์

```
supabase/migrations/     SQL สร้างตารางทั้งหมด
scripts/                 สคริปต์ติดตั้ง (สร้างเจ้าของ / ตรวจฐานข้อมูล)
src/
├── app/
│   ├── login/                 หน้าเข้าสู่ระบบ
│   ├── change-password/       หน้าตั้งรหัสผ่านใหม่
│   ├── (app)/                 หน้าที่ต้องเข้าสู่ระบบก่อน
│   │   ├── inbox/             อินบ็อกซ์      ← รอบ 3
│   │   ├── orders/            ออเดอร์        ← รอบ 5
│   │   ├── dashboard/         สรุปยอด        ← รอบ 6
│   │   ├── comments/          คอมเมนต์       ← รอบ 6
│   │   └── settings/
│   │       ├── admins/        จัดการแอดมิน (5.7)  ✅
│   │       └── activity/      ประวัติการใช้งาน     ✅
│   └── api/                   API ทั้งหมด
├── components/ui/             คอมโพเนนต์ shadcn/ui
├── config/env.ts              อ่านค่าตั้งระบบจาก env (ที่เดียว)
├── lib/
│   ├── auth/                  รหัสผ่าน / session / สิทธิ์ / rate limit
│   ├── supabase/              ตัวเชื่อมฐานข้อมูล
│   └── crypto.ts              เข้ารหัส access token ก่อนเก็บ
├── server/                    ที่ว่างไว้ให้รอบถัดไป
│   ├── policy/                🔴 รอบ 2 — Message Policy Engine
│   ├── transports/            🔴 รอบ 2 — adapter ส่งข้อความ
│   ├── meta/                  Meta Graph API
│   └── queue/                 คิว webhook
├── types/db.ts                ชนิดข้อมูลของทุกตาราง
└── proxy.ts                   ด่านตรวจ session ก่อนเข้าทุกหน้า
```

---

## เรื่องความปลอดภัยที่ทำไปแล้ว

| เช็คลิสต์ข้อ 9 | สถานะ |
|---|---|
| hash รหัสผ่านด้วย argon2 | ✅ argon2id |
| session เก็บใน httpOnly cookie + `session_version` | ✅ |
| rate limit หน้า login (ผิด 5 ครั้ง = ล็อก 15 นาที) | ✅ ปรับได้จาก env |
| ไม่มีหน้าสมัครสมาชิกสาธารณะ | ✅ |
| แอดมินทั่วไปไม่เห็น access token | ✅ RLS ปิดตาย + ไม่ส่งออก API |
| เข้ารหัส access token ใน DB | ✅ AES-256-GCM (พร้อมใช้ตอนเชื่อมเพจ) |
| เขียนคอมเมนต์ภาษาไทยในโค้ด | ✅ |

**RLS** : ทุกตารางเปิด Row Level Security แต่ไม่มี policy
แปลว่า anon key อ่านอะไรไม่ได้เลย ทุกอย่างต้องผ่านเซิร์ฟเวอร์ของเราที่ตรวจสิทธิ์แล้ว

---

## รอบถัดไป

**🔴 รอบ 2 — Message Policy Engine (หัวข้อ 6.1)**
ต้องทำแยกรอบเดี่ยว ๆ ห้ามรวบกับอย่างอื่น
เพราะถ้าผิดแล้วเพจโดนระงับ — และทุกจุดที่ส่งข้อความในระบบต้องเรียกผ่าน engine นี้

รอบ 3 ค่อยทำหน้าแชท
