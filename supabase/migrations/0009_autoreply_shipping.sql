-- ============================================================================
--  HubChat — 0009 : ตอบอัตโนมัติด้วยคีย์เวิร์ด + วิธีจัดส่ง + เก็บปลายทางสินค้า
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ของเดิมใน 0001-0008
--
--  🔴 ไฟล์นี้คือรอบแรกที่ระบบ "ส่งข้อความเองโดยไม่มีคนกด"
--     ทุกอย่างในนี้จึงออกแบบโดยถือว่า "ตอบซ้ำ = ความเสียหายที่กู้ไม่ได้"
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) keyword_rules — เติมช่องที่ต้องใช้ตอนใช้งานจริง
--
--  ตารางมีมาตั้งแต่ 0001 แล้ว แต่ขาดของที่จำเป็นสามอย่าง :
--    • ประวัติว่าใครสร้าง/ใครแก้ (กฎพวกนี้ส่งข้อความหาลูกค้าจริง ต้องรู้ว่าใครทำ)
--    • version — เอาไว้บอกว่าตอนตอบไปใช้กฎ "หน้าตาแบบไหน"
--      ถ้าแอดมินแก้กฎทีหลัง เราต้องยังตอบได้ว่าตอนนั้นใช้ข้อความอะไร
--    • archived_at — กฎที่เคยตอบลูกค้าไปแล้ว ลบทิ้งไม่ได้
--      เพราะ execution log อ้างถึงอยู่ ต้องเก็บเข้ากรุแทน
-- ---------------------------------------------------------------------------
alter table keyword_rules add column if not exists updated_at  timestamptz not null default now();
alter table keyword_rules add column if not exists created_by  uuid references admins(id) on delete set null;
alter table keyword_rules add column if not exists updated_by  uuid references admins(id) on delete set null;
alter table keyword_rules add column if not exists archived_at timestamptz;
alter table keyword_rules add column if not exists version     integer not null default 1;

-- กฎที่ถูกเก็บเข้ากรุแล้ว ต้องไม่ถูกหยิบมาใช้อีก แม้ is_active จะยังเป็น true
create index if not exists keyword_rules_live_idx
  on keyword_rules (priority, created_at)
  where is_active and archived_at is null;

-- ---------------------------------------------------------------------------
--  2) ⭐ auto_reply_executions — ทะเบียน "การตอบอัตโนมัติหนึ่งครั้ง"
--
--  🔴 หัวใจของรอบนี้อยู่ที่ unique index บน message_id
--
--  ทำไมการกันซ้ำที่ชั้น messages อย่างเดียวไม่พอ :
--    ชั้น messages กันได้แค่ "ข้อความเดียวกันถูกบันทึกสองครั้ง"
--    แต่เคสที่น่ากลัวกว่าคือ worker บันทึกข้อความสำเร็จ แล้วตายก่อนส่ง
--    พอมีคนกดประมวลผลใหม่ ข้อความนั้นจะกลายเป็น "ซ้ำ" แล้วถูกข้าม
--    → ลูกค้าไม่เคยได้รับคำตอบเลย
--    หรือกลับกัน ถ้าเราไม่กันตรงนี้ worker สองตัวที่ทำงานพร้อมกัน
--    จะตอบลูกค้าคนเดียวกันสองครั้ง ซึ่งลูกค้าเห็นทันทีและดูเหมือนระบบพัง
--
--  ทะเบียนนี้แยกจากตาราง messages โดยตั้งใจ :
--    "บันทึกข้อความแล้ว" กับ "ตอบไปแล้ว" เป็นคนละข้อเท็จจริง
--    เก็บแยกกันจึงตอบได้ทั้งสองคำถามโดยไม่ต้องเดา
--
--  ⚠️ status = 'unknown' คือสถานะที่ห้ามลองใหม่อัตโนมัติเด็ดขาด
--     แปลว่ายิงออกไปหา Meta แล้วแต่ไม่รู้ผล — ลองใหม่ = เสี่ยงตอบซ้ำ
-- ---------------------------------------------------------------------------
do $$ begin
  create type auto_reply_status_t as enum (
    'claimed',   -- จองสิทธิ์แล้ว กำลังทำ
    'sent',      -- ส่งถึงลูกค้าแล้ว
    'blocked',   -- Policy Engine ไม่อนุญาต (ไม่ใช่ความผิดพลาด)
    'failed',    -- ส่งไม่สำเร็จแบบรู้ผลชัดเจน
    'unknown',   -- ⚠️ ยิงออกไปแล้วไม่รู้ผล — ห้ามลองใหม่อัตโนมัติ
    'no_match'   -- ไม่มีกฎไหนตรง (จดไว้เพื่อให้ตรวจย้อนหลังได้ว่าเคยพิจารณาแล้ว)
  );
exception when duplicate_object then null; end $$;

create table if not exists auto_reply_executions (
  id                 uuid primary key default gen_random_uuid(),

  -- ⭐ กุญแจกันตอบซ้ำ : หนึ่งข้อความขาเข้า = ตอบอัตโนมัติได้ครั้งเดียวตลอดกาล
  message_id         uuid not null references messages(id) on delete cascade,

  conversation_id    uuid not null references conversations(id) on delete cascade,
  page_id            uuid references pages(id) on delete set null,

  -- กฎที่ใช้ตอบ — เก็บทั้ง id และ "สำเนา ณ ตอนนั้น"
  -- ⚠️ ต้องมีสำเนา เพราะแอดมินแก้กฎได้ตลอดเวลา
  --    ถ้าเก็บแค่ id พอกฎถูกแก้ เราจะตอบไม่ได้ว่าตอนนั้นส่งข้อความว่าอะไรไป
  rule_id            uuid references keyword_rules(id) on delete set null,
  rule_version       integer,
  rule_snapshot      jsonb not null default '{}'::jsonb,
  matched_keyword    text,

  status             auto_reply_status_t not null default 'claimed',

  -- ผลจาก Policy Engine + การส่งจริง
  policy_reason_code text,
  policy_reason_th   text,
  selected_transport transport_t,
  message_send_id    uuid,
  meta_message_id    text,
  error_text         text,

  claimed_at         timestamptz not null default now(),
  finished_at        timestamptz,
  created_at         timestamptz not null default now()
);

-- 🔴 บรรทัดนี้คือสิ่งที่กันการตอบซ้ำจริง ๆ ไม่ใช่โค้ดฝั่ง JavaScript
create unique index if not exists auto_reply_message_uniq on auto_reply_executions (message_id);
create index if not exists auto_reply_rule_idx on auto_reply_executions (rule_id, created_at desc);
create index if not exists auto_reply_conv_idx on auto_reply_executions (conversation_id, created_at desc);
create index if not exists auto_reply_status_idx on auto_reply_executions (status, created_at desc);

-- ---------------------------------------------------------------------------
--  3) ⭐ claim_auto_reply — จองสิทธิ์ตอบข้อความนี้
--
--  คืน (execution_id, won)
--    won = true  → คุณคือคนเดียวที่ได้สิทธิ์ตอบ ทำต่อได้
--    won = false → มีคนอื่นจองไปแล้ว ห้ามส่งเด็ดขาด
--
--  ใช้ insert ... on conflict do nothing returning
--  ซึ่ง PostgreSQL รับประกันว่าอะตอมมิก — worker สองตัวยิงพร้อมกัน
--  จะมีตัวเดียวที่ได้แถวกลับมา อีกตัวได้ค่าว่าง
--
--  ⚠️ ห้ามเปลี่ยนไปใช้ "select ก่อนแล้วค่อย insert"
--     ระหว่างสองคำสั่งนั้นมีช่องให้ worker อีกตัวแทรกได้เสมอ
-- ---------------------------------------------------------------------------
create or replace function claim_auto_reply(
  p_message_id      uuid,
  p_conversation_id uuid,
  p_page_id         uuid,
  p_rule_id         uuid,
  p_rule_version    integer,
  p_rule_snapshot   jsonb,
  p_matched_keyword text
)
returns table (execution_id uuid, won boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  insert into auto_reply_executions (
    message_id, conversation_id, page_id,
    rule_id, rule_version, rule_snapshot, matched_keyword, status
  ) values (
    p_message_id, p_conversation_id, p_page_id,
    p_rule_id, p_rule_version, coalesce(p_rule_snapshot, '{}'::jsonb), p_matched_keyword, 'claimed'
  )
  on conflict (message_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- มีคนจองไปก่อนแล้ว — คืน id ของเจ้าของสิทธิ์ไปด้วย เผื่อเอาไปดูล็อก
    select e.id into v_id from auto_reply_executions e where e.message_id = p_message_id;
    return query select v_id, false;
    return;
  end if;

  return query select v_id, true;
end
$$;

-- ---------------------------------------------------------------------------
--  4) finish_auto_reply — จดผลของการตอบ
--     แยกเป็นฟังก์ชันเพื่อให้ "จดผล" เป็นคำสั่งเดียว ไม่มีทางจดครึ่ง ๆ กลาง ๆ
-- ---------------------------------------------------------------------------
create or replace function finish_auto_reply(
  p_execution_id     uuid,
  p_status           auto_reply_status_t,
  p_reason_code      text,
  p_reason_th        text,
  p_transport        transport_t,
  p_message_send_id  uuid,
  p_meta_message_id  text,
  p_error_text       text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update auto_reply_executions set
    status             = p_status,
    policy_reason_code = p_reason_code,
    policy_reason_th   = p_reason_th,
    selected_transport = p_transport,
    message_send_id    = p_message_send_id,
    meta_message_id    = p_meta_message_id,
    error_text         = left(p_error_text, 1000),
    finished_at        = now()
  where id = p_execution_id;

  -- นับจำนวนครั้งที่กฎทำงานสำเร็จ (ให้ฐานข้อมูลบวกเอง กันตัวเลขหายตอนชนกัน)
  if p_status = 'sent' then
    update keyword_rules k set hit_count = k.hit_count + 1
    where k.id = (select e.rule_id from auto_reply_executions e where e.id = p_execution_id);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
--  5) upsert กฎคีย์เวิร์ด — บวก version ให้เองทุกครั้งที่แก้
--
--  ทำไมต้องเป็นฟังก์ชัน : version ต้องเพิ่มพร้อมกับการแก้ในคำสั่งเดียว
--  ถ้าแยกกัน จะมีจังหวะที่เนื้อหาใหม่แต่ version เก่า แล้วล็อกจะโกหก
-- ---------------------------------------------------------------------------
create or replace function save_keyword_rule(
  p_id         uuid,
  p_admin_id   uuid,
  p_name       text,
  p_page_ids   uuid[],
  p_match_type match_type_t,
  p_keywords   text[],
  p_reply_text text,
  p_priority   integer,
  p_is_active  boolean
)
returns keyword_rules
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row keyword_rules%rowtype;
begin
  if p_id is null then
    insert into keyword_rules (
      name, page_ids, match_type, keywords, reply_text, priority, is_active,
      created_by, updated_by, version
    ) values (
      p_name, coalesce(p_page_ids, '{}'), coalesce(p_match_type, 'contains'),
      coalesce(p_keywords, '{}'), p_reply_text, coalesce(p_priority, 100),
      coalesce(p_is_active, true), p_admin_id, p_admin_id, 1
    )
    returning * into v_row;
  else
    update keyword_rules set
      name       = p_name,
      page_ids   = coalesce(p_page_ids, '{}'),
      match_type = coalesce(p_match_type, match_type),
      keywords   = coalesce(p_keywords, '{}'),
      reply_text = p_reply_text,
      priority   = coalesce(p_priority, priority),
      is_active  = coalesce(p_is_active, is_active),
      updated_by = p_admin_id,
      updated_at = now(),
      version    = version + 1
    where id = p_id
    returning * into v_row;

    if not found then
      raise exception 'ไม่พบกฎนี้';
    end if;
  end if;

  return v_row;
end
$$;

-- ---------------------------------------------------------------------------
--  6) shipping_methods — วิธีจัดส่ง (ของใหม่ในรอบนี้)
--
--  ทำไมต้องมีตาราง ไม่ใช่แค่พิมพ์ชื่อขนส่งลงไปในออเดอร์ :
--    ค่าส่งกับ "รับเก็บเงินปลายทางได้ไหม" เป็นกฎที่ต้องบังคับฝั่งเซิร์ฟเวอร์
--    ถ้าเป็นแค่ตัวหนังสือ ระบบจะไม่มีทางรู้ว่าคู่ที่แอดมินเลือกเป็นไปได้จริงไหม
-- ---------------------------------------------------------------------------
create table if not exists shipping_methods (
  id             uuid primary key default gen_random_uuid(),
  name           text          not null,
  fee            numeric(12,2) not null default 0,
  -- ⭐ ขนส่งบางเจ้าไม่รับเก็บเงินปลายทาง — ต้องกันตั้งแต่ฝั่งเซิร์ฟเวอร์
  cod_supported  boolean       not null default true,
  note           text,
  is_active      boolean       not null default true,
  archived_at    timestamptz,
  sort_order     integer       not null default 0,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now()
);
create index if not exists shipping_methods_live_idx
  on shipping_methods (sort_order, created_at) where is_active and archived_at is null;
create unique index if not exists shipping_methods_name_uniq
  on shipping_methods (lower(name)) where archived_at is null;

-- ---------------------------------------------------------------------------
--  7) orders — ผูกวิธีจัดส่ง + เก็บ "สำเนา ณ ตอนสร้าง"
--
--  🔴 shipping_snapshot คือหัวใจ
--     ถ้าเก็บแค่ shipping_method_id แล้ววันหนึ่งเจ้าของร้านขึ้นค่าส่ง
--     ออเดอร์เก่าทุกใบจะเปลี่ยนตามไปด้วย — ยอดในบิลที่ส่งลูกค้าไปแล้วจะไม่ตรง
--     สำเนาทำให้ออเดอร์เก่า "แข็งตัว" ตามความจริงของวันที่ขาย
-- ---------------------------------------------------------------------------
alter table orders add column if not exists shipping_method_id uuid references shipping_methods(id) on delete set null;
alter table orders add column if not exists shipping_snapshot  jsonb not null default '{}'::jsonb;
alter table orders add column if not exists updated_at         timestamptz not null default now();

-- ---------------------------------------------------------------------------
--  8) products / promotions — เก็บเข้ากรุแทนการลบ
--
--  🔴 ห้ามลบสินค้าที่เคยขายไปแล้วเด็ดขาด
--     ออเดอร์เก่าเก็บชื่อ/ราคาไว้ใน items (jsonb) ก็จริง
--     แต่การลบแถวทำให้ตามรอยย้อนหลังไม่ได้ และรายงานยอดขายจะเพี้ยน
-- ---------------------------------------------------------------------------
alter table products   add column if not exists archived_at timestamptz;
alter table products   add column if not exists updated_at  timestamptz not null default now();
alter table promotions add column if not exists archived_at timestamptz;
alter table promotions add column if not exists updated_at  timestamptz not null default now();

create index if not exists products_live_idx
  on products (sort_order, created_at) where is_active and archived_at is null;
create index if not exists promotions_live_idx
  on promotions (sort_order, created_at) where is_active and archived_at is null;

-- sku ต้องไม่ซ้ำเฉพาะในกลุ่มที่ยังไม่ถูกเก็บเข้ากรุ
-- (ของเก่าใน 0001 บังคับทั้งตาราง ทำให้เอา sku เดิมมาใช้ใหม่ไม่ได้เลย)
drop index if exists products_sku_uniq;
create unique index if not exists products_sku_live_uniq
  on products (sku) where sku is not null and archived_at is null;

-- ---------------------------------------------------------------------------
--  9) create_order — รับวิธีจัดส่ง + เก็บสำเนา
--     (แทนที่ตัวเดิมจาก 0008 — เพิ่มพารามิเตอร์ท้ายสุด)
--
--  ⚠️ ตัวเดิมของ 0008 ต้องถูกลบทิ้งก่อน เพราะ PostgreSQL ถือว่าจำนวนพารามิเตอร์
--     ที่ต่างกันคือคนละฟังก์ชัน ถ้าไม่ลบจะเหลือสองตัวแล้วเรียกกำกวม
-- ---------------------------------------------------------------------------
drop function if exists create_order(
  uuid, uuid, uuid, text, text, text, text, jsonb,
  numeric, numeric, numeric, numeric, payment_method_t, text
);

create or replace function create_order(
  p_conversation_id    uuid,
  p_source_message_id  uuid,
  p_admin_id           uuid,
  p_recipient_name     text,
  p_phone              text,
  p_address            text,
  p_postcode           text,
  p_items              jsonb,
  p_subtotal           numeric,
  p_shipping_fee       numeric,
  p_discount           numeric,
  p_total              numeric,
  p_payment_method     payment_method_t,
  p_internal_note      text,
  p_shipping_method_id uuid
)
returns orders
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_conv     conversations%rowtype;
  v_cust     customers%rowtype;
  v_ship     shipping_methods%rowtype;
  v_snapshot jsonb := '{}'::jsonb;
  v_row      orders%rowtype;
begin
  select * into v_conv from conversations where id = p_conversation_id;
  if not found then
    raise exception 'ไม่พบห้องแชทนี้';
  end if;

  select * into v_cust from customers where id = v_conv.customer_id;

  if p_shipping_method_id is not null then
    select * into v_ship from shipping_methods where id = p_shipping_method_id;
    if not found then
      raise exception 'ไม่พบวิธีจัดส่งนี้';
    end if;

    -- 🔴 กฎธุรกิจที่ต้องบังคับในฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่มบนหน้าจอ
    --    ขนส่งที่ไม่รับเก็บเงินปลายทาง + ออเดอร์แบบ COD = คู่ที่เป็นไปไม่ได้
    if p_payment_method = 'cod' and not v_ship.cod_supported then
      raise exception 'วิธีจัดส่ง "%" ไม่รองรับเก็บเงินปลายทาง', v_ship.name;
    end if;

    -- ⭐ สำเนา ณ ตอนสร้าง — ออเดอร์ใบนี้จะไม่เปลี่ยนตามค่าส่งที่แก้ทีหลัง
    v_snapshot := jsonb_build_object(
      'id',            v_ship.id,
      'name',          v_ship.name,
      'fee',           v_ship.fee,
      'cod_supported', v_ship.cod_supported,
      'taken_at',      now()
    );
  end if;

  insert into orders (
    order_no, conversation_id, customer_id, page_id, source_message_id,
    recipient_name, phone, address, postcode,
    items, subtotal, shipping_fee, discount, total,
    payment_method, status,
    referral_ad_id, referral_post_id, first_contact_at,
    internal_note, created_by_admin_id,
    shipping_method_id, shipping_snapshot
  ) values (
    next_order_no(), p_conversation_id, v_conv.customer_id, v_conv.page_id, p_source_message_id,
    p_recipient_name, p_phone, p_address, p_postcode,
    coalesce(p_items, '[]'::jsonb),
    coalesce(p_subtotal, 0), coalesce(p_shipping_fee, 0),
    coalesce(p_discount, 0), coalesce(p_total, 0),
    p_payment_method, 'draft',
    -- ⭐ คัดลอกที่มาจากห้องแชท ณ ตอนสร้าง — ห้ามรับจากผู้เรียก
    v_conv.referral_ad_id, v_conv.referral_post_id, v_cust.first_contact_at,
    p_internal_note, p_admin_id,
    p_shipping_method_id, v_snapshot
  )
  returning * into v_row;

  insert into order_logs (order_id, admin_id, action, before, after)
  values (v_row.id, p_admin_id, 'created', null, to_jsonb(v_row));

  return v_row;
end
$$;

-- ---------------------------------------------------------------------------
--  10) update_order — รองรับวิธีจัดส่ง + บังคับกฎ COD ตอนแก้ด้วย
--
--  ⚠️ ถ้าบังคับกฎแค่ตอนสร้าง แอดมินจะเปลี่ยนเป็นคู่ที่เป็นไปไม่ได้ทีหลังได้
--     ประตูต้องล็อกทั้งขาเข้าและขาแก้
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

  -- เปลี่ยนวิธีจัดส่ง → หยิบสำเนาชุดใหม่ และตรวจกฎ COD อีกครั้ง
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

  -- ตรวจคู่ COD กับสำเนาที่จะใช้จริง (ไม่ใช่ค่าปัจจุบันของตาราง shipping_methods)
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
--  11) ตรวจว่าสินค้า/โปรถูกใช้ในออเดอร์ไปแล้วหรือยัง
--      ใช้ตอบคำถาม "ลบได้ไหม" — ถ้าเคยขายแล้ว ต้องเก็บเข้ากรุเท่านั้น
-- ---------------------------------------------------------------------------
create or replace function product_in_use(p_product_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from orders o
    where o.items @> jsonb_build_array(jsonb_build_object('product_id', p_product_id::text))
  );
$$;


-- ---------------------------------------------------------------------------
--  12) 🔴 เปิด RLS ให้ตารางใหม่ทั้งสองตัว
--
--  ทำไมสำคัญมาก :
--    ตารางใน schema public ถูกเปิดออกทาง PostgREST ให้ anon key เรียกได้
--    ถ้าไม่เปิด RLS = ใครก็ตามที่มี anon key (ซึ่งอยู่ในโค้ดฝั่งเบราว์เซอร์)
--    อ่านข้อมูลทั้งตารางได้ทันที — รวมถึงข้อความที่บอทตอบลูกค้าไปทั้งหมด
--
--  ⚠️ เปิด RLS อย่างเดียว ไม่สร้าง policy — ตรงกับแบบแผนของทั้งโปรเจกต์ (0001)
--     แปลว่า anon key อ่านไม่ได้เลย ส่วนเซิร์ฟเวอร์ใช้ service_role ซึ่ง bypass ได้
--     (ตัวตรวจของ Supabase จับข้อนี้ได้ตอนรอบ 6 — ของเดิมครบอยู่แล้ว
--      แต่ตารางใหม่สองตัวนี้ตกหล่นไป)
-- ---------------------------------------------------------------------------
alter table auto_reply_executions enable row level security;
alter table shipping_methods      enable row level security;

-- ---------------------------------------------------------------------------
--  ตรวจผล : ฟังก์ชันที่เราเขียนเองต้องล็อก search_path ครบทุกตัว
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

-- ---------------------------------------------------------------------------
--  ตรวจผล : ทุกตารางใน public ต้องเปิด RLS ครบ
--  (ข้อนี้เพิ่มในรอบ 6 เพราะเคยลืมกับตารางใหม่มาแล้ว — ให้ migration จับเองเลย)
-- ---------------------------------------------------------------------------
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
