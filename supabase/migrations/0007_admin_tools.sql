-- ============================================================================
--  HubChat — 0007 : เครื่องมือแอดมิน (ชุดคำตอบ + แท็ก)
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ของเดิมใน 0001-0006
--
--  ตารางที่ใช้ (canned_responses / tags / conversation_tags) มีมาตั้งแต่ 0001 แล้ว
--  ไฟล์นี้เพิ่มแค่ฟังก์ชันกับ index ที่ต้องใช้จริงตอนใช้งาน
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) นับจำนวนครั้งที่ใช้ชุดคำตอบ
--     ต้องเป็นฟังก์ชัน เพราะแอดมินหลายคนกดพร้อมกันได้
--     ถ้าอ่านค่ามาบวกในโค้ดแล้วเขียนกลับ ตัวเลขจะหายเมื่อกดชนกัน
-- ---------------------------------------------------------------------------
create or replace function bump_canned_use(p_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update canned_responses set use_count = use_count + 1 where id = p_id;
end
$$;

-- เรียงชุดคำตอบตาม "ใช้บ่อย" — ทำให้อันที่ใช้ประจำลอยขึ้นมาเอง
create index if not exists canned_use_count_idx on canned_responses (use_count desc);

-- ---------------------------------------------------------------------------
--  2) ใส่/ถอดแท็กของห้องแชท
--     รวมเป็นฟังก์ชันเดียวเพื่อให้ "ใส่ซ้ำ" ไม่พัง (กดรัว ๆ ได้)
-- ---------------------------------------------------------------------------
create or replace function set_conversation_tag(
  p_conversation_id uuid,
  p_tag_id          uuid,
  p_admin_id        uuid,
  p_attached        boolean
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_attached then
    insert into conversation_tags (conversation_id, tag_id, added_by)
    values (p_conversation_id, p_tag_id, p_admin_id)
    on conflict (conversation_id, tag_id) do nothing;
  else
    delete from conversation_tags
     where conversation_id = p_conversation_id and tag_id = p_tag_id;
  end if;
end
$$;

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
