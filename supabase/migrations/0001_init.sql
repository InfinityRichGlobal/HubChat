-- ============================================================================
--  HubChat — เฟส 1 : สร้างตารางทั้งหมดตามสเปกหัวข้อ 3
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ (idempotent) ทุกอย่างใช้ IF NOT EXISTS
-- ============================================================================

-- ---------------------------------------------------------------------------
--  0) EXTENSION ที่ต้องใช้
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- ค้นหาชื่อลูกค้าแบบคล้าย ๆ (ใช้ตอนจับคู่เลขพัสดุ)

-- ---------------------------------------------------------------------------
--  1) ENUM — กำหนดค่าที่เป็นไปได้ให้ชัด ผิดค่าปุ๊บ insert ไม่ผ่านทันที
--     (ดีกว่า text เปล่า ๆ เพราะกันพิมพ์ผิดตั้งแต่ระดับฐานข้อมูล)
-- ---------------------------------------------------------------------------
do $$ begin
  -- แพลตฟอร์มของเพจ
  create type platform_t          as enum ('facebook','instagram');
exception when duplicate_object then null; end $$;

do $$ begin
  -- ช่องทางส่งข้อความ (ใช้ใน send_attempts / policy engine)
  create type channel_t           as enum ('messenger','instagram');
exception when duplicate_object then null; end $$;

do $$ begin
  -- ทิศทางข้อความ : เข้า / ออก
  create type direction_t         as enum ('in','out');
exception when duplicate_object then null; end $$;

do $$ begin
  -- ใครเป็นคนส่ง
  create type sender_type_t       as enum ('customer','admin','bot');
exception when duplicate_object then null; end $$;

do $$ begin
  -- สิทธิ์แอดมิน 3 ระดับ ตามหัวข้อ 5.7
  create type admin_role_t        as enum ('owner','admin','viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  -- ที่มาของแชท (หัวข้อ 1 ข้อ 4 : ต้องรู้ว่ามาจากแอดไหน)
  create type referral_source_t   as enum ('ADS','SHORTLINK','POST','ORGANIC');
exception when duplicate_object then null; end $$;

do $$ begin
  -- วิธีจับคู่คีย์เวิร์ด
  create type match_type_t        as enum ('exact','contains','starts_with');
exception when duplicate_object then null; end $$;

do $$ begin
  -- วิธีจ่ายเงิน
  create type payment_method_t    as enum ('cod','transfer');
exception when duplicate_object then null; end $$;

do $$ begin
  -- สถานะการจ่ายเงิน
  create type payment_status_t    as enum ('unpaid','deposit','paid');
exception when duplicate_object then null; end $$;

do $$ begin
  -- สถานะออเดอร์
  create type order_status_t      as enum ('draft','confirmed','paid','packed','shipped','completed','cancelled','returned');
exception when duplicate_object then null; end $$;

do $$ begin
  -- สถานะการแจ้งเลขพัสดุให้ลูกค้า
  create type notify_status_t     as enum ('pending','sent','blocked','skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  -- ประเภทข้อความ — สำคัญมาก Policy Engine ใช้ตัวนี้เลือก transport (หัวข้อ 6.1)
  -- ห้ามเดาจากเนื้อข้อความ ต้องมาจากบริบทเท่านั้น
  create type message_type_t      as enum (
    'inquiry_response',       -- แอดมินตอบคำถามลูกค้า
    'order_update',           -- อัปเดตออเดอร์
    'shipping_update',        -- แจ้งเลขพัสดุ
    'appointment_reminder',   -- เตือนนัดหมาย
    'promotion',              -- ข้อความขาย
    'upsell'                  -- เสนอเพิ่ม
  );
exception when duplicate_object then null; end $$;

do $$ begin
  -- ช่องทางที่ Meta อนุญาต ณ เวลานั้น (ผลลัพธ์จาก Policy Engine)
  create type transport_t         as enum ('STANDARD','HUMAN_AGENT','UTILITY','MARKETING');
exception when duplicate_object then null; end $$;

do $$ begin
  -- ใครสั่งให้ส่ง
  create type triggered_by_t      as enum ('admin','bot','scheduler');
exception when duplicate_object then null; end $$;

do $$ begin
  -- ประเภทงานติดตาม
  create type follow_up_type_t    as enum ('day3','day7','day14','day30','custom');
exception when duplicate_object then null; end $$;

do $$ begin
  -- สถานะงานติดตาม
  create type follow_up_status_t  as enum ('scheduled','sent','blocked','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  -- สถานะรอบนำเข้าเลขพัสดุ
  create type import_status_t     as enum ('parsing','review','applied','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  -- วิธีที่ระบบจับคู่แถวในไฟล์ขนส่งกับออเดอร์
  create type match_method_t      as enum ('order_ref','phone','phone_postcode','name_postcode','manual');
exception when duplicate_object then null; end $$;

do $$ begin
  -- ผลการจับคู่
  create type match_status_t      as enum ('auto','ambiguous','manual','unmatched','skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  -- ขนส่งที่รองรับ
  create type courier_t           as enum ('flash','kerry','jt','thailand_post','custom');
exception when duplicate_object then null; end $$;

do $$ begin
  -- รูปแบบโปรโมชัน
  create type promotion_type_t    as enum ('single','bundle','buy_x_get_y','boxset');
exception when duplicate_object then null; end $$;

do $$ begin
  -- สถานะคิว webhook
  create type queue_status_t      as enum ('pending','processing','done','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  -- ชนิดอุปกรณ์ที่รับ push
  create type device_platform_t   as enum ('ios','android','desktop');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
--  2) ฟังก์ชันช่วย
-- ---------------------------------------------------------------------------

-- อัปเดต updated_at อัตโนมัติทุกครั้งที่แก้แถว
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
--  3) admins — ผู้ใช้ระบบ (หัวข้อ 5.7)
--     ไม่มีหน้าสมัครสมาชิกสาธารณะ เจ้าของสร้างบัญชีให้ทุกคน
-- ---------------------------------------------------------------------------
create table if not exists admins (
  id                    uuid primary key default gen_random_uuid(),
  name                  text        not null,
  email                 text        not null,
  password_hash         text        not null,               -- argon2id เท่านั้น ห้าม plain text
  role                  admin_role_t not null default 'admin',
  allowed_page_ids      uuid[]      not null default '{}',  -- เห็นเพจไหนบ้าง (ว่าง = ยังไม่ได้ให้สิทธิ์เพจใด)
  must_change_password  boolean     not null default true,  -- บังคับเปลี่ยนรหัสตอน login ครั้งแรก
  is_active             boolean     not null default true,
  last_seen_at          timestamptz,                        -- ใช้โชว์ "สถานะออนไลน์"
  last_login_ip         text,
  session_version       integer     not null default 1,     -- บวก 1 = เตะออกทุกเครื่องทันที
  created_by            uuid references admins(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- อีเมลห้ามซ้ำ และไม่สนตัวพิมพ์เล็กใหญ่
create unique index if not exists admins_email_uniq on admins (lower(email));
create index if not exists admins_role_idx          on admins (role);
create index if not exists admins_is_active_idx     on admins (is_active);
drop trigger if exists admins_set_updated_at on admins;
create trigger admins_set_updated_at before update on admins
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
--  4) pages — เพจที่เชื่อมไว้
-- ---------------------------------------------------------------------------
create table if not exists pages (
  id            uuid primary key default gen_random_uuid(),
  platform      platform_t  not null,
  page_id       text        not null,                 -- id ของเพจฝั่ง Meta
  page_name     text        not null,
  display_name  text,                                 -- ชื่อเล่นที่แอดมินตั้งเอง
  tag_color     text        not null default '#3b82f6',
  access_token  text,                                 -- เข้ารหัส AES-256-GCM ก่อนเก็บเสมอ (เช็คลิสต์ข้อ 9)
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now()
);
-- เพจเดียวกันบนแพลตฟอร์มเดียวกัน ห้ามเชื่อมซ้ำ
create unique index if not exists pages_platform_pageid_uniq on pages (platform, page_id);
create index if not exists pages_is_active_idx on pages (is_active);

-- ---------------------------------------------------------------------------
--  5) products — สินค้า
-- ---------------------------------------------------------------------------
create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  sku         text,
  variant     text,                                   -- สี เช่น "แดงอิฐ"
  price       numeric(12,2) not null default 0,
  image_url   text,
  is_active   boolean     not null default true,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists products_active_sort_idx on products (is_active, sort_order);
create unique index if not exists products_sku_uniq on products (sku) where sku is not null;

-- ---------------------------------------------------------------------------
--  6) promotions — โปรโมชัน
-- ---------------------------------------------------------------------------
create table if not exists promotions (
  id          uuid primary key default gen_random_uuid(),
  name        text            not null,
  type        promotion_type_t not null,
  config      jsonb           not null default '{}'::jsonb,   -- เช่น {"pick":4,"pay":3}
  price       numeric(12,2),
  is_active   boolean         not null default true,
  sort_order  integer         not null default 0,
  created_at  timestamptz     not null default now()
);
create index if not exists promotions_active_idx on promotions (is_active, sort_order);

-- ---------------------------------------------------------------------------
--  7) tags / conversation_tags — แท็ก
-- ---------------------------------------------------------------------------
create table if not exists tags (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  color       text        not null default '#64748b',
  is_auto     boolean     not null default false,   -- true = ระบบใส่เอง / false = แอดมินกดเอง
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists tags_name_uniq on tags (lower(name));

-- ---------------------------------------------------------------------------
--  8) customers — ลูกค้า
--     คนเดียวกันทักคนละเพจ = คนละ record (unique page_id + psid)
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id                        uuid primary key default gen_random_uuid(),
  page_id                   uuid        not null references pages(id) on delete cascade,
  psid                      text        not null,        -- user id ฝั่ง Meta
  platform                  platform_t  not null,
  name                      text,
  profile_pic_url           text,
  phone                     text,
  address                   text,
  postcode                  text,
  recipient_name            text,
  total_orders              integer     not null default 0,
  total_spent               numeric(14,2) not null default 0,
  first_purchase_date       timestamptz,
  last_purchase_date        timestamptz,
  first_contact_at          timestamptz not null default now(),
  last_customer_message_at  timestamptz,                 -- ← Policy Engine ใช้ตัวนี้ ห้ามลบ
  last_admin_message_at     timestamptz,
  marketing_eligible        boolean     not null default false,
  marketing_checked_at      timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists customers_page_psid_uniq on customers (page_id, psid);
create index if not exists customers_phone_idx            on customers (phone) where phone is not null;
create index if not exists customers_page_idx             on customers (page_id);
-- Policy Engine เรียกบ่อยมาก ต้องมี index
create index if not exists customers_last_cust_msg_idx    on customers (last_customer_message_at desc);
-- ค้นชื่อลูกค้าแบบพิมพ์ไม่ครบ
create index if not exists customers_name_trgm_idx        on customers using gin (name gin_trgm_ops);
drop trigger if exists customers_set_updated_at on customers;
create trigger customers_set_updated_at before update on customers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
--  9) conversations — ห้องแชท
-- ---------------------------------------------------------------------------
create table if not exists conversations (
  id                        uuid primary key default gen_random_uuid(),
  customer_id               uuid        not null references customers(id) on delete cascade,
  page_id                   uuid        not null references pages(id) on delete cascade,
  last_message_at           timestamptz not null default now(),
  last_message_preview      text,
  last_customer_message_at  timestamptz,                     -- ใช้คำนวณนาฬิกา 24 ชม.
  is_read                   boolean     not null default false,
  assigned_admin_id         uuid references admins(id) on delete set null,
  locked_by_admin_id        uuid references admins(id) on delete set null,  -- ล็อกกันแอดมินชน
  locked_at                 timestamptz,
  referral_source           referral_source_t,
  referral_ad_id            text,
  referral_post_id          text,
  referral_ref              text,
  created_at                timestamptz not null default now()
);
create unique index if not exists conversations_customer_uniq on conversations (customer_id);
-- ลิสต์แชทหน้าหลัก : กรองเพจ + เรียงตามข้อความล่าสุด
create index if not exists conversations_page_lastmsg_idx  on conversations (page_id, last_message_at desc);
create index if not exists conversations_lastmsg_idx       on conversations (last_message_at desc);
create index if not exists conversations_unread_idx        on conversations (is_read) where is_read = false;
create index if not exists conversations_assigned_idx      on conversations (assigned_admin_id);
-- Dashboard ตาราง "แยกตามแอด"
create index if not exists conversations_ad_idx            on conversations (referral_ad_id) where referral_ad_id is not null;
create index if not exists conversations_last_cust_msg_idx on conversations (last_customer_message_at desc);

-- ---------------------------------------------------------------------------
-- 10) messages — ข้อความ
-- ---------------------------------------------------------------------------
create table if not exists messages (
  id                        uuid primary key default gen_random_uuid(),
  conversation_id           uuid        not null references conversations(id) on delete cascade,
  direction                 direction_t not null,
  sender_type               sender_type_t not null,
  admin_id                  uuid references admins(id) on delete set null,
  text                      text,
  attachments               jsonb       not null default '[]'::jsonb,  -- [{type, r2_key, drive_file_id}]
  sent_with_human_agent_tag boolean     not null default false,
  meta_message_id           text,                                       -- กันข้อความซ้ำจาก webhook retry
  is_deleted                boolean     not null default false,
  created_at                timestamptz not null default now()
);
-- เปิดห้องแชทแล้วดึงข้อความล่าสุด
create index if not exists messages_conv_created_idx on messages (conversation_id, created_at desc);
-- กันซ้ำ : Meta ส่ง webhook เดิมมาซ้ำได้ (หัวข้อ 6.3)
create unique index if not exists messages_meta_id_uniq on messages (meta_message_id) where meta_message_id is not null;
create index if not exists messages_admin_idx on messages (admin_id) where admin_id is not null;

create table if not exists conversation_tags (
  conversation_id uuid not null references conversations(id) on delete cascade,
  tag_id          uuid not null references tags(id) on delete cascade,
  added_by        uuid references admins(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, tag_id)
);
create index if not exists conversation_tags_tag_idx on conversation_tags (tag_id);

-- ---------------------------------------------------------------------------
-- 11) keyword_rules — กฎตอบอัตโนมัติ (คีย์เวิร์ดล้วน ไม่มี AI)
-- ---------------------------------------------------------------------------
create table if not exists keyword_rules (
  id           uuid primary key default gen_random_uuid(),
  name         text,
  page_ids     uuid[]       not null default '{}',   -- ว่าง = ใช้ทุกเพจ
  match_type   match_type_t not null default 'contains',
  keywords     text[]       not null default '{}',
  reply_text   text,
  reply_images jsonb        not null default '[]'::jsonb,  -- [{r2_key, drive_file_id, meta_attachment_id}]
  priority     integer      not null default 100,          -- เลขน้อยตรวจก่อน
  is_active    boolean      not null default true,
  hit_count    integer      not null default 0,
  created_at   timestamptz  not null default now()
);
create index if not exists keyword_rules_active_priority_idx on keyword_rules (is_active, priority);
create index if not exists keyword_rules_pages_gin  on keyword_rules using gin (page_ids);
create index if not exists keyword_rules_words_gin  on keyword_rules using gin (keywords);

-- ---------------------------------------------------------------------------
-- 12) canned_responses — ชุดคำตอบสำเร็จรูป (พิมพ์ / แล้วค้นเจอ)
-- ---------------------------------------------------------------------------
create table if not exists canned_responses (
  id          uuid primary key default gen_random_uuid(),
  category    text,
  title       text        not null,
  shortcut    text,
  text        text,
  images      jsonb       not null default '[]'::jsonb,
  use_count   integer     not null default 0,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists canned_category_sort_idx on canned_responses (category, sort_order);
create unique index if not exists canned_shortcut_uniq on canned_responses (lower(shortcut)) where shortcut is not null;
create index if not exists canned_title_trgm_idx on canned_responses using gin (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 13) courier_templates — แม่แบบคอลัมน์ของขนส่งแต่ละเจ้า
-- ---------------------------------------------------------------------------
create table if not exists courier_templates (
  id             uuid primary key default gen_random_uuid(),
  courier_name   courier_t not null,
  label          text,
  column_mapping jsonb     not null default '{}'::jsonb,  -- {tracking_no:"เลขพัสดุ", phone:"เบอร์ผู้รับ"}
  detect_headers text[]    not null default '{}',         -- ใช้เดาว่าไฟล์นี้ของเจ้าไหน
  created_by     uuid references admins(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists courier_templates_name_idx on courier_templates (courier_name);

-- ---------------------------------------------------------------------------
-- 14) tracking_imports — รอบการนำเข้าเลขพัสดุ
-- ---------------------------------------------------------------------------
create table if not exists tracking_imports (
  id             uuid primary key default gen_random_uuid(),
  filename       text        not null,
  courier        courier_t,
  template_id    uuid references courier_templates(id) on delete set null,
  total_rows     integer     not null default 0,
  matched_auto   integer     not null default 0,
  matched_manual integer     not null default 0,
  unmatched      integer     not null default 0,
  status         import_status_t not null default 'parsing',
  file_hash      text        not null,                    -- กัน import ไฟล์เดิมซ้ำ
  notified_count integer     not null default 0,
  blocked_count  integer     not null default 0,
  uploaded_by    uuid references admins(id) on delete set null,
  created_at     timestamptz not null default now(),
  applied_at     timestamptz
);
-- ไฟล์เดิมห้ามนำเข้าซ้ำ (ลูกค้าจะได้ข้อความซ้ำ)
create unique index if not exists tracking_imports_hash_uniq on tracking_imports (file_hash);
create index if not exists tracking_imports_status_idx on tracking_imports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 15) orders — ออเดอร์
-- ---------------------------------------------------------------------------
create table if not exists orders (
  id                       uuid primary key default gen_random_uuid(),
  order_no                 text        not null,               -- ORD-260823-001
  conversation_id          uuid references conversations(id) on delete set null,
  customer_id              uuid references customers(id) on delete set null,
  page_id                  uuid references pages(id) on delete set null,
  source_message_id        uuid references messages(id) on delete set null,

  recipient_name           text,
  phone                    text,
  address                  text,
  postcode                 text,

  items                    jsonb       not null default '[]'::jsonb,  -- [{product_id,name,variant,qty,unit_price,total}]

  subtotal                 numeric(12,2) not null default 0,
  shipping_fee             numeric(12,2) not null default 0,
  discount                 numeric(12,2) not null default 0,
  total                    numeric(12,2) not null default 0,

  payment_method           payment_method_t,
  payment_status           payment_status_t not null default 'unpaid',
  slip_url                 text,
  paid_at                  timestamptz,

  shipping_carrier         text,
  tracking_no              text,
  shipped_at               timestamptz,
  tracking_import_id       uuid references tracking_imports(id) on delete set null,
  tracking_notified_at     timestamptz,                        -- มีค่าแล้ว = ห้ามส่งซ้ำ (idempotent)
  tracking_notify_status   notify_status_t,
  tracking_notify_reason_th text,

  status                   order_status_t not null default 'draft',

  referral_ad_id           text,                               -- copy มาจาก conversation ตอนสร้าง
  referral_post_id         text,
  first_contact_at         timestamptz,                        -- ใช้วัดว่าปิดการขายกี่ชั่วโมง
  closed_at                timestamptz,

  internal_note            text,
  created_by_admin_id      uuid references admins(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index if not exists orders_order_no_uniq on orders (order_no);
create index if not exists orders_conv_idx        on orders (conversation_id);
create index if not exists orders_customer_idx    on orders (customer_id);
create index if not exists orders_page_status_idx on orders (page_id, status);
create index if not exists orders_status_idx      on orders (status);
create index if not exists orders_created_idx     on orders (created_at desc);
create index if not exists orders_payment_idx     on orders (payment_status);
-- ช่องค้นหาหน้าอินบ็อกซ์ : ค้นด้วยเบอร์ / เลขพัสดุ
create index if not exists orders_phone_idx       on orders (phone) where phone is not null;
create index if not exists orders_tracking_idx    on orders (tracking_no) where tracking_no is not null;
-- Dashboard : ตารางแยกตามแอด
create index if not exists orders_ad_idx          on orders (referral_ad_id) where referral_ad_id is not null;
-- คิวรอแจ้งเลขพัสดุ
create index if not exists orders_notify_pending_idx on orders (tracking_notify_status) where tracking_notified_at is null;
drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at before update on orders
  for each row execute function set_updated_at();

-- ตัวนับเลขออเดอร์รายวัน (ให้ได้รูปแบบ ORD-260823-001)
create table if not exists order_no_counters (
  day date primary key,
  seq integer not null default 0
);

-- ขอเลขออเดอร์ถัดไปของวันนี้ (ตามเวลาไทย) — atomic ไม่ชนกันแม้แอดมินกดพร้อมกัน
create or replace function next_order_no()
returns text language plpgsql as $$
declare
  d date;
  n integer;
begin
  d := (now() at time zone 'Asia/Bangkok')::date;
  insert into order_no_counters (day, seq) values (d, 1)
    on conflict (day) do update set seq = order_no_counters.seq + 1
    returning seq into n;
  return 'ORD-' || to_char(d, 'YYMMDD') || '-' || lpad(n::text, 3, '0');
end $$;

-- ---------------------------------------------------------------------------
-- 16) tracking_import_rows — แต่ละแถวในไฟล์ขนส่ง
-- ---------------------------------------------------------------------------
create table if not exists tracking_import_rows (
  id                  uuid primary key default gen_random_uuid(),
  import_id           uuid not null references tracking_imports(id) on delete cascade,
  raw_row             jsonb not null default '{}'::jsonb,   -- เก็บข้อมูลดิบไว้ตรวจย้อนหลัง
  tracking_no         text,
  phone_raw           text,
  phone_normalized    text,                                 -- normalize ทั้งสองฝั่งก่อนเทียบเสมอ
  postcode            text,
  recipient_name      text,
  matched_order_id    uuid references orders(id) on delete set null,
  match_method        match_method_t,
  match_status        match_status_t not null default 'unmatched',
  candidate_order_ids uuid[] not null default '{}',          -- กรณี ambiguous ให้แอดมินเลือก
  created_at          timestamptz not null default now()
);
create index if not exists tir_import_idx   on tracking_import_rows (import_id);
create index if not exists tir_status_idx   on tracking_import_rows (import_id, match_status);
create index if not exists tir_phone_idx    on tracking_import_rows (phone_normalized) where phone_normalized is not null;
create index if not exists tir_tracking_idx on tracking_import_rows (tracking_no) where tracking_no is not null;

-- ---------------------------------------------------------------------------
-- 17) order_logs — ประวัติแก้ไขออเดอร์
-- ---------------------------------------------------------------------------
create table if not exists order_logs (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  admin_id   uuid references admins(id) on delete set null,
  action     text not null,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);
create index if not exists order_logs_order_idx on order_logs (order_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 18) send_attempts — บันทึกทุกครั้งที่ "พยายาม" ส่ง
--     นี่คือหลักฐานตอนยื่น App Review และเป็นที่แรกที่ดูเวลาส่งไม่ผ่าน
-- ---------------------------------------------------------------------------
create table if not exists send_attempts (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid references customers(id) on delete set null,
  conversation_id    uuid references conversations(id) on delete set null,
  channel            channel_t not null,
  message_type       message_type_t not null,
  selected_transport transport_t,                 -- null = engine บอกว่าไม่มีช่องทางที่ส่งได้
  policy_reason_code text not null,
  policy_reason_th   text not null,               -- ข้อความที่แอดมินอ่านรู้เรื่อง
  meta_response_code integer,
  meta_error_subcode integer,
  meta_error_message text,
  fbtrace_id         text,
  success            boolean not null default false,
  estimated_cost     numeric(10,4),
  triggered_by       triggered_by_t not null,
  admin_id           uuid references admins(id) on delete set null,
  sent_at            timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists send_attempts_customer_idx on send_attempts (customer_id, created_at desc);
create index if not exists send_attempts_conv_idx     on send_attempts (conversation_id, created_at desc);
create index if not exists send_attempts_created_idx  on send_attempts (created_at desc);
-- ดูรายการที่ส่งไม่ผ่านเป็นอย่างแรกเวลามีปัญหา
create index if not exists send_attempts_failed_idx   on send_attempts (created_at desc) where success = false;
create index if not exists send_attempts_transport_idx on send_attempts (selected_transport, created_at desc);

-- ---------------------------------------------------------------------------
-- 19) follow_ups — งานติดตามลูกค้า 3/7/14/30 วัน
--     scheduler ต้องเรียก Policy Engine ก่อนส่งทุกครั้ง ห้ามสมมติว่าส่งได้
-- ---------------------------------------------------------------------------
create table if not exists follow_ups (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references customers(id) on delete cascade,
  conversation_id  uuid references conversations(id) on delete set null,
  order_id         uuid references orders(id) on delete set null,
  follow_up_type   follow_up_type_t not null,
  follow_up_date   timestamptz not null,
  message_type     message_type_t not null,      -- แอดมินเลือกเองตอนสร้าง ห้ามให้ระบบเดา
  draft_text       text,
  template_id      text,
  template_params  jsonb not null default '{}'::jsonb,
  status           follow_up_status_t not null default 'scheduled',
  policy_decision  jsonb,                        -- เก็บผลจาก engine ตอนถึงเวลา
  blocked_reason_th text,
  created_by       uuid references admins(id) on delete set null,
  created_at       timestamptz not null default now(),
  executed_at      timestamptz
);
-- scheduler ดึงงานที่ถึงเวลา : ต้องเร็ว
create index if not exists follow_ups_due_idx      on follow_ups (status, follow_up_date) where status = 'scheduled';
create index if not exists follow_ups_customer_idx on follow_ups (customer_id, follow_up_date desc);
create index if not exists follow_ups_order_idx    on follow_ups (order_id);

-- ---------------------------------------------------------------------------
-- 20) comments — คอมเมนต์ใต้โพสต์
-- ---------------------------------------------------------------------------
create table if not exists comments (
  id                uuid primary key default gen_random_uuid(),
  page_id           uuid not null references pages(id) on delete cascade,
  post_id           text,
  comment_id        text not null,                -- id ฝั่ง Meta
  parent_comment_id text,
  from_name         text,
  from_id           text,
  message           text,
  is_handled        boolean not null default false,
  handled_by        uuid references admins(id) on delete set null,
  handled_at        timestamptz,
  replied_public    boolean not null default false,
  replied_private   boolean not null default false,   -- private reply ทำได้ครั้งเดียวต่อคอมเมนต์ (หัวข้อ 6.4)
  created_at        timestamptz not null default now()
);
create unique index if not exists comments_meta_id_uniq on comments (comment_id);
create index if not exists comments_page_created_idx on comments (page_id, created_at desc);
-- ตัวนับคอมเมนต์ที่ยังไม่จัดการ
create index if not exists comments_unhandled_idx on comments (is_handled, created_at desc) where is_handled = false;

-- ---------------------------------------------------------------------------
-- 21) push_subscriptions — PWA notification (1 คนมีได้หลายเครื่อง)
-- ---------------------------------------------------------------------------
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references admins(id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  device_label text,                                  -- เช่น "iPhone ของโบว์"
  platform     device_platform_t,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists push_endpoint_uniq on push_subscriptions (endpoint);
create index if not exists push_admin_idx on push_subscriptions (admin_id);

-- ---------------------------------------------------------------------------
-- 22) notification_prefs — ตั้งค่าแจ้งเตือนรายคน
-- ---------------------------------------------------------------------------
create table if not exists notification_prefs (
  id                uuid primary key default gen_random_uuid(),
  admin_id          uuid not null references admins(id) on delete cascade,
  enabled_events    text[] not null default '{new_chat,reply,idle_15min,window_closing,new_comment}',
  page_ids          uuid[] not null default '{}',      -- ว่าง = ทุกเพจที่มีสิทธิ์
  quiet_hours_start time,
  quiet_hours_end   time,
  sound_enabled     boolean not null default true,
  created_at        timestamptz not null default now()
);
create unique index if not exists notification_prefs_admin_uniq on notification_prefs (admin_id);

-- ---------------------------------------------------------------------------
-- 23) activity_logs — ใครแก้/ลบอะไร login จาก IP ไหน เมื่อไหร่ (หัวข้อ 5.7)
-- ---------------------------------------------------------------------------
create table if not exists activity_logs (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references admins(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  detail      jsonb not null default '{}'::jsonb,
  ip_address  text,
  created_at  timestamptz not null default now()
);
create index if not exists activity_logs_admin_idx   on activity_logs (admin_id, created_at desc);
create index if not exists activity_logs_created_idx on activity_logs (created_at desc);
create index if not exists activity_logs_action_idx  on activity_logs (action, created_at desc);

-- ---------------------------------------------------------------------------
-- 24) app_settings — ค่าตั้งระบบแบบ key-value
--     เก็บ: telegram_bot_token, telegram_chat_id, telegram_enabled,
--           telegram_events, ice_breakers, shipping_fee, comment_filter_words
-- ---------------------------------------------------------------------------
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid references admins(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 25) webhook_queue — คิว (หัวข้อ 6.3 : รับ → ใส่คิว → ตอบ 200 ทันที)
-- ---------------------------------------------------------------------------
create table if not exists webhook_queue (
  id            bigserial primary key,
  payload       jsonb not null,
  status        queue_status_t not null default 'pending',
  attempts      integer not null default 0,
  error_message text,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);
-- worker วนอ่านทุก 2 วิ : ต้องหยิบงานเร็วที่สุด
create index if not exists webhook_queue_pending_idx on webhook_queue (created_at) where status = 'pending';
create index if not exists webhook_queue_status_idx  on webhook_queue (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 26) login_attempts — เพิ่มตามเช็คลิสต์ข้อ 9 (rate limit หน้า login)
--     ผิด 5 ครั้ง = ล็อก 15 นาที
-- ---------------------------------------------------------------------------
create table if not exists login_attempts (
  id         bigserial primary key,
  email      text not null,
  ip_address text,
  success    boolean not null default false,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_email_idx on login_attempts (lower(email), created_at desc);
create index if not exists login_attempts_ip_idx    on login_attempts (ip_address, created_at desc);

-- ---------------------------------------------------------------------------
-- 27) RLS — ปิดประตูฝั่ง client ทั้งหมด
--     เปิด RLS แต่ไม่สร้าง policy = anon key อ่านอะไรไม่ได้เลย
--     ทุกการเข้าถึงต้องผ่าน server ของเราที่ถือ service_role key เท่านั้น
--     (ตรงกับเช็คลิสต์ข้อ 9 : แอดมินทั่วไปต้องไม่เห็น access token ใด ๆ)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'admins','pages','products','promotions','tags','customers','conversations',
    'messages','conversation_tags','keyword_rules','canned_responses',
    'courier_templates','tracking_imports','orders','order_no_counters',
    'tracking_import_rows','order_logs','send_attempts','follow_ups','comments',
    'push_subscriptions','notification_prefs','activity_logs','app_settings',
    'webhook_queue','login_attempts'
  ] loop
    -- เปิด RLS อย่างเดียว ไม่ force เพราะ service_role ของ Supabase ต้อง bypass ได้
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 28) ค่าตั้งต้นของระบบ
-- ---------------------------------------------------------------------------
insert into app_settings (key, value) values
  ('telegram_enabled',     'false'::jsonb),
  ('telegram_events',      '["new_chat","idle_15min","error"]'::jsonb),
  ('ice_breakers',         '[]'::jsonb),
  ('shipping_fee',         '0'::jsonb),
  ('comment_filter_words', '["ราคา","สนใจ","cf","จอง","สั่ง"]'::jsonb)
on conflict (key) do nothing;
