-- ============================================================================
--  HubChat — 0005 : ทางเข้าของข้อมูล (webhook → ฐานข้อมูล)
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ของเดิมใน 0001 / 0002 / 0003 / 0004
--
--  หัวใจของไฟล์นี้คือ "ข้อความซ้ำต้องไม่เกิดสองแถว"
--  Meta ยิง webhook ซ้ำได้เสมอเมื่อเราตอบช้าหรือเน็ตสะดุด (สเปกหัวข้อ 6.3)
--  เราจึงกันซ้ำที่ระดับฐานข้อมูล ไม่ใช่ที่ระดับโค้ด
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) customers : จดว่าไปดึงชื่อ/รูปโปรไฟล์จาก Meta มาเมื่อไหร่
--     (ชื่อไม่ได้มากับ webhook ต้องยิงถามทีหลัง จึงต้องรู้ว่าถามไปหรือยัง)
-- ---------------------------------------------------------------------------
alter table customers add column if not exists profile_synced_at timestamptz;

-- แถวที่ยังไม่เคยดึงโปรไฟล์ — ตัวกวาดจะมาหยิบจาก index นี้
create index if not exists customers_profile_pending_idx
  on customers (created_at) where profile_synced_at is null;

-- ---------------------------------------------------------------------------
--  2) webhook_queue : จดเวลาที่หยิบงานไปทำ ไว้กันงานค้างสถานะ processing
-- ---------------------------------------------------------------------------
alter table webhook_queue add column if not exists claimed_at timestamptz;

-- งานที่ค้างอยู่ที่ processing นานเกินไป = process ตายกลางทาง ต้องเอากลับมาทำใหม่
create index if not exists webhook_queue_stale_idx
  on webhook_queue (claimed_at) where status = 'processing';

-- ---------------------------------------------------------------------------
--  3) หยิบงานจากคิวแบบ atomic
--     `for update skip locked` = ถ้ามี worker หลายตัว จะไม่หยิบงานชิ้นเดียวกัน
--     ตัวไหนจับไว้แล้ว ตัวอื่นข้ามไปเลย ไม่ต้องรอ
-- ---------------------------------------------------------------------------
create or replace function claim_webhook_jobs(
  p_limit          integer,
  p_max_attempts   integer,
  p_stale_seconds  integer
)
returns setof webhook_queue
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return query
  update webhook_queue q
     set status     = 'processing',
         attempts   = q.attempts + 1,
         claimed_at = now()
   where q.id in (
     select w.id
       from webhook_queue w
      where w.attempts < greatest(p_max_attempts, 1)
        and (
          w.status = 'pending'
          -- งานที่ค้างอยู่ที่ processing เกินเวลาที่กำหนด ถือว่า worker ตายไปแล้ว
          or (w.status = 'processing'
              and w.claimed_at is not null
              and w.claimed_at < now() - make_interval(secs => greatest(p_stale_seconds, 10)))
        )
      order by w.created_at
       limit greatest(p_limit, 1)
        for update skip locked
   )
  returning q.*;
end
$$;

-- ---------------------------------------------------------------------------
--  4) ปิดงานในคิว
--     ให้ฝั่งโค้ดเป็นคนตัดสินว่าจะ 'done' / 'failed' / กลับไป 'pending' เพื่อลองใหม่
--     (กฎการลองใหม่อยู่ในโค้ดที่มีชุดทดสอบ ไม่ซ่อนไว้ใน SQL)
-- ---------------------------------------------------------------------------
create or replace function finish_webhook_job(
  p_id     bigint,
  p_status queue_status_t,
  p_error  text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update webhook_queue
     set status        = p_status,
         error_message = p_error,
         claimed_at    = case when p_status = 'pending' then null else claimed_at end,
         processed_at  = case when p_status in ('done','failed') then now() else null end
   where id = p_id;
end
$$;

-- ---------------------------------------------------------------------------
--  ⭐ 5) บันทึกข้อความขาเข้า — ฟังก์ชันสำคัญที่สุดของรอบนี้
--
--  ลำดับสำคัญมาก และตั้งใจเรียงแบบนี้ :
--    1. สร้าง/หาลูกค้า            (ทำซ้ำได้ ไม่เปลี่ยนอะไรถ้ามีอยู่แล้ว)
--    2. สร้าง/หาห้องแชท           (ทำซ้ำได้)
--    3. ใส่ข้อความ แบบ "ซ้ำแล้วข้าม"
--    4. ⚠️ อัปเดตเวลา/ตัวอย่างข้อความ/สถานะยังไม่อ่าน เฉพาะตอนที่ข้อความใหม่จริง
--
--  ถ้าเอาข้อ 4 ไปไว้ก่อนข้อ 3 แล้ว Meta ยิงซ้ำ
--  ห้องแชทที่แอดมินเพิ่งอ่านไปจะกลับมาเป็น "ยังไม่อ่าน" ทั้งที่ไม่มีข้อความใหม่
-- ---------------------------------------------------------------------------
create or replace function ingest_inbound_message(
  p_page_id           uuid,
  p_psid              text,
  p_platform          platform_t,
  p_meta_message_id   text,
  p_text              text,
  p_attachments       jsonb,
  p_sent_at           timestamptz,
  p_referral_source   referral_source_t,
  p_referral_ad_id    text,
  p_referral_post_id  text,
  p_referral_ref      text
)
returns table (
  message_id      uuid,
  conversation_id uuid,
  customer_id     uuid,
  duplicate       boolean
)
language plpgsql
set search_path = public, pg_temp
as $$
-- ⚠️ ชื่อคอลัมน์ผลลัพธ์ข้างบน (customer_id / conversation_id) ชนกับชื่อคอลัมน์จริงในตาราง
--    บรรทัดนี้บอก PostgreSQL ว่า "ถ้าชื่อชนกัน ให้หมายถึงคอลัมน์ของตารางเสมอ"
--    จำเป็นเพราะ `on conflict (customer_id)` เขียนชื่อตารางนำหน้าไม่ได้ตามไวยากรณ์
#variable_conflict use_column
declare
  v_customer uuid;
  v_conv     uuid;
  v_msg      uuid;
  v_preview  text;
begin
  -- ตัวอย่างข้อความที่โชว์ในลิสต์แชท — ตัดให้สั้น ไม่ต้องเก็บทั้งก้อน
  v_preview := case
    when p_text is not null and length(trim(p_text)) > 0 then left(trim(p_text), 200)
    when jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 then '[ไฟล์แนบ]'
    else null
  end;

  ------------------------------------------------------------------ 1) ลูกค้า
  insert into customers (page_id, psid, platform, first_contact_at)
  values (p_page_id, p_psid, p_platform, p_sent_at)
  on conflict (page_id, psid) do update
    -- ไม่มีอะไรต้องแก้ ใส่ไว้เพื่อให้ RETURNING คืนแถวเดิมกลับมาเสมอ
    set first_contact_at = least(customers.first_contact_at, p_sent_at)
  returning id into v_customer;

  ----------------------------------------------------------------- 2) ห้องแชท
  insert into conversations (customer_id, page_id, last_message_at)
  values (v_customer, p_page_id, p_sent_at)
  on conflict (customer_id) do update
    set page_id = conversations.page_id
  returning id into v_conv;

  ---------------------------------------------------- 3) ข้อความ (ซ้ำแล้วข้าม)
  -- ⚠️ ต้องเขียน `where meta_message_id is not null` ให้ตรงกับเงื่อนไขของ
  --    unique index ตัวจริง (messages_meta_id_uniq เป็น partial index)
  --    ไม่งั้น Postgres จะหา index ที่จะใช้กันซ้ำไม่เจอ
  insert into messages (
    conversation_id, direction, sender_type, text, attachments, meta_message_id, created_at
  ) values (
    v_conv, 'in', 'customer', p_text, coalesce(p_attachments, '[]'::jsonb), p_meta_message_id, p_sent_at
  )
  on conflict (meta_message_id) where meta_message_id is not null do nothing
  returning id into v_msg;

  if not found then
    -- เคยบันทึกข้อความนี้ไปแล้ว → ไม่แตะอะไรอีกเลย
    select m.id into v_msg from messages m where m.meta_message_id = p_meta_message_id;
    return query select v_msg, v_conv, v_customer, true;
    return;
  end if;

  ------------------------------------------- 4) ผลข้างเคียงของ "ข้อความใหม่จริง"
  update customers c
     set last_customer_message_at = greatest(coalesce(c.last_customer_message_at, p_sent_at), p_sent_at)
   where c.id = v_customer;

  update conversations cv
     set last_message_at          = greatest(cv.last_message_at, p_sent_at),
         -- โชว์ตัวอย่างของข้อความล่าสุดจริง ๆ เท่านั้น
         -- (webhook มาถึงสลับลำดับได้ ข้อความเก่าที่มาช้าต้องไม่ทับของใหม่)
         last_message_preview     = case when p_sent_at >= cv.last_message_at
                                         then v_preview else cv.last_message_preview end,
         last_customer_message_at = greatest(coalesce(cv.last_customer_message_at, p_sent_at), p_sent_at),
         is_read                  = false,
         -- ที่มาของแชท : ถ้ารอบนี้มีข้อมูลที่มา ให้ทับของเดิม (คลิกแอดใหม่ = ที่มาใหม่)
         --               ถ้าไม่มี ให้เก็บของเดิมไว้ ห้ามลบทิ้ง
         referral_source          = coalesce(p_referral_source,  cv.referral_source),
         referral_ad_id           = coalesce(p_referral_ad_id,   cv.referral_ad_id),
         referral_post_id         = coalesce(p_referral_post_id, cv.referral_post_id),
         referral_ref             = coalesce(p_referral_ref,     cv.referral_ref)
   where cv.id = v_conv;

  return query select v_msg, v_conv, v_customer, false;
end
$$;

-- ---------------------------------------------------------------------------
--  6) บันทึกข้อความ "ขาออก" ที่มาจาก echo ของ Meta
--
--  echo คือสำเนาที่ Meta ส่งกลับมาบอกว่า "เพจนี้เพิ่งส่งข้อความออกไป"
--  สำคัญมากเพราะสเปกบอกว่าห้ามเลิกใช้ Business Suite จนระบบใหม่นิ่ง
--  → ข้อความที่แอดมินตอบจาก Business Suite ต้องโผล่ในระบบเราด้วย
--    ไม่งั้นแอดมินอีกคนจะเห็นแชทไม่ครบแล้วตอบซ้ำ
--
--  ข้อความที่ระบบเราส่งเองก็จะได้ echo กลับมาเหมือนกัน
--  แต่กันซ้ำได้ด้วย meta_message_id ที่เราบันทึกไว้ตอนส่ง
-- ---------------------------------------------------------------------------
create or replace function ingest_echo_message(
  p_page_id         uuid,
  p_psid            text,
  p_platform        platform_t,
  p_meta_message_id text,
  p_text            text,
  p_attachments     jsonb,
  p_sent_at         timestamptz
)
returns table (
  message_id      uuid,
  conversation_id uuid,
  customer_id     uuid,
  duplicate       boolean
)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_customer uuid;
  v_conv     uuid;
  v_msg      uuid;
  v_preview  text;
begin
  v_preview := case
    when p_text is not null and length(trim(p_text)) > 0 then left(trim(p_text), 200)
    when jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 then '[ไฟล์แนบ]'
    else null
  end;

  insert into customers (page_id, psid, platform, first_contact_at)
  values (p_page_id, p_psid, p_platform, p_sent_at)
  on conflict (page_id, psid) do update
    set first_contact_at = least(customers.first_contact_at, p_sent_at)
  returning id into v_customer;

  insert into conversations (customer_id, page_id, last_message_at)
  values (v_customer, p_page_id, p_sent_at)
  on conflict (customer_id) do update
    set page_id = conversations.page_id
  returning id into v_conv;

  insert into messages (
    conversation_id, direction, sender_type, text, attachments, meta_message_id, created_at
  ) values (
    v_conv, 'out', 'admin', p_text, coalesce(p_attachments, '[]'::jsonb), p_meta_message_id, p_sent_at
  )
  on conflict (meta_message_id) where meta_message_id is not null do nothing
  returning id into v_msg;

  if not found then
    select m.id into v_msg from messages m where m.meta_message_id = p_meta_message_id;
    return query select v_msg, v_conv, v_customer, true;
    return;
  end if;

  update conversations cv
     set last_message_at      = greatest(cv.last_message_at, p_sent_at),
         last_message_preview = case when p_sent_at >= cv.last_message_at
                                     then v_preview else cv.last_message_preview end
   where cv.id = v_conv;

  -- ⚠️ อัปเดตเฉพาะเวลาที่ "ฝั่งเรา" ตอบ
  --    ห้ามแตะ last_customer_message_at เด็ดขาด นั่นคือประวัติจริงที่ Policy Engine ใช้
  update customers c
     set last_admin_message_at = greatest(coalesce(c.last_admin_message_at, p_sent_at), p_sent_at)
   where c.id = v_customer;

  return query select v_msg, v_conv, v_customer, false;
end
$$;

-- ---------------------------------------------------------------------------
--  7) บันทึกข้อความ "ขาออก" ที่ส่งสำเร็จแล้ว ลงประวัติแชท
--     เรียกจาก sendMessage() หลังจาก Policy Engine อนุมัติและ Meta ตอบ ok
--     (D-4 ในรายการที่จดไว้ตั้งแต่รอบ 2)
-- ---------------------------------------------------------------------------
create or replace function record_outbound_message(
  p_conversation_id uuid,
  p_admin_id        uuid,
  p_sender_type     sender_type_t,
  p_text            text,
  p_attachments     jsonb,
  p_meta_message_id text,
  p_human_agent_tag boolean
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
    meta_message_id, sent_with_human_agent_tag
  ) values (
    p_conversation_id, 'out', p_sender_type, p_admin_id, p_text,
    coalesce(p_attachments, '[]'::jsonb), p_meta_message_id, coalesce(p_human_agent_tag, false)
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
--  ตรวจผล : ฟังก์ชันที่เราเขียนเองต้องล็อก search_path ครบทุกตัว (ต่อจาก 0004)
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
