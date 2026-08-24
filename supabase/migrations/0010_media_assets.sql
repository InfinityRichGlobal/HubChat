-- ============================================================================
--  HubChat — 0010 : เก็บรูป/สลิปไว้เองอย่างถาวร (D-17)
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ของเดิมใน 0001-0009
--
--  🔴 ปัญหาที่แก้ :
--     รูปที่ลูกค้าส่งมาเก็บเป็น "ลิงก์ชั่วคราวของ Meta" ซึ่งหมดอายุ
--     พอหมดอายุแล้วเปิดดูย้อนหลังไม่ได้อีกเลย
--     สลิปโอนเงินคือหลักฐานการชำระเงิน — หายแล้วพิสูจน์อะไรไม่ได้
--     ต้องดาวน์โหลดมาเก็บเองทันทีที่ได้รับ ก่อนลิงก์จะหมดอายุ
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) media_assets — ทะเบียนไฟล์ทุกก้อนที่เราเก็บไว้เอง
--
--  ⭐ ทำไมต้องเป็นตารางแยก ไม่ใช่แค่คอลัมน์ใน messages :
--     • ไฟล์หนึ่งก้อนอาจถูกอ้างถึงจากหลายที่ (ข้อความ + สลิปของออเดอร์)
--     • ต้องรู้สถานะรายไฟล์ว่า "โหลดสำเร็จ / ล้มเหลว / ยังไม่ได้โหลด"
--     • เวลาไล่ปัญหา ต้องตอบได้ว่าไฟล์ไหนหายเพราะอะไร
-- ---------------------------------------------------------------------------
do $$ begin
  create type media_status_t as enum (
    'pending',  -- จองคิวไว้แล้ว กำลังโหลด
    'stored',   -- เก็บลงถังเรียบร้อย ✅
    'failed',   -- โหลดไม่สำเร็จแบบรู้สาเหตุ
    'expired',  -- ลิงก์ต้นทางหมดอายุก่อนที่เราจะโหลดทัน 🔴 กู้ไม่ได้
    'skipped'   -- ยังไม่ได้ตั้งค่า R2 จึงข้ามไปโดยตั้งใจ
  );
exception when duplicate_object then null; end $$;

create table if not exists media_assets (
  id             uuid primary key default gen_random_uuid(),

  -- ⭐ กุญแจกันโหลดซ้ำ : ข้อความหนึ่ง + ไฟล์แนบลำดับที่เท่าไหร่ = หนึ่งแถวเท่านั้น
  --    (ข้อความเดียวแนบมาหลายไฟล์ได้ จึงต้องมี attachment_index ด้วย)
  message_id       uuid references messages(id) on delete cascade,
  attachment_index integer not null default 0,

  conversation_id uuid references conversations(id) on delete set null,
  page_id         uuid references pages(id) on delete set null,

  -- ที่อยู่ในถังของเรา — null ตราบใดที่ยังโหลดไม่สำเร็จ
  storage_key    text,
  mime           text,
  bytes          integer,
  -- ลายนิ้วมือของไฟล์ ใช้ตรวจว่าเป็นไฟล์เดิมไหมโดยไม่ต้องโหลดมาเทียบ
  sha256         text,

  -- ⚠️ เก็บลิงก์เดิมของ Meta ไว้ด้วย เพื่อให้ไล่ปัญหาย้อนหลังได้
  --    แต่ห้ามใช้ลิงก์นี้แสดงผล เพราะมันหมดอายุ
  source_url     text,
  kind           text not null default 'inbound',  -- inbound / slip / outbound

  status         media_status_t not null default 'pending',
  error_text     text,

  claimed_at     timestamptz not null default now(),
  stored_at      timestamptz,
  created_at     timestamptz not null default now()
);

-- 🔴 บรรทัดนี้คือสิ่งที่กันการโหลดซ้ำจริง ๆ ไม่ใช่โค้ดฝั่ง JavaScript
create unique index if not exists media_message_attachment_uniq
  on media_assets (message_id, attachment_index)
  where message_id is not null;

create index if not exists media_status_idx on media_assets (status, created_at desc);
create index if not exists media_conv_idx   on media_assets (conversation_id, created_at desc);
create index if not exists media_key_idx    on media_assets (storage_key) where storage_key is not null;

-- ---------------------------------------------------------------------------
--  2) ⭐ claim_media — จองสิทธิ์โหลดไฟล์นี้
--
--  รูปแบบเดียวกับ claim_auto_reply ในรอบ 6 ซึ่งพิสูจน์แล้วว่าใช้ได้จริง :
--  insert ... on conflict do nothing returning  =  อะตอมมิก
--  worker สองตัวยิงพร้อมกัน มีตัวเดียวที่ได้แถวกลับมา
--
--  ทำไมต้องกัน : ถ้าไม่กัน webhook ที่เข้ามาซ้ำจะทำให้เราโหลดไฟล์เดิมหลายรอบ
--  เปลืองทั้งเวลาและโควตา และอาจโดน Meta จำกัดการเรียก
-- ---------------------------------------------------------------------------
create or replace function claim_media(
  p_message_id       uuid,
  p_attachment_index integer,
  p_conversation_id  uuid,
  p_page_id          uuid,
  p_source_url       text,
  p_kind             text
)
returns table (media_id uuid, won boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  insert into media_assets (
    message_id, attachment_index, conversation_id, page_id, source_url, kind, status
  ) values (
    p_message_id, coalesce(p_attachment_index, 0), p_conversation_id, p_page_id,
    p_source_url, coalesce(p_kind, 'inbound'), 'pending'
  )
  on conflict (message_id, attachment_index) where message_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    select m.id into v_id from media_assets m
    where m.message_id = p_message_id and m.attachment_index = coalesce(p_attachment_index, 0);
    return query select v_id, false;
    return;
  end if;

  return query select v_id, true;
end
$$;

-- ---------------------------------------------------------------------------
--  3) finish_media — จดผลของการโหลด (คำสั่งเดียว จดครึ่ง ๆ กลาง ๆ ไม่ได้)
--
--  ⭐ ตอนเก็บสำเร็จ จะไปอัปเดต attachments ของข้อความให้ชี้มาที่ไฟล์ของเราด้วย
--     เพื่อให้หน้าแชทเลิกใช้ลิงก์ที่หมดอายุได้ทันที
-- ---------------------------------------------------------------------------
create or replace function finish_media(
  p_media_id    uuid,
  p_status      media_status_t,
  p_storage_key text,
  p_mime        text,
  p_bytes       integer,
  p_sha256      text,
  p_error       text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row media_assets%rowtype;
begin
  update media_assets set
    status      = p_status,
    storage_key = p_storage_key,
    mime        = p_mime,
    bytes       = p_bytes,
    sha256      = p_sha256,
    error_text  = left(p_error, 1000),
    stored_at   = case when p_status = 'stored' then now() else stored_at end
  where id = p_media_id
  returning * into v_row;

  if not found then
    return;
  end if;

  -- ⭐ ผูกไฟล์เข้ากับข้อความ : เติม media_id ลงในไฟล์แนบลำดับนั้น
  --    ใช้ jsonb_set กับ index ตรง ๆ จึงไม่แตะไฟล์แนบก้อนอื่นของข้อความเดียวกัน
  if p_status = 'stored' and v_row.message_id is not null then
    update messages m set attachments = jsonb_set(
      m.attachments,
      array[v_row.attachment_index::text, 'media_id'],
      to_jsonb(p_media_id::text),
      true
    )
    where m.id = v_row.message_id
      and jsonb_typeof(m.attachments) = 'array'
      and jsonb_array_length(m.attachments) > v_row.attachment_index;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
--  4) orders.slip_media_id — ผูกสลิปกับไฟล์ที่เราเก็บเอง
--
--  ⚠️ ยังเก็บ slip_url เดิมไว้ ไม่ลบทิ้ง
--     ออเดอร์เก่าที่เคยใส่ลิงก์ไว้ต้องไม่หายไป แม้ลิงก์นั้นจะเปิดไม่ได้แล้ว
--     (ลบคอลัมน์ = ทำลายประวัติ ซึ่งเป็นสิ่งที่โปรเจกต์นี้ห้ามมาตลอด)
-- ---------------------------------------------------------------------------
alter table orders add column if not exists slip_media_id uuid references media_assets(id) on delete set null;
create index if not exists orders_slip_media_idx on orders (slip_media_id) where slip_media_id is not null;

-- ---------------------------------------------------------------------------
--  4b) update_order — รองรับ slip_media_id
--
--  ⚠️ ต้องเขียนทับฟังก์ชันจาก 0009 ทั้งตัว เพราะ plpgsql แก้ทีละบรรทัดไม่ได้
--     ส่วนอื่นเหมือนเดิมทุกประการ เพิ่มแค่ slip_media_id บรรทัดเดียว
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
    tracking_no        = v_after.tracking_no,
    shipped_at         = v_after.shipped_at,
    status             = v_after.status,
    closed_at          = case
                           when v_after.status in ('confirmed','paid','packed','shipped','completed')
                                and v_before.closed_at is null then now()
                           else v_after.closed_at
                         end,
    internal_note      = v_after.internal_note,
    updated_at         = now()
  where id = p_order_id
  returning * into v_after;

  insert into order_logs (order_id, admin_id, action, before, after)
  values (p_order_id, p_admin_id, 'updated', to_jsonb(v_before), to_jsonb(v_after));

  return v_after;
end
$$;

-- ---------------------------------------------------------------------------
--  5) เปิด RLS ให้ตารางใหม่ (บทเรียนจากรอบ 6 — เคยลืมมาแล้ว)
-- ---------------------------------------------------------------------------
alter table media_assets enable row level security;

-- ---------------------------------------------------------------------------
--  ตรวจผล : ฟังก์ชันต้องล็อก search_path ครบ + ทุกตารางต้องเปิด RLS
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
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if bad is not null then
    raise exception 'ยังมีตารางที่ไม่ได้เปิด RLS: %', bad;
  end if;
end $$;
