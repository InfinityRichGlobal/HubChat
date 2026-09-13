# การเก็บไฟล์รูปภาพและสื่อถาวรด้วย Supabase Storage

เอกสารนี้อธิบายสถาปัตยกรรมและการทำงานของระบบจัดเก็บสื่อ (Media Storage) ใน HubChat ซึ่งย้ายมารวมไว้ที่ **Supabase Storage** อย่างสมบูรณ์ (ไม่ต้องพึ่งพาบริการภายนอกแยกต่างหากอย่าง Cloudflare R2)

---

## 1. ทำไมต้องเก็บไฟล์เองถาวร?

- ไฟล์ภาพและสื่อที่ลูกค้าส่งมาทาง Messenger / Instagram มาพร้อม **ลิงก์ชั่วคราว (CDN URL) ของ Meta** ซึ่งจะหมดอายุในเวลาไม่นาน
- **สลิปโอนเงินคือหลักฐานสำคัญ:** หากปล่อยให้ลิงก์ Meta หมดอายุ จะไม่สามารถเปิดดูย้อนหลังได้
- HubChat จึงออกแบบให้ระบบดาวน์โหลดไฟล์มาเก็บไว้ใน Supabase Storage ทันทีที่ได้รับ webhook ก่อนลิงก์จะหมดอายุ

---

## 2. สถาปัตยกรรม (Zero-Config)

| รายการ | รายละเอียด |
|---|---|
| **Storage Provider** | Supabase Storage |
| **Bucket Name** | `media` |
| **Credentials** | ใช้ `NEXT_PUBLIC_SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ตัวเดียวกับ Database |
| **Migration** | `supabase/migrations/20260912_supabase_storage.sql` |
| **Server Adapter** | `src/server/storage/supabase-storage.ts` |
| **Media Service** | `src/server/storage/media.ts` |
| **Serving Endpoint** | `/api/media/[id]` (มีการตรวจสิทธิ์ก่อนส่งข้อมูล) |

> ✅ **Zero-Config:** ไม่ต้องตั้งค่า access key, secret หรือ bucket แยกต่างหากใน `.env` เพียงแค่มี Supabase ที่เชื่อมต่อฐานข้อมูลอยู่แล้ว Storage จะพร้อมใช้งานทันที

---

## 3. รูปแบบการจัดเก็บและโครงสร้าง Key

ไฟล์ทั้งหมดจะถูกตั้งชื่อตาม Hash ของเนื้อหาไฟล์ (SHA-256) และแยกโฟลเดอร์ตามปีและเดือน:

```
media/
  └── {prefix}/
        └── {yyyy}/
              └── {mm}/
                    └── {sha256}.{ext}
```

- **Deduplication:** ไฟล์ที่เนื้อหาเหมือนกันทุกประการจะได้ Hash เดียวกัน ทำให้ไม่เปลืองพื้นที่จัดเก็บซ้ำซ้อน
- **ความปลอดภัย:** ให้บริการผ่าน Server Route `/api/media/[id]` ซึ่งตรวจสิทธิ์ผู้ใช้และสิทธิ์การเข้าถึงเพจก่อนเสิร์ฟไฟล์เสมอ

---

## 4. การตรวจสอบสถานะการเก็บไฟล์

สามารถตรวจสอบสถานะการเก็บไฟล์ใน Supabase SQL Editor:

```sql
select status, count(*) from media_assets group by status;
```

| สถานะ | ความหมาย |
|---|---|
| `stored` | ✅ จัดเก็บลง Supabase Storage เรียบร้อย เปิดดูได้ตลอดไป |
| `pending` | กำลังอยู่ในคิวดาวน์โหลดและจัดเก็บ |
| `failed` | เกิดข้อผิดพลาดในการดาวน์โหลดหรือบันทึก (ระบบจะลองใหม่) |
| `expired` | ลิงก์ Meta หมดอายุก่อนที่ระบบจะจัดเก็บทัน |
| `skipped` | ข้ามการจัดเก็บ (เช่น ขนาดไฟล์เกินขีดจำกัด) |

---

## 5. การตั้งค่า Bucket ใน Supabase (กรณีติดตั้งใหม่)

หากตั้งค่า Supabase ใหม่ สามารถรัน Migration ได้จากไฟล์:
`supabase/migrations/20260912_supabase_storage.sql`

```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)
on conflict (id) do update set file_size_limit = 52428800, public = true;
```
