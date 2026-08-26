-- ============================================================================
--  HubChat — 0011 : นำเข้าเลขพัสดุ + แจ้งลูกค้า (สเปกหัวข้อ 5.8)
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ (idempotent) และไม่แก้ของเดิมใน 0001-0010
--
--  โครงกระดูกของตาราง tracking_imports / tracking_import_rows / courier_templates
--  มีมาตั้งแต่ 0001 แล้ว ไฟล์นี้เติม "ส่วนที่ต้องใช้ตอนทำงานจริง" :
--    • ร่องรอยการเปลี่ยนเลขพัสดุ (ห้ามทับของเดิมแบบเงียบ ๆ)
--    • การจองสิทธิ์ระดับฐานข้อมูล กันกดซ้ำ/สองเครื่องพร้อมกัน
--    • คิวแจ้งลูกค้าที่ "หนึ่งออเดอร์ต่อหนึ่งเหตุการณ์ ส่งได้ครั้งเดียวตลอดกาล"
--
--  🔴 หลักการที่ไฟล์นี้ยึด :
--     ตรรกะที่ "ผิดแล้วลูกค้าได้เลขพัสดุของคนอื่น" ต้องให้ฐานข้อมูลเป็นคนบังคับ
--     ไม่ใช่โค้ดฝั่งเซิร์ฟเวอร์ เพราะโค้ดมีหลายเส้นทาง แต่ฐานข้อมูลมีทางเดียว
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) ชนิดข้อมูลใหม่
--
--  ⚠️ สร้าง type ใหม่ ไม่ใช้ `alter type ... add value` กับของเดิมโดยตั้งใจ
--     การเพิ่มค่าใน enum เดิมรันซ้ำยาก และบางสภาพแวดล้อมห้ามทำใน transaction
-- ---------------------------------------------------------------------------
do $$ begin
  -- ผลของการ "เอาเลขพัสดุในไฟล์ไปใส่ออเดอร์จริง"
  create type tracking_apply_status_t as enum (
    'pending',   -- ยังไม่ได้ลง
    'applied',   -- ลงแล้ว (ใส่ใหม่ หรือทับของเดิมพร้อมจดร่องรอย)
    'noop',      -- ค่าเดิมเหมือนกันเป๊ะ ไม่ต้องแตะอะไร
    'skipped',   -- ตั้งใจข้าม (แอดมินสั่งข้าม / ออเดอร์ถูกยกเลิก / จับคู่ไม่ได้)
    'failed'     -- พยายามลงแล้วไม่สำเร็จ
  );
exception when duplicate_object then null; end $$;

do $$ begin
  -- สถานะของ "การแจ้งลูกค้าหนึ่งครั้ง"
  -- ⚠️ ต้องมี unknown แยกจาก failed : ยิงออกไปแล้วไม่รู้ผล ห้ามลองใหม่อัตโนมัติ
  create type fulfillment_notify_status_t as enum (
    'queued',    -- เข้าคิวแล้ว รอส่ง
    'claimed',   -- มีคนถือสิทธิ์ส่งอยู่ ห้ามใครหยิบซ้ำ
    'sent',      -- ส่งถึงลูกค้าแล้ว
    'blocked',   -- Policy Engine ไม่อนุญาต (นอกกรอบ 24 ชม. ฯลฯ)
    'failed',    -- ส่งไม่สำเร็จแบบรู้ผลชัดเจน
    'unknown',   -- 🔴 ยิงไปแล้วไม่รู้ผล — ห้ามส่งซ้ำอัตโนมัติเด็ดขาด
    'skipped'    -- ตั้งใจไม่ส่ง
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
--  2) ⭐ normalize เบอร์โทร — ต้องเป็นฟังก์ชันของฐานข้อมูล
--
--  ทำไมไม่ normalize แค่ฝั่ง TypeScript :
--    ต้องเทียบเบอร์ในไฟล์กับเบอร์ในตาราง orders ซึ่งเก็บมาแบบดิบ ๆ ตามที่แอดมินพิมพ์
--    ถ้า normalize แค่ฝั่งเดียว จะเทียบไม่ตรงตลอดกาล
--    ทำเป็นคอลัมน์ + index จึงค้นได้เร็วและตรงเสมอ
--
--  รองรับ : 0812345678 / 081-234-5678 / 081 234 5678 / 66812345678 / +66812345678
--  และเคส Excel กินเลข 0 หน้า → 812345678 (9 หลักขึ้นต้น 6/8/9 ให้เติม 0 คืน)
--
--  ⚠️ ต้องเป็น immutable เพราะเอาไปทำ index
-- ---------------------------------------------------------------------------
create or replace function normalize_phone_th(p_input text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text;
begin
  if p_input is null then return null; end if;

  -- เก็บเฉพาะตัวเลข ทิ้งขีด เว้นวรรค วงเล็บ เครื่องหมายบวก ทั้งหมด
  v := regexp_replace(p_input, '[^0-9]', '', 'g');
  if v = '' then return null; end if;

  -- รหัสประเทศไทย : 66xxxxxxxxx → 0xxxxxxxxx
  if length(v) = 11 and left(v, 2) = '66' then
    v := '0' || substring(v from 3);
  elsif length(v) = 12 and left(v, 3) = '660' then
    -- +66 0812345678 ที่พิมพ์เกินมา
    v := substring(v from 3);
  end if;

  -- Excel กินเลข 0 หน้า : 812345678 → 0812345678
  if length(v) = 9 and left(v, 1) in ('6','8','9') then
    v := '0' || v;
  end if;

  -- เบอร์ไทยที่ใช้ได้จริงคือ 9 หลัก (เบอร์บ้านเก่า) ถึง 10 หลัก
  if length(v) < 9 or length(v) > 10 then
    return null;
  end if;

  return v;
end
$$;

-- ---------------------------------------------------------------------------
--  3) orders — ร่องรอยของเลขพัสดุ
--
--  🔴 ข้อกำหนดสำคัญ : ห้ามทับเลขพัสดุเดิมแบบเงียบ ๆ
--     คอลัมน์พวกนี้ตอบคำถามว่า "เลขนี้มาจากไหน ใครใส่ ใส่เมื่อไหร่"
--     ส่วน "ค่าเดิมคืออะไร" อยู่ใน order_logs ซึ่งไม่มีใครลบได้จากหน้าเว็บ
-- ---------------------------------------------------------------------------
alter table orders add column if not exists delivered_at        timestamptz;
alter table orders add column if not exists tracking_source     text;   -- manual | import
alter table orders add column if not exists tracking_updated_by uuid references admins(id) on delete set null;
alter table orders add column if not exists tracking_updated_at timestamptz;
alter table orders add column if not exists phone_normalized    text;

-- เติมค่าให้แถวเดิมที่มีอยู่ก่อน (รันซ้ำได้ ไม่พัง)
update orders
   set phone_normalized = normalize_phone_th(phone)
 where phone is not null
   and phone_normalized is distinct from normalize_phone_th(phone);

-- ⭐ trigger : เบอร์เปลี่ยนเมื่อไหร่ ค่าที่ใช้เทียบต้องเปลี่ยนตามทันที
--    ถ้าปล่อยให้โค้ดเป็นคนเติม จะมีเส้นทางที่ลืมเติมแล้วจับคู่ไม่เจอแบบงง ๆ
create or replace function orders_sync_phone_normalized()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.phone_normalized := normalize_phone_th(new.phone);
  return new;
end
$$;

drop trigger if exists orders_phone_normalized_trg on orders;
create trigger orders_phone_normalized_trg
  before insert or update on orders
  for each row execute function orders_sync_phone_normalized();

create index if not exists orders_phone_norm_idx
  on orders (phone_normalized) where phone_normalized is not null;
create index if not exists orders_tracking_no_idx
  on orders (tracking_no) where tracking_no is not null;
create index if not exists orders_postcode_idx
  on orders (postcode) where postcode is not null;
create index if not exists orders_notify_status_idx
  on orders (tracking_notify_status) where tracking_notify_status is not null;

-- ---------------------------------------------------------------------------
--  4) tracking_imports — เพิ่มข้อมูลของ "รอบการนำเข้า"
-- ---------------------------------------------------------------------------
alter table tracking_imports add column if not exists courier_label   text;
alter table tracking_imports add column if not exists headers         jsonb not null default '[]'::jsonb;
alter table tracking_imports add column if not exists column_mapping  jsonb not null default '{}'::jsonb;
alter table tracking_imports add column if not exists notify_mode     text  not null default 'none'; -- none | prepare | send
alter table tracking_imports add column if not exists applied_count   integer not null default 0;
alter table tracking_imports add column if not exists noop_count      integer not null default 0;
alter table tracking_imports add column if not exists failed_count    integer not null default 0;
alter table tracking_imports add column if not exists skipped_count   integer not null default 0;
alter table tracking_imports add column if not exists queued_count    integer not null default 0;
alter table tracking_imports add column if not exists apply_started_at timestamptz;
alter table tracking_imports add column if not exists applied_by      uuid references admins(id) on delete set null;
alter table tracking_imports add column if not exists cancelled_at    timestamptz;
alter table tracking_imports add column if not exists error_th        text;
/**
 * ⭐ เก็บเนื้อไฟล์ดิบไว้ด้วย
 *    เหตุผลที่ 1 (ตรวจย้อนหลัง) : ต้องตอบได้ว่า "ไฟล์ที่นำเข้าวันนั้นหน้าตายังไง"
 *    เหตุผลที่ 2 (แก้การจับคู่คอลัมน์) : ถ้าระบบเดาคอลัมน์ผิด ต้องแก้แล้วแกะใหม่ได้
 *      โดยไม่ต้องให้เจ้าของร้านไปหาไฟล์เดิมมาอัปโหลดซ้ำ
 *    ⚠️ ไฟล์ขนส่งไม่มีข้อมูลอ่อนไหวเกินกว่าที่ตาราง orders มีอยู่แล้ว
 *       และมีเพดาน 5 MB ต่อไฟล์
 */
alter table tracking_imports add column if not exists raw_csv         text;

/**
 * ⭐ กัน import ไฟล์เดิมซ้ำ — แต่ต้อง "ยกเลิกแล้วอัปโหลดใหม่ได้"
 *
 * เดิมเป็น unique index บน file_hash ทั้งตาราง ซึ่งแปลว่า
 * ถ้าเผลอยกเลิกรอบหนึ่งไป จะอัปโหลดไฟล์เดิมอีกไม่ได้ตลอดกาล
 * เปลี่ยนเป็น partial index : รอบที่ถูกยกเลิกแล้ว "ปล่อยลายนิ้วมือคืน"
 */
drop index if exists tracking_imports_hash_uniq;
create unique index if not exists tracking_imports_hash_live_uniq
  on tracking_imports (file_hash) where status <> 'cancelled';

-- ---------------------------------------------------------------------------
--  5) tracking_import_rows — ผลรายแถว
-- ---------------------------------------------------------------------------
alter table tracking_import_rows add column if not exists row_index     integer not null default 0;
alter table tracking_import_rows add column if not exists row_hash      text;
alter table tracking_import_rows add column if not exists order_ref_raw text;
alter table tracking_import_rows add column if not exists carrier_raw   text;
alter table tracking_import_rows add column if not exists problems      jsonb not null default '[]'::jsonb;
alter table tracking_import_rows add column if not exists apply_status  tracking_apply_status_t not null default 'pending';
alter table tracking_import_rows add column if not exists applied_at    timestamptz;
alter table tracking_import_rows add column if not exists prev_tracking_no text;
alter table tracking_import_rows add column if not exists prev_carrier     text;
alter table tracking_import_rows add column if not exists prev_status      order_status_t;
alter table tracking_import_rows add column if not exists error_th      text;
alter table tracking_import_rows add column if not exists note_th       text;
alter table tracking_import_rows add column if not exists duplicate_of_row_id uuid references tracking_import_rows(id) on delete set null;

-- ⭐ แถวที่ n ของไฟล์หนึ่ง มีได้ครั้งเดียว — กัน parser ทำงานซ้ำแล้วแถวบานเป็นสองเท่า
create unique index if not exists tir_import_row_uniq
  on tracking_import_rows (import_id, row_index);
create index if not exists tir_apply_idx on tracking_import_rows (import_id, apply_status);
create index if not exists tir_order_idx on tracking_import_rows (matched_order_id) where matched_order_id is not null;

-- ---------------------------------------------------------------------------
--  6) ⭐ fulfillment_notifications — คิวแจ้งลูกค้า
--
--  🔴 หัวใจของรอบนี้อยู่ที่ index บรรทัดเดียว :
--       unique (order_id, event)
--     แปลว่า "หนึ่งออเดอร์ ต่อหนึ่งเหตุการณ์ มีการแจ้งได้ครั้งเดียวตลอดกาล"
--     ต่อให้ import ไฟล์เดิมซ้ำ กดยืนยันซ้ำ หรือมี worker สองตัว
--     ฐานข้อมูลจะยอมให้เกิดแถวเดียว — ลูกค้าจึงไม่มีทางได้ข้อความซ้ำ
--
--  ⚠️ ตารางนี้ไม่ใช่ "ประวัติการส่ง" (นั่นคือ send_attempts / message_sends)
--     ตารางนี้คือ "เจตนาจะแจ้ง 1 ครั้ง" และผลสุดท้ายของเจตนานั้น
-- ---------------------------------------------------------------------------
create table if not exists fulfillment_notifications (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders(id) on delete cascade,
  -- เหตุการณ์ เช่น 'shipping_update' — เผื่ออนาคตมี 'delivered' ฯลฯ
  event              text not null default 'shipping_update',

  import_id          uuid references tracking_imports(id) on delete set null,
  import_row_id      uuid references tracking_import_rows(id) on delete set null,
  conversation_id    uuid references conversations(id) on delete set null,
  page_id            uuid references pages(id) on delete set null,

  status             fulfillment_notify_status_t not null default 'queued',

  -- สำเนาค่าที่ใช้ประกอบข้อความ ณ ตอนเข้าคิว
  -- ⭐ ต้องเก็บสำเนา เพราะออเดอร์แก้ได้ตลอด แต่เราต้องตอบได้ว่า "ส่งอะไรออกไป"
  payload            jsonb not null default '{}'::jsonb,
  message_text       text,

  policy_reason_code text,
  policy_reason_th   text,
  selected_transport transport_t,
  message_send_id    uuid,
  meta_message_id    text,
  fbtrace_id         text,
  outcome_unknown    boolean not null default false,
  error_text         text,

  approved_by        uuid references admins(id) on delete set null,
  attempt_count      integer not null default 0,
  created_at         timestamptz not null default now(),
  claimed_at         timestamptz,
  finished_at        timestamptz
);

create unique index if not exists fulfillment_notify_order_event_uniq
  on fulfillment_notifications (order_id, event);
create index if not exists fulfillment_notify_status_idx
  on fulfillment_notifications (status, created_at);
create index if not exists fulfillment_notify_import_idx
  on fulfillment_notifications (import_id, status);

alter table fulfillment_notifications enable row level security;

-- ---------------------------------------------------------------------------
--  7) ⭐ claim_tracking_import_apply — กันกดยืนยันซ้ำ
--
--  double-click / เปิดสองแท็บ / เน็ตช้าแล้วกดใหม่ = คำขอสองอัน
--  ตัวนี้ทำให้มีแค่อันเดียวที่ได้ทำงาน อีกอันได้ won = false แล้วจบ
-- ---------------------------------------------------------------------------
create or replace function claim_tracking_import_apply(
  p_import_id uuid,
  p_admin_id  uuid
)
returns table (won boolean, current_status import_status_t)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_status import_status_t;
begin
  -- อัปเดตแบบมีเงื่อนไข = อะตอมมิกในตัวเอง ไม่ต้อง select ก่อน
  update tracking_imports
     set apply_started_at = now(),
         applied_by       = p_admin_id
   where id = p_import_id
     and status = 'review'
     and apply_started_at is null
  returning id into v_id;

  select t.status into v_status from tracking_imports t where t.id = p_import_id;

  if v_status is null then
    -- ไม่มีรอบนำเข้านี้จริง ๆ — ต้องแยกจาก "มีคนกำลังทำอยู่" ไม่งั้นข้อความจะหลอก
    raise exception 'ไม่พบรอบนำเข้านี้';
  end if;

  if v_id is null then
    return query select false, v_status;
  else
    return query select true, v_status;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
--  8) ⭐ apply_tracking_row — เอาเลขพัสดุของแถวหนึ่งไปใส่ออเดอร์จริง
--
--  🔴 นี่คือจุดที่ "ผิดแล้วลูกค้าได้เลขของคนอื่น" จึงต้องอยู่ในฐานข้อมูล
--
--  กฎการทับค่า (ตามที่ตกลงไว้) :
--    • ค่าเดิมว่าง            → ใส่ค่าใหม่           → applied
--    • ค่าเดิมเหมือนกันเป๊ะ    → ไม่แตะอะไรเลย        → noop
--    • ค่าเดิมต่าง            → ทับ + จดค่าเดิมไว้    → applied (มีร่องรอยเสมอ)
--    • ออเดอร์ถูกยกเลิก/ตีกลับ → ไม่แตะ              → skipped
--    • ไม่มีเลขพัสดุ/ไม่จับคู่  → ไม่แตะ              → skipped
--
--  ⚠️ ล็อกแถวออเดอร์ด้วย for update ก่อนตัดสินใจเสมอ
--     ไม่งั้นสองรอบนำเข้าที่ชนกันจะอ่านค่าเดิมพร้อมกันแล้วทับกันเอง
--
--  ⚠️ แถวที่ apply แล้วจะไม่ถูกทำซ้ำ (เช็ค apply_status = 'pending')
--     นี่คือชั้นกันซ้ำระดับแถว ทำงานร่วมกับ unique (import_id,row_index)
-- ---------------------------------------------------------------------------
create or replace function apply_tracking_row(
  p_row_id   uuid,
  p_admin_id uuid
)
returns table (outcome tracking_apply_status_t, order_id uuid, note_th text)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_row     tracking_import_rows%rowtype;
  v_before  orders%rowtype;
  v_after   orders%rowtype;
  v_carrier text;
  v_note    text;
begin
  -- ⭐ ล็อกแถวของไฟล์ก่อน แล้วเช็คว่ายังไม่เคยทำ
  select * into v_row from tracking_import_rows where id = p_row_id for update;
  if not found then
    return query select 'failed'::tracking_apply_status_t, null::uuid, 'ไม่พบแถวนี้ในรอบนำเข้า'::text;
    return;
  end if;

  if v_row.apply_status <> 'pending' then
    -- ทำไปแล้ว — คืนผลเดิม ไม่ทำซ้ำ (กดยืนยันซ้ำจึงไม่เปลี่ยนอะไร)
    return query select v_row.apply_status, v_row.matched_order_id, coalesce(v_row.note_th, 'แถวนี้ถูกดำเนินการไปแล้ว')::text;
    return;
  end if;

  -- ---- ด่านที่ 1 : ต้องจับคู่ได้และต้องมีเลขพัสดุ ------------------------
  if v_row.matched_order_id is null then
    update tracking_import_rows
       set apply_status = 'skipped', applied_at = now(),
           note_th = 'ยังจับคู่ออเดอร์ไม่ได้'
     where id = p_row_id;
    return query select 'skipped'::tracking_apply_status_t, null::uuid, 'ยังจับคู่ออเดอร์ไม่ได้'::text;
    return;
  end if;

  if v_row.tracking_no is null or btrim(v_row.tracking_no) = '' then
    update tracking_import_rows
       set apply_status = 'skipped', applied_at = now(),
           note_th = 'แถวนี้ไม่มีเลขพัสดุ'
     where id = p_row_id;
    return query select 'skipped'::tracking_apply_status_t, v_row.matched_order_id, 'แถวนี้ไม่มีเลขพัสดุ'::text;
    return;
  end if;

  if v_row.match_status = 'skipped' then
    update tracking_import_rows
       set apply_status = 'skipped', applied_at = now(),
           note_th = coalesce(v_row.note_th, 'แอดมินสั่งข้ามแถวนี้')
     where id = p_row_id;
    return query select 'skipped'::tracking_apply_status_t, v_row.matched_order_id, 'แอดมินสั่งข้ามแถวนี้'::text;
    return;
  end if;

  -- ---- ด่านที่ 2 : ล็อกออเดอร์แล้วดูค่าเดิม ------------------------------
  select * into v_before from orders where id = v_row.matched_order_id for update;
  if not found then
    update tracking_import_rows
       set apply_status = 'failed', applied_at = now(), error_th = 'ไม่พบออเดอร์ที่จับคู่ไว้'
     where id = p_row_id;
    return query select 'failed'::tracking_apply_status_t, v_row.matched_order_id, 'ไม่พบออเดอร์ที่จับคู่ไว้'::text;
    return;
  end if;

  if v_before.status in ('cancelled','returned') then
    update tracking_import_rows
       set apply_status = 'skipped', applied_at = now(),
           prev_tracking_no = v_before.tracking_no,
           prev_carrier     = v_before.shipping_carrier,
           prev_status      = v_before.status,
           note_th = 'ออเดอร์นี้ถูกยกเลิก/ตีกลับแล้ว จึงไม่ใส่เลขพัสดุให้'
     where id = p_row_id;
    return query select 'skipped'::tracking_apply_status_t, v_before.id,
                        'ออเดอร์นี้ถูกยกเลิก/ตีกลับแล้ว จึงไม่ใส่เลขพัสดุให้'::text;
    return;
  end if;

  v_carrier := coalesce(nullif(btrim(coalesce(v_row.carrier_raw, '')), ''), v_before.shipping_carrier);

  -- ---- ด่านที่ 3 : ค่าเดิมเหมือนกันเป๊ะ = ไม่ต้องทำอะไร -------------------
  if v_before.tracking_no is not null
     and btrim(v_before.tracking_no) = btrim(v_row.tracking_no)
     and coalesce(v_before.shipping_carrier,'') = coalesce(v_carrier,'')
  then
    update tracking_import_rows
       set apply_status = 'noop', applied_at = now(),
           prev_tracking_no = v_before.tracking_no,
           prev_carrier     = v_before.shipping_carrier,
           prev_status      = v_before.status,
           note_th = 'เลขพัสดุตรงกับของเดิมอยู่แล้ว'
     where id = p_row_id;
    return query select 'noop'::tracking_apply_status_t, v_before.id, 'เลขพัสดุตรงกับของเดิมอยู่แล้ว'::text;
    return;
  end if;

  -- ---- ด่านที่ 4 : ลงค่าจริง + จดร่องรอย ---------------------------------
  v_note := case
    when v_before.tracking_no is null or btrim(v_before.tracking_no) = ''
      then 'ใส่เลขพัสดุใหม่'
    else 'เปลี่ยนเลขพัสดุจาก ' || v_before.tracking_no || ' เป็น ' || btrim(v_row.tracking_no)
  end;

  update orders set
    tracking_no         = btrim(v_row.tracking_no),
    shipping_carrier    = v_carrier,
    shipped_at          = coalesce(v_before.shipped_at, now()),
    tracking_import_id  = v_row.import_id,
    tracking_source     = 'import',
    tracking_updated_by = p_admin_id,
    tracking_updated_at = now(),
    -- ใส่เลขพัสดุ = ของออกจากร้านแล้ว แต่ถ้าเลยขั้นนั้นไปแล้วห้ามถอยสถานะกลับ
    status = case
               when v_before.status in ('draft','confirmed','paid','packed') then 'shipped'::order_status_t
               else v_before.status
             end,
    closed_at = coalesce(v_before.closed_at, now()),
    updated_at = now()
  where id = v_before.id
  returning * into v_after;

  -- ⭐ ประวัติต้องเกิดในคำสั่งเดียวกับการแก้ ไม่งั้นมีจังหวะที่แก้แล้วไม่มีร่องรอย
  insert into order_logs (order_id, admin_id, action, before, after)
  values (v_before.id, p_admin_id, 'tracking_import', to_jsonb(v_before), to_jsonb(v_after));

  update tracking_import_rows
     set apply_status = 'applied', applied_at = now(),
         prev_tracking_no = v_before.tracking_no,
         prev_carrier     = v_before.shipping_carrier,
         prev_status      = v_before.status,
         note_th = v_note
   where id = p_row_id;

  return query select 'applied'::tracking_apply_status_t, v_before.id, v_note;
end
$$;

-- ---------------------------------------------------------------------------
--  9) ⭐ queue_fulfillment_notification — เข้าคิวแจ้งลูกค้า "หนึ่งครั้งตลอดกาล"
--
--  insert ... on conflict do nothing คือหัวใจ
--  ยิงพร้อมกันสิบครั้ง ก็ได้แถวเดียว และมีคนเดียวที่ได้ created = true
-- ---------------------------------------------------------------------------
create or replace function queue_fulfillment_notification(
  p_order_id      uuid,
  p_event         text,
  p_import_id     uuid,
  p_import_row_id uuid,
  p_payload       jsonb,
  p_admin_id      uuid
)
returns table (notification_id uuid, created boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_order orders%rowtype;
  v_id    uuid;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    return query select null::uuid, false;
    return;
  end if;

  insert into fulfillment_notifications (
    order_id, event, import_id, import_row_id,
    conversation_id, page_id, payload, approved_by, status
  ) values (
    p_order_id, coalesce(p_event, 'shipping_update'), p_import_id, p_import_row_id,
    v_order.conversation_id, v_order.page_id, coalesce(p_payload, '{}'::jsonb), p_admin_id, 'queued'
  )
  on conflict (order_id, event) do nothing
  returning id into v_id;

  if v_id is null then
    select f.id into v_id
      from fulfillment_notifications f
     where f.order_id = p_order_id and f.event = coalesce(p_event, 'shipping_update');
    return query select v_id, false;
    return;
  end if;

  -- ออเดอร์ต้องรู้ตัวว่ามีคิวแจ้งค้างอยู่ (สเปก 5.8 : tracking_notify_status)
  update orders
     set tracking_notify_status    = 'pending',
         tracking_notify_reason_th = null
   where id = p_order_id
     and tracking_notified_at is null;

  return query select v_id, true;
end
$$;

-- ---------------------------------------------------------------------------
-- 10) ⭐ claim_fulfillment_notification — จองสิทธิ์ส่งก่อนยิงจริง
--
--     เปลี่ยนสถานะ queued → claimed ด้วย update แบบมีเงื่อนไข
--     ใครได้แถวกลับมา คนนั้นเท่านั้นที่ยิงได้
--
--     ⚠️ ห้ามหยิบแถวที่เป็น unknown กลับมาส่งใหม่เด็ดขาด
--        (เงื่อนไข status = 'queued' ตัดออกให้อยู่แล้ว — เขียนย้ำไว้กันคนเผลอแก้)
-- ---------------------------------------------------------------------------
create or replace function claim_fulfillment_notification(p_notification_id uuid)
returns table (won boolean, order_id uuid, conversation_id uuid, payload jsonb)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_row fulfillment_notifications%rowtype;
begin
  update fulfillment_notifications
     set status        = 'claimed',
         claimed_at    = now(),
         attempt_count = attempt_count + 1
   where id = p_notification_id
     and status = 'queued'
  returning * into v_row;

  if v_row.id is null then
    return query select false, null::uuid, null::uuid, '{}'::jsonb;
    return;
  end if;

  return query select true, v_row.order_id, v_row.conversation_id, v_row.payload;
end
$$;

-- ---------------------------------------------------------------------------
-- 11) finish_fulfillment_notification — จดผล + อัปเดตออเดอร์ในคำสั่งเดียว
--
--     ⚠️ tracking_notified_at ตั้งค่าเฉพาะตอน 'sent' หรือ 'unknown'
--        'unknown' ก็ต้องตั้งด้วย เพราะข้อความอาจถึงลูกค้าไปแล้ว
--        ถ้าไม่ตั้ง ระบบจะคิดว่ายังไม่เคยแจ้ง แล้วมีโอกาสส่งซ้ำ
-- ---------------------------------------------------------------------------
create or replace function finish_fulfillment_notification(
  p_notification_id  uuid,
  p_status           fulfillment_notify_status_t,
  p_message_text     text,
  p_reason_code      text,
  p_reason_th        text,
  p_transport        transport_t,
  p_message_send_id  uuid,
  p_meta_message_id  text,
  p_fbtrace_id       text,
  p_outcome_unknown  boolean,
  p_error_text       text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
begin
  update fulfillment_notifications set
    status             = p_status,
    message_text       = coalesce(p_message_text, message_text),
    policy_reason_code = p_reason_code,
    policy_reason_th   = p_reason_th,
    selected_transport = p_transport,
    message_send_id    = p_message_send_id,
    meta_message_id    = p_meta_message_id,
    fbtrace_id         = p_fbtrace_id,
    outcome_unknown    = coalesce(p_outcome_unknown, false),
    error_text         = left(p_error_text, 1000),
    finished_at        = now()
  where id = p_notification_id
  returning order_id into v_order_id;

  if v_order_id is null then return; end if;

  update orders set
    tracking_notified_at = case
                             when p_status in ('sent','unknown') then coalesce(tracking_notified_at, now())
                             else tracking_notified_at
                           end,
    tracking_notify_status = case p_status
                               when 'sent'    then 'sent'::notify_status_t
                               when 'blocked' then 'blocked'::notify_status_t
                               when 'skipped' then 'skipped'::notify_status_t
                               when 'unknown' then 'sent'::notify_status_t   -- ถือว่าแจ้งแล้ว ห้ามส่งซ้ำ
                               else 'pending'::notify_status_t
                             end,
    tracking_notify_reason_th = p_reason_th,
    updated_at = now()
  where id = v_order_id;
end
$$;

-- ---------------------------------------------------------------------------
-- 12) ⭐ apply_tracking_import — ลงทั้งรอบในคำสั่งเดียว
--
--     ทำเป็นฟังก์ชันเดียวเพราะต้องการ "ลงทั้งหมดหรือไม่ลงเลย" ในเชิงร่องรอย
--     ถ้าปล่อยให้ TypeScript วนเรียกทีละแถว เน็ตหลุดกลางทาง = ครึ่ง ๆ กลาง ๆ
--     และตัวเลขสรุปจะไม่ตรงกับของจริง
--
--     partial failure ยังเกิดได้ในระดับ "แถว" (บางแถว skipped/failed)
--     ซึ่งเป็นสิ่งที่ต้องการ — แถวที่ดีต้องสำเร็จ แถวที่เสียต้องรายงานชัด
-- ---------------------------------------------------------------------------
create or replace function apply_tracking_import(
  p_import_id uuid,
  p_admin_id  uuid,
  p_notify    boolean
)
returns table (
  applied_count integer,
  noop_count    integer,
  skipped_count integer,
  failed_count  integer,
  queued_count  integer
)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_row      record;
  v_res      record;
  v_applied  integer := 0;
  v_noop     integer := 0;
  v_skipped  integer := 0;
  v_failed   integer := 0;
  v_queued   integer := 0;
  v_q        record;
  v_order    orders%rowtype;
begin
  -- เรียงตาม row_index เสมอ → ผลลัพธ์เหมือนเดิมทุกครั้งที่รัน (deterministic)
  for v_row in
    select id from tracking_import_rows
     where import_id = p_import_id
     order by row_index asc
  loop
    select * into v_res from apply_tracking_row(v_row.id, p_admin_id);

    if    v_res.outcome = 'applied' then v_applied := v_applied + 1;
    elsif v_res.outcome = 'noop'    then v_noop    := v_noop    + 1;
    elsif v_res.outcome = 'skipped' then v_skipped := v_skipped + 1;
    else                                 v_failed  := v_failed  + 1;
    end if;

    -- ---- เข้าคิวแจ้งลูกค้า (ถ้าสั่งไว้) ------------------------------------
    -- แจ้งได้เฉพาะออเดอร์ที่มีเลขพัสดุจริงและยังไม่เคยแจ้ง
    -- ส่วน "ห้ามซ้ำ" มี unique (order_id,event) เป็นคนบังคับอีกชั้น
    if p_notify and v_res.order_id is not null and v_res.outcome in ('applied','noop') then
      select * into v_order from orders where id = v_res.order_id;
      if v_order.tracking_no is not null
         and v_order.tracking_notified_at is null
         and v_order.conversation_id is not null
         and v_order.status not in ('cancelled','returned')
      then
        select * into v_q from queue_fulfillment_notification(
          v_res.order_id,
          'shipping_update',
          p_import_id,
          v_row.id,
          jsonb_build_object(
            'order_no',      v_order.order_no,
            'recipient',     v_order.recipient_name,
            'tracking_no',   v_order.tracking_no,
            'carrier',       v_order.shipping_carrier
          ),
          p_admin_id
        );
        if v_q.created then v_queued := v_queued + 1; end if;
      end if;
    end if;
  end loop;

  update tracking_imports set
    status        = 'applied',
    applied_at    = now(),
    applied_by    = coalesce(applied_by, p_admin_id),
    applied_count = v_applied,
    noop_count    = v_noop,
    skipped_count = v_skipped,
    failed_count  = v_failed,
    queued_count  = v_queued
  where id = p_import_id;

  return query select v_applied, v_noop, v_skipped, v_failed, v_queued;
end
$$;

-- ---------------------------------------------------------------------------
-- 13) set_order_tracking_manual — แอดมินใส่เลขพัสดุเองทีละใบ
--
--     ต้องเดินเส้นทางเดียวกับการนำเข้าไฟล์ เพื่อให้ร่องรอยหน้าตาเหมือนกัน
--     (ถ้าปล่อยให้ update_order แก้ tracking_no ตรง ๆ จะไม่มี tracking_source/updated_by)
-- ---------------------------------------------------------------------------
create or replace function set_order_tracking_manual(
  p_order_id    uuid,
  p_admin_id    uuid,
  p_tracking_no text,
  p_carrier     text
)
returns orders
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before orders%rowtype;
  v_after  orders%rowtype;
begin
  select * into v_before from orders where id = p_order_id for update;
  if not found then
    raise exception 'ไม่พบออเดอร์นี้';
  end if;

  update orders set
    tracking_no         = nullif(btrim(coalesce(p_tracking_no, '')), ''),
    shipping_carrier    = coalesce(nullif(btrim(coalesce(p_carrier,'')), ''), v_before.shipping_carrier),
    shipped_at          = case
                            when nullif(btrim(coalesce(p_tracking_no,'')),'') is not null
                              then coalesce(v_before.shipped_at, now())
                            else v_before.shipped_at
                          end,
    tracking_source     = 'manual',
    tracking_updated_by = p_admin_id,
    tracking_updated_at = now(),
    status = case
               when nullif(btrim(coalesce(p_tracking_no,'')),'') is not null
                    and v_before.status in ('draft','confirmed','paid','packed')
                 then 'shipped'::order_status_t
               else v_before.status
             end,
    updated_at = now()
  where id = p_order_id
  returning * into v_after;

  insert into order_logs (order_id, admin_id, action, before, after)
  values (p_order_id, p_admin_id, 'tracking_manual', to_jsonb(v_before), to_jsonb(v_after));

  return v_after;
end
$$;

-- ---------------------------------------------------------------------------
-- 15) ⭐ ปิดประตูสุดท้าย : update_order ต้องแตะเลขพัสดุไม่ได้
--
--  🔴 ชุดทดสอบจับได้ว่า TypeScript กันได้แค่ตอนคอมไพล์
--     ถ้าวันหนึ่งมี route ที่ zod หลวมกว่านี้ หรือมีคนเรียกฟังก์ชันตรง ๆ
--     patch ที่มี tracking_no จะทับค่าเดิมได้แบบไม่มีร่องรอย
--
--     กฎที่ "ผิดแล้วลูกค้าได้เลขของคนอื่น" ต้องให้ฐานข้อมูลบังคับ ไม่ใช่ชนิดข้อมูล
--     ฟังก์ชันนี้จึงเขียนทับของเดิมจาก 0008 โดยปักหมุดคอลัมน์ทั้งกลุ่มไว้กับค่าเดิม
-- ---------------------------------------------------------------------------
create or replace function update_order(
  p_order_id uuid,
  p_admin_id uuid,
  p_patch    jsonb
)
returns orders
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before orders%rowtype;
  v_after  orders%rowtype;
  v_ship   shipping_methods%rowtype;
begin
  select * into v_before from orders where id = p_order_id;
  if not found then
    raise exception 'ไม่พบออเดอร์นี้';
  end if;

  select * into v_after from jsonb_populate_record(v_before, p_patch);

  if v_after.shipping_method_id is distinct from v_before.shipping_method_id
     and v_after.shipping_method_id is not null then
    select * into v_ship from shipping_methods where id = v_after.shipping_method_id;
    if not found then
      raise exception 'ไม่พบวิธีจัดส่งนี้';
    end if;
    v_after.shipping_snapshot := jsonb_build_object(
      'id', v_ship.id, 'name', v_ship.name, 'fee', v_ship.fee,
      'cod_supported', v_ship.cod_supported, 'taken_at', now()
    );
  end if;

  if v_after.payment_method = 'cod'
     and v_after.shipping_snapshot ? 'cod_supported'
     and (v_after.shipping_snapshot ->> 'cod_supported')::boolean is false then
    raise exception 'วิธีจัดส่งของออเดอร์นี้ไม่รองรับเก็บเงินปลายทาง';
  end if;

  update orders set
    recipient_name     = v_after.recipient_name,
    phone              = v_after.phone,
    address            = v_after.address,
    postcode           = v_after.postcode,
    items              = v_after.items,
    subtotal           = v_after.subtotal,
    shipping_fee       = v_after.shipping_fee,
    discount           = v_after.discount,
    total              = v_after.total,
    payment_method     = v_after.payment_method,
    payment_status     = v_after.payment_status,
    slip_url           = v_after.slip_url,
    slip_media_id      = v_after.slip_media_id,
    paid_at            = case
                           when v_after.payment_status = 'paid' and v_before.paid_at is null then now()
                           else v_after.paid_at
                         end,
    shipping_carrier   = v_after.shipping_carrier,
    shipping_method_id = v_after.shipping_method_id,
    shipping_snapshot  = v_after.shipping_snapshot,
    -- 🔴 รอบ 8 : เลขพัสดุและร่องรอยของมัน "แก้ผ่านทางนี้ไม่ได้"
    --    ต่อให้มีใครยัด tracking_no มาใน patch ก็จะถูกเมิน
    --    ต้องผ่าน set_order_tracking_manual() หรือ apply_tracking_row() เท่านั้น
    --    เพราะสองตัวนั้นจดเสมอว่า "ใครใส่ เมื่อไหร่ มาจากไฟล์ไหน ค่าเดิมคืออะไร"
    tracking_no        = v_before.tracking_no,
    shipped_at         = v_before.shipped_at,
    status             = v_after.status,
    closed_at          = case
                           when v_after.status in ('confirmed','paid','packed','shipped','completed')
                                and v_before.closed_at is null then now()
                           else v_after.closed_at
                         end,
    internal_note      = v_after.internal_note,
    -- ปักหมุดคอลัมน์ร่องรอยของเลขพัสดุไว้กับค่าเดิมทั้งกลุ่ม
    -- ⚠️ tracking_notified_at สำคัญเป็นพิเศษ : ถ้าปลอมค่านี้ได้ จะข้ามด่านกันแจ้งซ้ำได้ทันที
    delivered_at              = v_before.delivered_at,
    tracking_source           = v_before.tracking_source,
    tracking_updated_by       = v_before.tracking_updated_by,
    tracking_updated_at       = v_before.tracking_updated_at,
    tracking_import_id        = v_before.tracking_import_id,
    tracking_notified_at      = v_before.tracking_notified_at,
    tracking_notify_status    = v_before.tracking_notify_status,
    tracking_notify_reason_th = v_before.tracking_notify_reason_th,
    updated_at         = now()
  where id = p_order_id
  returning * into v_after;

  insert into order_logs (order_id, admin_id, action, before, after)
  values (p_order_id, p_admin_id, 'updated', to_jsonb(v_before), to_jsonb(v_after));

  return v_after;
end
$$;

-- ---------------------------------------------------------------------------
-- 17) ⭐ expire_stale_notification_claims — กันงานค้างสถานะ "กำลังส่ง" ตลอดกาล
--
--  🔴 ปัญหาที่แก้ :
--     ถ้าโปรเซสตายระหว่าง claim กับ finish (คำขอถูกตัดกลางทาง / เครื่องรีสตาร์ต)
--     แถวนั้นจะค้างที่ 'claimed' ตลอดไป ไม่มีใครหยิบได้อีกเลย
--     เจ้าของร้านจะเห็น "กำลังส่ง" ค้างอยู่ และไม่มีทางสั่งอะไรได้
--
--  ⚠️ ทางแก้ที่ "ห้ามทำ" คือดึงกลับไปเป็น queued แล้วส่งใหม่
--     เพราะข้อความอาจยิงออกไปแล้วจริง ๆ ก่อนโปรเซสตาย → ลูกค้าได้ซ้ำ
--
--  ⭐ จึงเลือกทางที่ปลอดภัยกว่า : ยกให้เป็น unknown (ไม่ทราบผล)
--     • ถือว่า "แจ้งแล้ว" เพื่อไม่ให้รอบไหนหยิบไปส่งซ้ำ (ยอมส่งขาด ดีกว่าส่งซ้ำ)
--     • เจ้าของร้านเห็นสถานะชัดเจน และมีทางออก :
--       เปิด Messenger ดูก่อน แล้วติ๊กยอมรับความเสี่ยงเพื่อส่งซ้ำได้
-- ---------------------------------------------------------------------------
create or replace function expire_stale_notification_claims(p_older_than_seconds integer)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  v_row   record;
begin
  for v_row in
    update fulfillment_notifications
       set status           = 'unknown',
           outcome_unknown  = true,
           policy_reason_th = 'งานส่งค้างกลางทางจนหมดเวลา — ไม่ทราบว่าข้อความถึงลูกค้าหรือไม่',
           error_text       = 'claim ค้างเกิน ' || p_older_than_seconds || ' วินาที',
           finished_at      = now()
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => greatest(p_older_than_seconds, 60))
    returning order_id
  loop
    v_count := v_count + 1;
    update orders
       set tracking_notified_at      = coalesce(tracking_notified_at, now()),
           tracking_notify_status    = 'sent',
           tracking_notify_reason_th = 'ไม่ทราบผลการส่ง (งานค้างกลางทาง) — ตรวจใน Messenger ก่อนส่งซ้ำ'
     where id = v_row.order_id;
  end loop;

  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- 18) ตรวจผล — ต้องผ่านทั้งสองข้อ ไม่งั้น migration ล้มทันที
-- ---------------------------------------------------------------------------
do $$
declare bad text[];
begin
  select array_agg(p.proname::text) into bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f','p')
    and not exists (
      select 1 from pg_depend d
      where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
    )
    and (p.proconfig is null or not exists (
      select 1 from unnest(p.proconfig) c where c like 'search_path=%'
    ));
  if bad is not null then
    raise exception 'ยังมีฟังก์ชันของเราที่ไม่ได้ล็อก search_path: %', bad;
  end if;
end $$;

do $$
declare bad text[];
begin
  select array_agg(c.relname::text) into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity = false;
  if bad is not null then
    raise exception 'ยังมีตารางที่ยังไม่เปิด RLS: %', bad;
  end if;
end $$;
