-- ============================================================================
--  HubChat — 0014 : ดึงชื่อ/รูปลูกค้าให้สำเร็จจริง (แก้ D-33)
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ของเดิมใน 0001-0013
--
--  🔴 ปัญหาที่ไฟล์นี้แก้ (บั๊กจริงที่เจอตอนใช้งาน)
--  ---------------------------------------------------------------------------
--  เดิม `syncProfileIfNeeded()` จด `profile_synced_at` **ทุกครั้งแม้ดึงไม่สำเร็จ**
--  แล้วรอบถัดไปเช็คว่า "ถ้าเคยจดแล้ว ให้ข้าม"
--
--  ผลคือ : ลูกค้าที่ดึงชื่อพลาดครั้งแรก จะไม่มีวันถูกดึงใหม่อีกเลย **ตลอดกาล**
--          ต่อให้เจ้าของร้านไปแก้สิทธิ์ Meta ให้ถูกแล้วก็ตาม
--          ลิสต์แชทจึงค้างเป็น "ลูกค้า xxxxxx" ถาวร
--
--  เดิมตั้งใจให้ "ไม่วนยิงถาม Meta ทุกข้อความ" ซึ่งถูก
--  แต่วิธีที่ใช้เหมารวมเอา "ล้มเหลว" ไปปนกับ "สำเร็จ" — เลยกลายเป็นยอมแพ้ถาวร
--
--  ⭐ หลังไฟล์นี้ :
--     profile_synced_at  = จดเฉพาะตอน "ได้ข้อมูลมาจริง" เท่านั้น
--     profile_attempts   = พยายามไปกี่ครั้งแล้ว (ใช้คำนวณว่าจะรอนานแค่ไหนก่อนลองใหม่)
--     profile_error_*    = พลาดเพราะอะไร เพื่อให้ไล่ปัญหาต่อได้จริง
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) คอลัมน์ใหม่บน customers
-- ---------------------------------------------------------------------------
alter table customers add column if not exists profile_attempts        integer not null default 0;
alter table customers add column if not exists profile_last_attempt_at timestamptz;
/** kind จาก classifyMetaError : transient / policy / permanent / ambiguous */
alter table customers add column if not exists profile_error_kind      text;
alter table customers add column if not exists profile_error_code      integer;
/** ข้อความไทยที่แอดมินอ่านแล้วรู้ว่าต้องทำอะไรต่อ — ⚠️ ห้ามใส่ token ลงไป */
alter table customers add column if not exists profile_error_th        text;

/**
 * ⭐ index สำหรับ "ใครยังไม่มีชื่อและถึงเวลาลองใหม่"
 *    เงื่อนไขบางส่วน (partial) เพราะลูกค้าส่วนใหญ่ดึงสำเร็จแล้ว ไม่ต้องอยู่ใน index
 */
create index if not exists customers_profile_pending_idx
  on customers (profile_last_attempt_at nulls first)
  where profile_synced_at is null;

-- ---------------------------------------------------------------------------
--  2) 🔴 ซ่อมข้อมูลเดิมที่ถูกตีตราว่า "ดึงแล้ว" ทั้งที่ไม่เคยได้อะไรมา
--
--  กฎที่ใช้ตัดสิน (ตรงไปตรงมา ไม่เดา) :
--    เคยจดว่าดึงแล้ว  +  ไม่มีทั้งชื่อและรูป  =  ครั้งนั้นล้มเหลวแน่นอน
--
--  ⚠️ ไม่แตะแถวที่มีชื่อหรือรูปอยู่แล้วเด็ดขาด — ของที่ใช้ได้อยู่ห้ามยุ่ง
--  ⚠️ รันซ้ำได้ เพราะรอบสองจะไม่เข้าเงื่อนไขแล้ว (profile_synced_at เป็น null ไปแล้ว)
-- ---------------------------------------------------------------------------
update customers
   set profile_synced_at = null,
       profile_attempts  = 0,
       profile_error_th  = 'เคยดึงไม่สำเร็จแล้วระบบยอมแพ้ถาวร (D-33) — ปลดล็อกให้ลองใหม่แล้ว'
 where profile_synced_at is not null
   and (name is null or btrim(name) = '')
   and (profile_pic_url is null or btrim(profile_pic_url) = '');

-- ---------------------------------------------------------------------------
--  3) ⭐ claim_profile_sync — จองสิทธิ์ไปดึงโปรไฟล์ แบบไม่ยิงถี่เกินไป
--
--  คืน (claimed, attempt)
--    claimed = false → ยังไม่ถึงเวลา / ได้ชื่อแล้ว / ลองครบโควตาแล้ว
--
--  🔴 ต้องเป็น update ... returning ในคำสั่งเดียว
--     ถ้าแยกเป็น select แล้วค่อย update สอง worker จะยิงถาม Meta พร้อมกัน
--     (บทเรียนเดียวกับการกันส่งข้อความซ้ำ)
--
--  ⏱ ระยะห่างก่อนลองใหม่ เพิ่มขึ้นเรื่อย ๆ ตามจำนวนครั้งที่พลาด :
--     ครั้งที่ 1 → รอ 1 นาที      (ส่วนใหญ่เป็นความสะดุดชั่วคราว)
--     ครั้งที่ 2 → รอ 10 นาที
--     ครั้งที่ 3 → รอ 1 ชั่วโมง
--     ครั้งที่ 4 → รอ 6 ชั่วโมง
--     ครั้งที่ 5+ → รอ 24 ชั่วโมง  (เผื่อเจ้าของร้านไปแก้สิทธิ์ Meta แล้วกลับมาได้เอง)
--
--  ⭐ ที่ยังลองต่อแม้จะพลาดหลายครั้ง เพราะสาเหตุที่พบบ่อยที่สุดคือ "สิทธิ์ยังไม่ครบ"
--     ซึ่งเป็นสิ่งที่เจ้าของร้านแก้ทีหลังได้ — ระบบจึงต้องกลับมาถามใหม่เองเป็นระยะ
--     แต่ต้องมีเพดาน ไม่งั้นลูกค้าที่ตั้งค่าความเป็นส่วนตัวไว้จะโดนถามไม่เลิก
-- ---------------------------------------------------------------------------
create or replace function claim_profile_sync(p_customer_id uuid, p_max_attempts integer)
returns table (claimed boolean, attempt integer)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_attempt integer;
begin
  update customers c
     set profile_attempts        = c.profile_attempts + 1,
         profile_last_attempt_at = now()
   where c.id = p_customer_id
     and c.profile_synced_at is null
     and c.profile_attempts < greatest(coalesce(p_max_attempts, 8), 1)
     and (
       c.profile_last_attempt_at is null
       or c.profile_last_attempt_at < now() - (
            case c.profile_attempts
              when 0 then interval '0 second'
              when 1 then interval '1 minute'
              when 2 then interval '10 minutes'
              when 3 then interval '1 hour'
              when 4 then interval '6 hours'
              else        interval '24 hours'
            end
          )
     )
  returning c.profile_attempts into v_attempt;

  if v_attempt is null then
    return query select false, 0;
    return;
  end if;

  return query select true, v_attempt;
end
$$;

-- ---------------------------------------------------------------------------
--  4) finish_profile_sync — จดผล
--
--  🔴 ห้ามเขียนทับชื่อจริงด้วยค่าว่างเด็ดขาด
--     ถ้าครั้งนี้ Meta ไม่คืนชื่อมา แต่เราเคยได้ชื่อไว้แล้ว ต้องเก็บของเดิมไว้
--     (เคยได้ชื่อแล้วกลับกลายเป็น "ลูกค้า xxxxxx" คือความถดถอยที่แอดมินรับไม่ได้)
--
--  ⭐ สำเร็จ = ได้ชื่อ **หรือ** รูป อย่างน้อยหนึ่งอย่าง
--     ได้รูปอย่างเดียวก็ยังดีกว่าไม่ได้อะไร และไม่ต้องไปถาม Meta ซ้ำ
-- ---------------------------------------------------------------------------
create or replace function finish_profile_sync(
  p_customer_id uuid,
  p_name        text,
  p_pic_url     text,
  p_error_kind  text,
  p_error_code  integer,
  p_error_th    text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_has_name boolean := p_name    is not null and btrim(p_name)    <> '';
  v_has_pic  boolean := p_pic_url is not null and btrim(p_pic_url) <> '';
begin
  if v_has_name or v_has_pic then
    update customers
       set name              = case when v_has_name then btrim(p_name)    else name            end,
           profile_pic_url   = case when v_has_pic  then btrim(p_pic_url) else profile_pic_url end,
           profile_synced_at = now(),
           profile_error_kind = null,
           profile_error_code = null,
           profile_error_th   = null
     where id = p_customer_id;
  else
    -- ⚠️ ไม่แตะ profile_synced_at — ปล่อยให้เป็น null เพื่อให้กลับมาลองใหม่ได้
    update customers
       set profile_error_kind = left(p_error_kind, 40),
           profile_error_code = p_error_code,
           profile_error_th   = left(p_error_th, 300)
     where id = p_customer_id;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
--  5) reset_profile_sync — ปุ่ม "ลองดึงชื่ออีกครั้ง" ของแอดมิน
--
--  ⭐ ล้างจำนวนครั้งที่พลาดทิ้ง เพื่อให้เริ่มนับใหม่ทันที
--     ใช้ตอนเจ้าของร้านเพิ่งแก้สิทธิ์ Meta เสร็จ แล้วอยากเห็นผลเดี๋ยวนี้
--     ไม่ต้องรอ 24 ชั่วโมงตามจังหวะปกติ
-- ---------------------------------------------------------------------------
create or replace function reset_profile_sync(p_customer_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update customers
     set profile_synced_at       = null,
         profile_attempts        = 0,
         profile_last_attempt_at = null,
         profile_error_kind      = null,
         profile_error_code      = null,
         profile_error_th        = null
   where id = p_customer_id;
end
$$;

-- ---------------------------------------------------------------------------
--  6) ตรวจผล
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
