-- ============================================================================
--  HubChat — 0013 : ระบบแจ้งเตือน (สเปกหัวข้อ 6.7)
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ของเดิมใน 0001-0012
--
--  🔴 สองเรื่องที่ไฟล์นี้ต้องบังคับให้ได้ :
--
--    1. เหตุการณ์เดียว แจ้งเตือนคนเดียวกัน ได้ครั้งเดียว
--       (ไม่งั้นแอดมินจะโดนสแปมจนปิดแจ้งเตือน แล้วระบบก็ไร้ประโยชน์)
--
--    2. Telegram จำกัด ~20 ข้อความ/นาทีต่อกลุ่ม → ต้อง "รวบส่ง" ไม่ใช่ส่งทีละข้อความ
--       จึงต้องมีคิวที่รู้ว่าอะไรยังไม่ถูกรวบส่ง
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) ชนิดข้อมูลใหม่
-- ---------------------------------------------------------------------------
do $$ begin
  create type notify_channel_t as enum ('push', 'telegram');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notify_job_status_t as enum ('queued', 'sent', 'failed', 'skipped');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
--  2) notification_jobs — คิวแจ้งเตือน
--
--  ⭐ กุญแจกันซ้ำคือ dedupe_key
--     ประกอบจาก "เหตุการณ์ + สิ่งที่อ้างถึง + คนรับ + ช่องทาง"
--     เช่น  new_chat:<conversation_id>:<admin_id>:push
--     → เหตุการณ์เดิมยิงซ้ำกี่รอบ ก็ได้แถวเดียว
-- ---------------------------------------------------------------------------
create table if not exists notification_jobs (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references admins(id) on delete cascade,
  channel      notify_channel_t not null,
  event        text not null,
  dedupe_key   text not null,

  page_id         uuid references pages(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,

  title        text not null,
  body         text not null,
  /** ลิงก์ที่จะเปิดเมื่อกดแจ้งเตือน */
  link         text,
  payload      jsonb not null default '{}'::jsonb,

  status       notify_job_status_t not null default 'queued',
  error_text   text,
  attempt_count integer not null default 0,

  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

/**
 * 🔴 หัวใจของไฟล์นี้ — หนึ่งเหตุการณ์ต่อหนึ่งคนต่อหนึ่งช่องทาง = แถวเดียวตลอดกาล
 *    เดิมไม่มีตัวนี้ แอดมินจะโดนแจ้งซ้ำทุกครั้งที่ worker วนรอบ
 */
create unique index if not exists notification_dedupe_uniq
  on notification_jobs (dedupe_key);

create index if not exists notification_queue_idx
  on notification_jobs (status, channel, created_at) where status = 'queued';
create index if not exists notification_admin_idx
  on notification_jobs (admin_id, created_at desc);

alter table notification_jobs enable row level security;

-- ---------------------------------------------------------------------------
--  3) push_subscriptions — เพิ่มสิ่งที่ต้องใช้ตอนทำงานจริง
-- ---------------------------------------------------------------------------
alter table push_subscriptions add column if not exists failure_count integer not null default 0;
alter table push_subscriptions add column if not exists disabled_at   timestamptz;
alter table push_subscriptions add column if not exists user_agent    text;

/**
 * ⭐ endpoint เดียวกัน = เครื่องเดียวกัน ห้ามมีสองแถว
 *    ไม่งั้นแอดมินเปิดหน้าเว็บซ้ำ ๆ จะได้แจ้งเตือนหลายรอบต่อหนึ่งเหตุการณ์
 */
create unique index if not exists push_endpoint_uniq on push_subscriptions (endpoint);
create index if not exists push_admin_live_idx
  on push_subscriptions (admin_id) where disabled_at is null;

-- ---------------------------------------------------------------------------
--  4) ⭐ queue_notification — เข้าคิวแบบกันซ้ำ
--
--  คืน (job_id, created)
--    created = false → เคยเข้าคิวเหตุการณ์นี้ให้คนนี้แล้ว ห้ามนับซ้ำ
-- ---------------------------------------------------------------------------
create or replace function queue_notification(
  p_admin_id        uuid,
  p_channel         notify_channel_t,
  p_event           text,
  p_dedupe_key      text,
  p_page_id         uuid,
  p_conversation_id uuid,
  p_title           text,
  p_body            text,
  p_link            text,
  p_payload         jsonb
)
returns table (job_id uuid, created boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  insert into notification_jobs (
    admin_id, channel, event, dedupe_key, page_id, conversation_id,
    title, body, link, payload
  ) values (
    p_admin_id, p_channel, p_event, p_dedupe_key, p_page_id, p_conversation_id,
    p_title, p_body, p_link, coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    select j.id into v_id from notification_jobs j where j.dedupe_key = p_dedupe_key;
    return query select v_id, false;
    return;
  end if;

  return query select v_id, true;
end
$$;

-- ---------------------------------------------------------------------------
--  5) ⭐ claim_notifications — หยิบงานมาส่ง แบบที่คนอื่นหยิบซ้ำไม่ได้
--
--  ⚠️ update ... where status='queued' returning = อะตอมมิกในตัวเอง
--     สอง worker ยิงพร้อมกันจะได้คนละชุด ไม่ทับกัน
-- ---------------------------------------------------------------------------
create or replace function claim_notifications(p_channel notify_channel_t, p_limit integer)
returns setof notification_jobs
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return query
  update notification_jobs j
     set status = 'sent',            -- จองไว้ก่อน แล้วค่อยแก้เป็น failed ถ้าส่งไม่ได้
         attempt_count = j.attempt_count + 1,
         sent_at = now()
   where j.id in (
     select k.id from notification_jobs k
      where k.status = 'queued' and k.channel = p_channel
      order by k.created_at asc
      limit greatest(coalesce(p_limit, 20), 1)
      for update skip locked
   )
  returning j.*;
end
$$;

/**
 * 🔴 ส่งไม่สำเร็จ = ต้อง "เอากลับเข้าคิว" ไม่ใช่ทิ้งทันที
 *
 *    เหตุผลที่พลาดไม่ได้ :
 *      กุญแจกันซ้ำ (dedupe_key) บล็อกการเข้าคิวซ้ำตลอดกาล
 *      ถ้าครั้งแรกส่งไม่สำเร็จแล้วเราตีเป็น failed ทันที
 *      เหตุการณ์นั้นจะ "หายไปตลอดกาล" — ตัวเดินตรวจรอบหน้าก็เข้าคิวใหม่ไม่ได้
 *      = เน็ตสะดุด 10 วินาที แล้วลูกค้าคนนั้นไม่มีใครรู้ว่ารออยู่
 *
 *    จึงให้ลองได้ 3 ครั้ง แล้วค่อยยอมแพ้
 *    (claim_notifications เป็นคนบวก attempt_count ทุกครั้งที่หยิบไป)
 *
 * ⚠️ ยอมแพ้แล้วต้องไม่วนต่อ — ไม่งั้นปลายทางที่ตายจริงจะถูกยิงไม่เลิก
 */
create or replace function fail_notification(p_job_id uuid, p_error text)
returns table (requeued boolean)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
begin
  select j.attempt_count into v_attempts from notification_jobs j where j.id = p_job_id;
  if v_attempts is null then
    return query select false;
    return;
  end if;

  if v_attempts < 3 then
    update notification_jobs
       set status = 'queued', error_text = left(p_error, 500), sent_at = null
     where id = p_job_id;
    return query select true;
  else
    update notification_jobs
       set status = 'failed', error_text = left(p_error, 500)
     where id = p_job_id;
    return query select false;
  end if;
end
$$;

/**
 * ⭐ เอากลับเข้าคิวโดย "ไม่นับว่าเป็นความล้มเหลว"
 *
 *    ใช้กับกรณีเดียว : Telegram รวบข้อความแล้วยาวเกินเพดาน
 *    ส่วนที่ล้นออกมาไม่ได้ส่งจริง แต่ถูกหยิบออกจากคิวไปแล้ว
 *    ถ้าไม่คืนกลับ มันจะถูกตีว่า "ส่งแล้ว" ทั้งที่ไม่มีใครได้เห็น
 *
 *    ต้องลด attempt_count กลับด้วย ไม่งั้นวันที่มีงานเยอะจริง ๆ
 *    งานท้าย ๆ จะถูกนับครบ 3 ครั้งแล้วโดนทิ้งทั้งที่ยังไม่เคยถูกส่งเลยสักครั้ง
 */
create or replace function requeue_notification(p_job_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update notification_jobs
     set status = 'queued',
         sent_at = null,
         attempt_count = greatest(attempt_count - 1, 0)
   where id = p_job_id;
end
$$;

-- ---------------------------------------------------------------------------
--  6) disable_push_subscription — ปิดเครื่องที่ปลายทางบอกว่าไม่มีอยู่แล้ว
--
--  ⚠️ 404/410 จากปลายทาง = ผู้ใช้ถอนการติดตั้ง / ล้างข้อมูลเบราว์เซอร์
--     ต้องปิดทันที ไม่ใช่ยิงต่อไปเรื่อย ๆ จนโดนปลายทางแบน
-- ---------------------------------------------------------------------------
create or replace function disable_push_subscription(p_endpoint text, p_reason text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update push_subscriptions
     set disabled_at = now(), failure_count = failure_count + 1
   where endpoint = p_endpoint;
  perform p_reason;
end
$$;

-- ---------------------------------------------------------------------------
--  7) ค่าตั้งต้นของระบบแจ้งเตือน
-- ---------------------------------------------------------------------------
insert into app_settings (key, value) values
  ('telegram_bot_token_set', 'false'::jsonb),
  ('telegram_chat_id',       '""'::jsonb),
  ('notify_quiet_start',     '"22:00"'::jsonb),
  ('notify_quiet_end',       '"08:00"'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
--  8) ตรวจผล
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
