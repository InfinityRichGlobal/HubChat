-- ============================================================================
--  HubChat — 0016 : พื้นที่ทำงานของลูกค้าในห้องแชท (ก้อน 2 ข้อ 1.5 / 1.6)
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ของเดิมใน 0001-0015
--
--  ⚠️ ต้องรัน 0015 ก่อน — ลำดับ migration ห้ามข้าม
--
--  ไฟล์นี้เพิ่มสองอย่าง :
--   1. บันทึกภายในของแอดมิน (ไม่ส่งหาลูกค้าเด็ดขาด)
--   2. ร่องรอยว่า "ข้อมูลลูกค้าชุดนี้ดึงมาจากข้อความไหน"
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) customer_notes — บันทึกภายในของแอดมิน
--
--  🔴 ข้อมูลในตารางนี้ **ห้ามหลุดไปถึงลูกค้าเด็ดขาด**
--     เป็นที่ที่แอดมินจดเรื่องอย่าง "ลูกค้ารายนี้เคยเคลมสองรอบ" หรือ
--     "ต่อราคาเก่ง อย่าลดเพิ่ม" ซึ่งถ้าหลุดไปถึงลูกค้าคือเรื่องใหญ่
--
--     จึงตั้งใจ **ไม่** เอาไปไว้ในตาราง messages หรือ conversations
--     เพราะสองตารางนั้นมีเส้นทางที่ไหลออกไปหาลูกค้าได้
--     (preview / เนื้อข้อความ / การส่งต่อ) ส่วนตารางนี้ไม่มีเส้นทางนั้นเลย
-- ---------------------------------------------------------------------------
create table if not exists customer_notes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  /** ใครเขียน — เก็บไว้เพื่อให้รู้ว่าจะไปถามใครต่อ */
  admin_id    uuid references admins(id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references admins(id) on delete set null
);

create index if not exists customer_notes_customer_idx
  on customer_notes (customer_id, created_at desc);

alter table customer_notes enable row level security;

drop trigger if exists customer_notes_set_updated_at on customer_notes;
create trigger customer_notes_set_updated_at
  before update on customer_notes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
--  2) ร่องรอยว่าข้อมูลลูกค้ามาจากข้อความไหน (ข้อ 1.5)
--
--  ⭐ ทำไมต้องเก็บ :
--     แอดมินกด "ดึงข้อมูลลูกค้า" จากข้อความหนึ่ง แล้วบันทึกทับของเดิม
--     วันหลังถ้าที่อยู่ผิด จะไม่มีใครรู้ว่ามันมาจากข้อความไหน
--     ต้องไล่อ่านแชททั้งห้องเพื่อหาว่าลูกค้าพิมพ์อะไรไว้กันแน่
--
--  ⚠️ on delete set null — ข้อความถูกลบแล้วข้อมูลลูกค้าต้องไม่หายตาม
-- ---------------------------------------------------------------------------
alter table customers add column if not exists contact_source_message_id uuid
  references messages(id) on delete set null;
alter table customers add column if not exists contact_updated_at timestamptz;
alter table customers add column if not exists contact_updated_by uuid
  references admins(id) on delete set null;

-- ---------------------------------------------------------------------------
--  3) ⭐ save_customer_contact — บันทึกข้อมูลลูกค้าพร้อมร่องรอย
--
--  🔴 ห้ามเขียนทับค่าเดิมด้วยค่าว่าง
--     แอดมินอาจกรอกแค่เบอร์แล้วกดบันทึก — ที่อยู่เดิมต้องไม่หาย
--     (บทเรียนเดียวกับ finish_profile_sync ใน 0014)
--
--  ⚠️ ค่าที่ส่งมาเป็น null = "ไม่แก้ช่องนี้"
--     ถ้าจะล้างค่าจริง ๆ ต้องส่งสตริงว่างมา ซึ่งเป็นเจตนาที่ชัดเจนกว่า
-- ---------------------------------------------------------------------------
create or replace function save_customer_contact(
  p_customer_id       uuid,
  p_admin_id          uuid,
  p_recipient_name    text,
  p_phone             text,
  p_postcode          text,
  p_address           text,
  p_source_message_id uuid
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update customers
     set recipient_name = case when p_recipient_name is null then recipient_name
                               else nullif(btrim(p_recipient_name), '') end,
         phone          = case when p_phone is null then phone
                               else nullif(btrim(p_phone), '') end,
         postcode       = case when p_postcode is null then postcode
                               else nullif(btrim(p_postcode), '') end,
         address        = case when p_address is null then address
                               else nullif(btrim(p_address), '') end,
         contact_source_message_id = coalesce(p_source_message_id, contact_source_message_id),
         contact_updated_at = now(),
         contact_updated_by = p_admin_id
   where id = p_customer_id;
end
$$;

-- ---------------------------------------------------------------------------
--  4) index ที่หน้าห้องแชทใช้ดึงประวัติออเดอร์ของลูกค้าคนนี้ (ข้อ 1.11)
--
--  ไม่มี index นี้ = เปิดห้องแชททีต้องไล่อ่านตาราง orders ทั้งตาราง
--  ซึ่งจะช้าขึ้นเรื่อย ๆ ตามอายุร้าน แล้วจะโทษว่า "เน็ตช้า" แทน
-- ---------------------------------------------------------------------------
create index if not exists orders_customer_created_idx
  on orders (customer_id, created_at desc);

-- ---------------------------------------------------------------------------
--  5) ตรวจผล
-- ---------------------------------------------------------------------------
do $$
declare bad text[];
begin
  select array_agg(p.proname::text) into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f','p')
    and not exists (select 1 from pg_depend d
      where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e')
    and (p.proconfig is null or not exists (
      select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  if bad is not null then
    raise exception 'ยังมีฟังก์ชันของเราที่ไม่ได้ล็อก search_path: %', bad;
  end if;
end $$;

do $$
declare bad text[];
begin
  select array_agg(c.relname::text) into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;
  if bad is not null then
    raise exception 'ยังมีตารางที่ยังไม่เปิด RLS: %', bad;
  end if;
end $$;
