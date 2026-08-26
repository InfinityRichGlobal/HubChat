-- ============================================================================
--  HubChat — 0012 : Dashboard + ฟีดคอมเมนต์ (สเปกหัวข้อ 5.4 + 5.5 + 6.4)
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ของเดิมใน 0001-0011
--
--  🔴 สองเรื่องที่ไฟล์นี้ต้องบังคับให้ได้ :
--
--    1. คอมเมนต์เดิมจาก Meta เข้ามาซ้ำได้เสมอ → ต้องกันซ้ำที่ฐานข้อมูล
--    2. "ตอบส่วนตัว" (private reply) ทำได้ครั้งเดียวต่อคอมเมนต์ตลอดกาล
--       เป็นกฎของ Meta เอง (หัวข้อ 6.4) ยิงซ้ำ = error และเสี่ยงถูกมองว่าสแปม
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) comments — เติมสิ่งที่ต้องใช้ตอนทำงานจริง
-- ---------------------------------------------------------------------------
alter table comments add column if not exists post_permalink   text;
alter table comments add column if not exists attachment_url   text;
alter table comments add column if not exists matched_keyword  text;
alter table comments add column if not exists is_hidden        boolean not null default false;
alter table comments add column if not exists is_from_page     boolean not null default false;
alter table comments add column if not exists commented_at     timestamptz;
alter table comments add column if not exists customer_id      uuid references customers(id) on delete set null;
alter table comments add column if not exists conversation_id  uuid references conversations(id) on delete set null;
alter table comments add column if not exists private_reply_at timestamptz;
alter table comments add column if not exists public_reply_at  timestamptz;
alter table comments add column if not exists public_reply_text  text;
alter table comments add column if not exists private_reply_text text;
alter table comments add column if not exists last_error_th    text;
alter table comments add column if not exists raw              jsonb not null default '{}'::jsonb;

/**
 * ⭐ กันคอมเมนต์ซ้ำ — ใช้ `comments_meta_id_uniq` ที่มีอยู่แล้วตั้งแต่ 0001
 *    ซึ่งเป็น unique บน comment_id เดี่ยว ๆ
 *
 * 🔴 บทเรียน : ตอนแรกเผลอสร้าง unique (page_id, comment_id) ขึ้นมาใหม่
 *    แล้วใช้เป็นเป้าของ `on conflict` — ผลคือถ้าชนกับ index เดิม
 *    คำสั่งจะ "โยน error" แทนที่จะรู้ว่าเป็นของซ้ำ แล้วสายรับข้อมูลจะพัง
 *    ชุดทดสอบ PostgreSQL จับได้ (ฐานข้อมูลปลอมจับไม่ได้เพราะไม่มี index เดิม)
 *
 *    id ของคอมเมนต์ฝั่ง Meta เป็นรูปแบบ "{post}_{comment}" ซึ่งไม่ซ้ำข้ามเพจอยู่แล้ว
 *    index เดิมจึงถูกต้องและเข้มกว่า — ใช้ตัวนั้นเป็นเป้าเดียว
 */
create index if not exists comments_page_comment_idx
  on comments (page_id, comment_id);

create index if not exists comments_unhandled_idx
  on comments (page_id, created_at desc) where is_handled = false;
create index if not exists comments_keyword_idx
  on comments (matched_keyword, created_at desc) where matched_keyword is not null;
create index if not exists comments_post_idx on comments (post_id, created_at desc);

-- ---------------------------------------------------------------------------
--  2) ⭐ ingest_comment — บันทึกคอมเมนต์แบบกันซ้ำ
--
--  คืน (comment_row_id, duplicate)
--    duplicate = true → เคยได้รับคอมเมนต์นี้แล้ว ห้ามนับซ้ำ ห้ามแจ้งเตือนซ้ำ
--
--  ⚠️ ใช้ insert ... on conflict do nothing returning เหมือนที่ใช้กับข้อความ
--     ห้ามเปลี่ยนไปใช้ "select ก่อนแล้วค่อย insert" เด็ดขาด
-- ---------------------------------------------------------------------------
create or replace function ingest_comment(
  p_page_id         uuid,
  p_comment_id      text,
  p_post_id         text,
  p_parent_id       text,
  p_from_id         text,
  p_from_name       text,
  p_message         text,
  p_permalink       text,
  p_attachment_url  text,
  p_matched_keyword text,
  p_is_from_page    boolean,
  p_commented_at    timestamptz,
  p_raw             jsonb
)
returns table (comment_row_id uuid, duplicate boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  insert into comments (
    page_id, comment_id, post_id, parent_comment_id,
    from_id, from_name, message, post_permalink, attachment_url,
    matched_keyword, is_from_page, commented_at, raw,
    -- คอมเมนต์ของเพจเราเอง ไม่ต้องให้แอดมินมาจัดการ
    is_handled
  ) values (
    p_page_id, p_comment_id, p_post_id, nullif(p_parent_id, ''),
    p_from_id, p_from_name, p_message, p_permalink, p_attachment_url,
    p_matched_keyword, coalesce(p_is_from_page, false),
    coalesce(p_commented_at, now()), coalesce(p_raw, '{}'::jsonb),
    coalesce(p_is_from_page, false)
  )
  -- เป้าของ on conflict ต้องเป็น index ที่มีอยู่จริงและเข้มที่สุด
  on conflict (comment_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- ค้นด้วย comment_id อย่างเดียว ให้ตรงกับ index ที่ใช้เป็นเป้า
    select c.id into v_id from comments c where c.comment_id = p_comment_id;
    return query select v_id, true;
    return;
  end if;

  return query select v_id, false;
end
$$;

-- ---------------------------------------------------------------------------
--  3) ⭐ claim_private_reply — จองสิทธิ์ตอบส่วนตัว "ครั้งเดียวตลอดกาล"
--
--  🔴 กฎของ Meta (สเปก 6.4) : private reply ทำได้ครั้งเดียวต่อคอมเมนต์
--     ยิงซ้ำ = error กลับมา และถ้าทำบ่อยจะถูกมองว่าใช้งานผิดวิธี
--
--  ⚠️ ต้องจองก่อนยิงเสมอ ไม่ใช่ยิงแล้วค่อยจด
--     ถ้าจดทีหลัง จังหวะที่สองคำขอมาพร้อมกันจะยิงทั้งคู่
-- ---------------------------------------------------------------------------
create or replace function claim_private_reply(p_comment_row_id uuid, p_admin_id uuid)
returns table (won boolean, reason_th text)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_row comments%rowtype;
begin
  select * into v_row from comments where id = p_comment_row_id for update;
  if not found then
    return query select false, 'ไม่พบคอมเมนต์นี้'::text;
    return;
  end if;

  if v_row.is_from_page then
    return query select false, 'คอมเมนต์นี้เป็นของเพจเราเอง ไม่ต้องตอบส่วนตัว'::text;
    return;
  end if;

  if v_row.replied_private then
    return query select false, 'คอมเมนต์นี้เคยตอบส่วนตัวไปแล้ว — Meta อนุญาตครั้งเดียวเท่านั้น'::text;
    return;
  end if;

  /**
   * ⚠️ กรอบเวลา 7 วันของ Meta
   *    เช็คที่นี่ด้วย เพื่อไม่ให้ยิงออกไปทั้งที่รู้อยู่แล้วว่าจะโดนปฏิเสธ
   *    (ยิงแล้วโดนปฏิเสธบ่อย ๆ ส่งผลเสียต่อความน่าเชื่อถือของแอป)
   */
  if coalesce(v_row.commented_at, v_row.created_at) < now() - interval '7 days' then
    return query select false, 'คอมเมนต์นี้เก่าเกิน 7 วัน — Meta ไม่อนุญาตให้ตอบส่วนตัวแล้ว'::text;
    return;
  end if;

  update comments
     set replied_private = true,
         private_reply_at = now(),
         handled_by = coalesce(handled_by, p_admin_id)
   where id = p_comment_row_id;

  return query select true, null::text;
end
$$;

-- ---------------------------------------------------------------------------
--  4) release_private_reply — คืนสิทธิ์เมื่อยิงแล้วรู้แน่ว่าไม่ถึง
--
--  ⚠️ เรียกได้เฉพาะกรณีที่ "รู้แน่ชัดว่า Meta ปฏิเสธ" เท่านั้น
--     ถ้าไม่ทราบผล ห้ามคืนสิทธิ์เด็ดขาด — ยอมเสียสิทธิ์ ดีกว่าลูกค้าได้ข้อความซ้ำ
-- ---------------------------------------------------------------------------
create or replace function release_private_reply(p_comment_row_id uuid, p_error_th text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update comments
     set replied_private  = false,
         private_reply_at = null,
         last_error_th    = left(p_error_th, 500)
   where id = p_comment_row_id;
end
$$;

-- ---------------------------------------------------------------------------
--  5) finish_private_reply / finish_public_reply — จดผล
-- ---------------------------------------------------------------------------
create or replace function finish_private_reply(
  p_comment_row_id  uuid,
  p_text            text,
  p_conversation_id uuid,
  p_customer_id     uuid
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update comments
     set private_reply_text = p_text,
         conversation_id    = coalesce(p_conversation_id, conversation_id),
         customer_id        = coalesce(p_customer_id, customer_id),
         is_handled         = true,
         handled_at         = coalesce(handled_at, now()),
         last_error_th      = null
   where id = p_comment_row_id;
end
$$;

create or replace function finish_public_reply(
  p_comment_row_id uuid,
  p_admin_id       uuid,
  p_text           text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update comments
     set replied_public    = true,
         public_reply_at   = now(),
         public_reply_text = p_text,
         is_handled        = true,
         handled_by        = coalesce(handled_by, p_admin_id),
         handled_at        = coalesce(handled_at, now()),
         last_error_th     = null
   where id = p_comment_row_id;
end
$$;

-- ---------------------------------------------------------------------------
--  6) ⭐ index ที่ Dashboard ใช้จริง
--
--  Dashboard นับของย้อนหลังเป็นช่วงเวลา ถ้าไม่มี index พวกนี้
--  ทุกครั้งที่เปิดหน้าจะไล่อ่านทั้งตาราง ซึ่งจะช้าขึ้นเรื่อย ๆ ตามอายุร้าน
-- ---------------------------------------------------------------------------
create index if not exists orders_created_at_idx   on orders (created_at desc);
create index if not exists orders_closed_at_idx    on orders (closed_at desc) where closed_at is not null;
create index if not exists orders_referral_ad_idx  on orders (referral_ad_id, created_at desc)
  where referral_ad_id is not null;
create index if not exists conv_first_seen_idx     on conversations (created_at desc);
create index if not exists customers_first_contact_idx
  on customers (first_contact_at desc) where first_contact_at is not null;

-- ---------------------------------------------------------------------------
--  7) ตรวจผล
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
