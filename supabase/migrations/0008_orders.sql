-- ============================================================================
--  HubChat — 0008 : ออเดอร์ (สเปกหัวข้อ 4 + 5.3)
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ของเดิมใน 0001-0007
--
--  ตาราง orders / order_logs / products / promotions มีมาตั้งแต่ 0001 แล้ว
--  ไฟล์นี้เพิ่มฟังก์ชันที่ต้องให้ฐานข้อมูลเป็นคนตัดสิน
-- ============================================================================

-- ---------------------------------------------------------------------------
--  ⭐ 1) สร้างออเดอร์
--
--  ทำไมต้องเป็นฟังก์ชันในฐานข้อมูล :
--    เลขออเดอร์ต้องไม่ซ้ำและไม่ข้าม แม้แอดมินหลายคนกดสร้างพร้อมกัน
--    next_order_no() (จาก 0001) เป็น atomic อยู่แล้ว
--    แต่ถ้าขอเลขในโค้ดแล้วค่อย insert แยกกัน
--    จังหวะที่ insert พังหลังขอเลขไปแล้ว เลขนั้นจะหายไปเฉย ๆ
--    รวมเป็นคำสั่งเดียว = ได้เลขเมื่อไหร่ ได้แถวเมื่อนั้น
--
--  ⚠️ ข้อมูลที่ "คัดลอกมาจากห้องแชท" (ที่มาจากแอดไหน / ทักมาครั้งแรกเมื่อไหร่)
--     ต้องอ่านจากฐานข้อมูลเอง ไม่รับจากผู้เรียก
--     เพราะเป็นตัวเลขที่เอาไปวัดผลว่าแอดไหนคุ้ม — ปลอมได้ไม่ได้
-- ---------------------------------------------------------------------------
create or replace function create_order(
  p_conversation_id   uuid,
  p_source_message_id uuid,
  p_admin_id          uuid,
  p_recipient_name    text,
  p_phone             text,
  p_address           text,
  p_postcode          text,
  p_items             jsonb,
  p_subtotal          numeric,
  p_shipping_fee      numeric,
  p_discount          numeric,
  p_total             numeric,
  p_payment_method    payment_method_t,
  p_internal_note     text
)
returns orders
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_conv conversations%rowtype;
  v_cust customers%rowtype;
  v_row  orders%rowtype;
begin
  select * into v_conv from conversations where id = p_conversation_id;
  if not found then
    raise exception 'ไม่พบห้องแชทนี้';
  end if;

  select * into v_cust from customers where id = v_conv.customer_id;

  insert into orders (
    order_no, conversation_id, customer_id, page_id, source_message_id,
    recipient_name, phone, address, postcode,
    items, subtotal, shipping_fee, discount, total,
    payment_method, status,
    referral_ad_id, referral_post_id, first_contact_at,
    internal_note, created_by_admin_id
  ) values (
    next_order_no(), p_conversation_id, v_conv.customer_id, v_conv.page_id, p_source_message_id,
    p_recipient_name, p_phone, p_address, p_postcode,
    coalesce(p_items, '[]'::jsonb),
    coalesce(p_subtotal, 0), coalesce(p_shipping_fee, 0),
    coalesce(p_discount, 0), coalesce(p_total, 0),
    p_payment_method, 'draft',
    -- ⭐ คัดลอกที่มาจากห้องแชท ณ ตอนสร้าง — ห้ามรับจากผู้เรียก
    v_conv.referral_ad_id, v_conv.referral_post_id, v_cust.first_contact_at,
    p_internal_note, p_admin_id
  )
  returning * into v_row;

  insert into order_logs (order_id, admin_id, action, before, after)
  values (v_row.id, p_admin_id, 'created', null, to_jsonb(v_row));

  return v_row;
end
$$;

-- ---------------------------------------------------------------------------
--  2) แก้ออเดอร์ + จดประวัติในคำสั่งเดียว (สเปก 5.3 : "รายละเอียด + ประวัติแก้ไข")
--
--  ⚠️ ถ้าแยกเป็นสองคำสั่ง แล้วคำสั่งจดประวัติพัง
--     ข้อมูลจะถูกแก้โดยไม่มีร่องรอย ซึ่งเป็นสิ่งที่ยอมไม่ได้กับตารางที่มีเงิน
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
begin
  select * into v_before from orders where id = p_order_id;
  if not found then
    raise exception 'ไม่พบออเดอร์นี้';
  end if;

  -- jsonb_populate_record จะใช้ค่าจาก patch เฉพาะคีย์ที่ส่งมา
  -- คีย์ที่ไม่ได้ส่ง จะคงค่าเดิมของแถวไว้
  select * into v_after from jsonb_populate_record(v_before, p_patch);

  update orders set
    recipient_name   = v_after.recipient_name,
    phone            = v_after.phone,
    address          = v_after.address,
    postcode         = v_after.postcode,
    items            = v_after.items,
    subtotal         = v_after.subtotal,
    shipping_fee     = v_after.shipping_fee,
    discount         = v_after.discount,
    total            = v_after.total,
    payment_method   = v_after.payment_method,
    payment_status   = v_after.payment_status,
    slip_url         = v_after.slip_url,
    paid_at          = case
                         -- จ่ายแล้วแต่ยังไม่เคยจดเวลา → จดตอนนี้
                         when v_after.payment_status = 'paid' and v_before.paid_at is null then now()
                         else v_after.paid_at
                       end,
    shipping_carrier = v_after.shipping_carrier,
    tracking_no      = v_after.tracking_no,
    shipped_at       = v_after.shipped_at,
    status           = v_after.status,
    closed_at        = case
                         -- ปิดการขายแล้วแต่ยังไม่เคยจดเวลา → จดตอนนี้
                         -- ใช้วัดว่าจากทักถึงปิดการขายกี่ชั่วโมง (สเปก 5.4)
                         when v_after.status in ('confirmed','paid','packed','shipped','completed')
                              and v_before.closed_at is null then now()
                         else v_after.closed_at
                       end,
    internal_note    = v_after.internal_note
  where id = p_order_id
  returning * into v_after;

  insert into order_logs (order_id, admin_id, action, before, after)
  values (p_order_id, p_admin_id, 'updated', to_jsonb(v_before), to_jsonb(v_after));

  return v_after;
end
$$;

-- ---------------------------------------------------------------------------
--  3) index ที่หน้าลิสต์ออเดอร์ใช้จริง (สเปก 5.3 : กรองตามสถานะ/วันที่/เพจ/แอดมิน)
-- ---------------------------------------------------------------------------
create index if not exists orders_status_created_idx on orders (status, created_at desc);
create index if not exists orders_page_created_idx   on orders (page_id, created_at desc);
create index if not exists orders_admin_created_idx  on orders (created_by_admin_id, created_at desc);
create index if not exists orders_conversation_idx   on orders (conversation_id);

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
