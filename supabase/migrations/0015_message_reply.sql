-- ============================================================================
--  HubChat — 0015 : ตอบกลับข้อความ (สเปกก้อน 2 ข้อ 1.3)
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ของเดิมใน 0001-0014
--
--  ⚠️ ต้องรัน 0014 ก่อนเสมอ (ไฟล์นี้ไม่ได้พึ่ง 0014 โดยตรง
--     แต่ลำดับ migration ห้ามข้ามเด็ดขาด)
--
--  🔴 สองเรื่องที่ไฟล์นี้ต้องบังคับให้ได้
--  ---------------------------------------------------------------------------
--   1. "ตอบกลับข้อความไหน" ต้องเป็นข้อความใน **ห้องเดียวกัน** เท่านั้น
--      ถ้าข้ามห้องได้ = แอดมินจะอ้างอิงข้อความของลูกค้าคนอื่นมาแปะในห้องนี้
--      ซึ่งเป็นการรั่วข้อมูลข้ามลูกค้า และเป็นสิ่งที่หน้าเว็บปลอมได้ง่ายที่สุด
--      → ฐานข้อมูลต้องเป็นคนบังคับ ไม่ใช่เชื่อว่าโค้ดฝั่งเว็บจะตรวจให้
--
--   2. ต้องแยก "เราเก็บความสัมพันธ์เอง" ออกจาก "Meta ตอบกลับให้จริง"
--      Messenger รองรับ reply_to.mid ตามเอกสาร แต่ Instagram ไม่ได้ระบุไว้
--      ถ้าเก็บรวมเป็นค่าเดียว เราจะไม่มีทางรู้ย้อนหลังว่าอันไหนเป็น native จริง
--      แล้วจะกลายเป็นการโกหกตัวเองในประวัติข้อความ
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) คอลัมน์ใหม่บน messages
-- ---------------------------------------------------------------------------
alter table messages add column if not exists reply_to_message_id uuid
  references messages(id) on delete set null;

/**
 * ⭐ true = ส่ง reply_to.mid ไปกับ payload ของ Meta จริง ๆ และ Meta รับแล้ว
 *    false = เราเก็บความสัมพันธ์ไว้เองเท่านั้น ลูกค้าจะไม่เห็นเส้นโยงในแอป Meta
 *
 * 🔴 ห้ามตั้งเป็น true เว้นแต่ payload ที่ยิงออกไปมี reply_to จริง
 *    ค่านี้คือ "ความจริงเชิงประวัติ" ไม่ใช่ความตั้งใจ
 */
alter table messages add column if not exists reply_native boolean not null default false;

create index if not exists messages_reply_to_idx
  on messages (reply_to_message_id) where reply_to_message_id is not null;

-- ---------------------------------------------------------------------------
--  2) 🔴 ห้ามอ้างอิงข้ามห้องแชท — ให้ฐานข้อมูลเป็นคนบังคับ
--
--  ทำไมต้องเป็น trigger ไม่ใช่ foreign key :
--    foreign key บอกได้แค่ "ข้อความนั้นมีอยู่จริง" แต่บอกไม่ได้ว่า "อยู่ห้องเดียวกัน"
--    เงื่อนไขข้ามแถวแบบนี้ Postgres ไม่มี constraint สำเร็จรูปให้
--
--  ⚠️ ตรวจที่ฐานข้อมูลแม้โค้ดฝั่งเซิร์ฟเวอร์จะตรวจอยู่แล้ว
--     เพราะนี่เป็นด่านสุดท้ายที่ข้ามไม่ได้จริง ๆ
--     (บทเรียนเดียวกับ OrderPatch ใน D-68 : TypeScript อย่างเดียวไม่ใช่หลักประกัน)
-- ---------------------------------------------------------------------------
create or replace function assert_reply_same_conversation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_target_conversation uuid;
begin
  if new.reply_to_message_id is null then
    return new;
  end if;

  -- ตอบกลับตัวเองไม่ได้
  if new.reply_to_message_id = new.id then
    raise exception 'ข้อความตอบกลับตัวเองไม่ได้';
  end if;

  select m.conversation_id into v_target_conversation
    from messages m where m.id = new.reply_to_message_id;

  if v_target_conversation is null then
    raise exception 'ไม่พบข้อความที่จะตอบกลับ';
  end if;

  if v_target_conversation <> new.conversation_id then
    raise exception 'ตอบกลับข้ามห้องแชทไม่ได้ (ข้อความต้นทางอยู่คนละห้อง)';
  end if;

  return new;
end
$$;

drop trigger if exists messages_reply_same_conversation on messages;
create trigger messages_reply_same_conversation
  before insert or update of reply_to_message_id on messages
  for each row execute function assert_reply_same_conversation();

-- ---------------------------------------------------------------------------
--  3) ⭐ resolve_reply_target — แปลง "id ข้อความของเรา" เป็นข้อมูลที่ใช้ส่งได้
--
--  คืน (ok, meta_message_id, reason_th)
--
--  🔴 หน้าเว็บส่งมาได้แค่ **id ของข้อความในระบบเรา** เท่านั้น
--     ห้ามให้หน้าเว็บส่ง mid ของ Meta มาเองเด็ดขาด
--     ไม่งั้นจะยัด mid ของห้องอื่น (หรือของเพจอื่น) มาแปะได้
--     ฟังก์ชันนี้เป็นคนแปลงให้ พร้อมตรวจว่าอยู่ห้องเดียวกันจริง
-- ---------------------------------------------------------------------------
create or replace function resolve_reply_target(
  p_conversation_id uuid,
  p_message_id      uuid
)
returns table (ok boolean, meta_message_id text, reason_th text)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_row messages%rowtype;
begin
  if p_message_id is null then
    return query select true, null::text, null::text;
    return;
  end if;

  select * into v_row from messages m where m.id = p_message_id;

  if not found then
    return query select false, null::text, 'ไม่พบข้อความที่จะตอบกลับ (อาจถูกลบไปแล้ว)'::text;
    return;
  end if;

  -- 🔴 ด่านที่สำคัญที่สุด
  if v_row.conversation_id <> p_conversation_id then
    return query select false, null::text, 'ตอบกลับข้ามห้องแชทไม่ได้'::text;
    return;
  end if;

  if v_row.is_deleted then
    return query select false, null::text, 'ข้อความนี้ถูกลบไปแล้ว'::text;
    return;
  end if;

  /**
   * ⚠️ ไม่มี meta_message_id ไม่ใช่ความผิดพลาด
   *    เช่นข้อความที่ยังส่งไม่สำเร็จ หรือข้อความที่ดึงมาจาก backfill บางแบบ
   *    กรณีนี้ยัง "ตอบกลับ" ได้ในระบบเรา แค่ไม่มี native reply ฝั่ง Meta
   */
  return query select true, v_row.meta_message_id, null::text;
end
$$;


-- ---------------------------------------------------------------------------
--  4) record_outbound_message — เพิ่มการบันทึก "ตอบกลับข้อความไหน"
--
--  🔴 บทเรียน D-68 : ก่อนเขียนทับฟังก์ชัน ต้อง grep หาทุกไฟล์ที่นิยามมันก่อน
--     ตรวจแล้ว — ตัวนี้ถูกนิยามที่เดียวคือ 0005_ingest.sql
--     ฉบับนี้จึงต่อยอดจากของ 0005 ตรง ๆ โดยไม่ทิ้งพฤติกรรมเดิมข้อไหนเลย
--
--  ⚠️ ต้อง drop ตัวเก่าทิ้งก่อน ไม่ใช่ create or replace เฉย ๆ
--     เพราะจำนวนพารามิเตอร์เปลี่ยน = Postgres จะมองเป็นคนละฟังก์ชัน (overload)
--     แล้วผู้เรียกเดิมจะยังวิ่งไปหาตัวเก่าที่ไม่รู้จัก reply — บั๊กที่หายากมาก
-- ---------------------------------------------------------------------------
drop function if exists record_outbound_message(uuid, uuid, sender_type_t, text, jsonb, text, boolean);

create or replace function record_outbound_message(
  p_conversation_id uuid,
  p_admin_id        uuid,
  p_sender_type     sender_type_t,
  p_text            text,
  p_attachments     jsonb,
  p_meta_message_id text,
  p_human_agent_tag boolean,
  p_reply_to_message_id uuid default null,
  p_reply_native        boolean default false
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_msg      uuid;
  v_customer uuid;
  v_preview  text;
begin
  v_preview := case
    when p_text is not null and length(trim(p_text)) > 0 then left(trim(p_text), 200)
    when jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 then '[ไฟล์แนบ]'
    else null
  end;

  insert into messages (
    conversation_id, direction, sender_type, admin_id, text, attachments,
    meta_message_id, sent_with_human_agent_tag,
    reply_to_message_id, reply_native
  ) values (
    p_conversation_id, 'out', p_sender_type, p_admin_id, p_text,
    coalesce(p_attachments, '[]'::jsonb), p_meta_message_id, coalesce(p_human_agent_tag, false),
    p_reply_to_message_id, coalesce(p_reply_native, false)
  )
  on conflict (meta_message_id) where meta_message_id is not null do nothing
  returning id into v_msg;

  if not found then
    select m.id into v_msg from messages m where m.meta_message_id = p_meta_message_id;
    return v_msg;
  end if;

  update conversations cv
     set last_message_at      = now(),
         last_message_preview = v_preview,
         -- เราเพิ่งตอบไป = อ่านแล้วแน่นอน
         is_read              = true
   where cv.id = p_conversation_id
  returning cv.customer_id into v_customer;

  -- ⚠️ อัปเดตได้เฉพาะ "เวลาที่แอดมินตอบ" เท่านั้น
  --    ห้ามแตะ last_customer_message_at เด็ดขาด — นั่นคือประวัติจริงที่ Policy Engine ใช้
  update customers c set last_admin_message_at = now() where c.id = v_customer;

  return v_msg;
end
$$;

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
