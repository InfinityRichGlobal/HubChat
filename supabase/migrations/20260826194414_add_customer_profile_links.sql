-- เก็บ username ที่ Meta คืนมาเพื่อเปิดโปรไฟล์จริงได้ โดยไม่เดาลิงก์จาก PSID
-- Facebook PSID เป็นเลขเฉพาะเพจและไม่ใช่ public profile id จึงห้ามประกอบ
-- facebook.com/<psid> เอง ส่วน Instagram เปิดได้จาก username ที่ Meta คืนมา
alter table public.customers
  add column if not exists username text;

create index if not exists customers_username_search_idx
  on public.customers using gin (username public.gin_trgm_ops)
  where username is not null;

comment on column public.customers.username is
  'Username ที่ Meta คืนมา (ปัจจุบันใช้กับ Instagram) สำหรับค้นหาและเปิดโปรไฟล์จริง ห้ามเดาจาก PSID';
