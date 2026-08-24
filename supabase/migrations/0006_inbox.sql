-- ============================================================================
--  HubChat — 0006 : หน้าอินบ็อกซ์ (ล็อกกันแอดมินชน + ทำเครื่องหมายอ่านแล้ว)
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ของเดิมใน 0001-0005
--
--  ทำไมต้องเป็นฟังก์ชันในฐานข้อมูล ไม่ใช่โค้ด JavaScript :
--    แอดมิน 2 คนกดเข้าห้องแชทเดียวกันพร้อมกันได้จริง (คนละเครื่อง คนละ process)
--    ถ้าเขียนแบบ "อ่านมาดูก่อนว่าว่างไหม แล้วค่อยเขียนทับ"
--    จังหวะที่สองคนอ่านพร้อมกัน จะเห็นว่าว่างทั้งคู่ แล้วเขียนทับกันทั้งคู่
--    ต้องให้ฐานข้อมูลตัดสินในคำสั่งเดียวเท่านั้น
-- ============================================================================

-- ---------------------------------------------------------------------------
--  ⭐ 1) ขอล็อกห้องแชท
--
--  ได้ล็อกเมื่อเข้าเงื่อนไขข้อใดข้อหนึ่ง :
--    • ยังไม่มีใครถืออยู่
--    • เราถืออยู่แล้ว (ต่ออายุ)
--    • คนเดิมถือไว้แล้วเงียบไปเกินเวลาที่กำหนด (สเปก 5.1 : 3 นาที)
-- ---------------------------------------------------------------------------
create or replace function acquire_conversation_lock(
  p_conversation_id uuid,
  p_admin_id        uuid,
  p_stale_seconds   integer
)
returns table (
  won                boolean,
  locked_by_admin_id uuid,
  locked_at          timestamptz
)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_row conversations%rowtype;
begin
  update conversations c
     set locked_by_admin_id = p_admin_id,
         locked_at          = now()
   where c.id = p_conversation_id
     and (
       c.locked_by_admin_id is null
       or c.locked_by_admin_id = p_admin_id
       or c.locked_at is null
       or c.locked_at < now() - make_interval(secs => greatest(p_stale_seconds, 30))
     )
  returning c.* into v_row;

  if found then
    return query select true, v_row.locked_by_admin_id, v_row.locked_at;
    return;
  end if;

  -- แพ้ — คนอื่นถืออยู่และยังไม่หมดเวลา บอกไปตรง ๆ ว่าใครถือ
  select * into v_row from conversations c2 where c2.id = p_conversation_id;
  return query select false, v_row.locked_by_admin_id, v_row.locked_at;
end
$$;

-- ---------------------------------------------------------------------------
--  2) ปล่อยล็อก — ปล่อยได้เฉพาะล็อกที่ตัวเองถืออยู่เท่านั้น
--     (กันเคสที่หน้าจอเก่าค้างอยู่แล้วไปปลดล็อกของคนที่เพิ่งเข้ามาใหม่)
-- ---------------------------------------------------------------------------
create or replace function release_conversation_lock(
  p_conversation_id uuid,
  p_admin_id        uuid
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update conversations
     set locked_by_admin_id = null,
         locked_at          = null
   where id = p_conversation_id
     and locked_by_admin_id = p_admin_id;
end
$$;

-- ---------------------------------------------------------------------------
--  3) ทำเครื่องหมายว่าอ่านแล้ว
--     ⚠️ ห้ามแตะ last_customer_message_at — นั่นคือประวัติจริงที่ Policy Engine ใช้
-- ---------------------------------------------------------------------------
create or replace function mark_conversation_read(
  p_conversation_id uuid,
  p_admin_id        uuid
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update conversations
     set is_read           = true,
         -- ใครเปิดอ่านคนล่าสุด = คนที่ดูแลห้องนี้อยู่ (ยังเปลี่ยนมือได้)
         assigned_admin_id = coalesce(assigned_admin_id, p_admin_id)
   where id = p_conversation_id;
end
$$;

-- ---------------------------------------------------------------------------
--  4) index ช่วยลิสต์แชท : ค้นหาชื่อลูกค้าเร็วขึ้นเมื่อกรองตามเพจด้วย
-- ---------------------------------------------------------------------------
create index if not exists customers_page_name_idx on customers (page_id) where name is not null;

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
