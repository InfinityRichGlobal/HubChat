-- ============================================================================
--  HubChat — 0004 : ล็อก search_path ของฟังก์ชันทุกตัว
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ของเดิมใน 0001 / 0002 / 0003
--
--  ⚠️ ทำไมต้องทำ (ตัวตรวจความปลอดภัยของ Supabase แจ้งมา)
--     ฟังก์ชันที่ไม่ได้ล็อก search_path จะ "หาของตามลำดับ schema ที่คนเรียกกำหนด"
--     ถ้าวันหนึ่งมีใครสร้างตารางหรือฟังก์ชันชื่อซ้ำไว้ใน schema ที่ถูกค้นก่อน
--     ฟังก์ชันของเราจะไปเรียกของปลอมแทนของจริงโดยไม่รู้ตัว
--
--     ความเสี่ยงจริงตอนนี้ต่ำ เพราะระบบเราใช้ service_role ทางเดียว
--     แต่การแก้ใช้เวลาไม่ถึงนาที และปิดช่องนี้ได้ถาวร จึงควรทำตั้งแต่ตอนนี้
--
--     `pg_temp` ต้องอยู่ท้ายสุดเสมอ ไม่ให้ตารางชั่วคราวของ session
--     ไปบังของจริงใน public ได้
--
--  หมายเหตุ : เนื้อในของทุกฟังก์ชันเหมือนเดิมทุกบรรทัด เปลี่ยนแค่บรรทัด search_path
-- ============================================================================

-- ---------------------------------------------------------------------------
--  จาก 0001
-- ---------------------------------------------------------------------------

-- อัปเดต updated_at อัตโนมัติทุกครั้งที่แก้แถว
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ขอเลขออเดอร์ถัดไปของวันนี้ (ตามเวลาไทย) — atomic ไม่ชนกันแม้แอดมินกดพร้อมกัน
create or replace function next_order_no()
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  d date;
  n integer;
begin
  d := (now() at time zone 'Asia/Bangkok')::date;
  insert into order_no_counters (day, seq) values (d, 1)
    on conflict (day) do update set seq = order_no_counters.seq + 1
    returning seq into n;
  return 'ORD-' || to_char(d, 'YYMMDD') || '-' || lpad(n::text, 3, '0');
end $$;

-- ---------------------------------------------------------------------------
--  จาก 0003
-- ---------------------------------------------------------------------------

-- ⭐ ฟังก์ชันจองสิทธิ์ส่ง — ความปลอดภัยของการกันส่งซ้ำอยู่ตรงนี้
create or replace function claim_message_send(
  p_idempotency_key   text,
  p_customer_id       uuid,
  p_conversation_id   uuid,
  p_page_id           uuid,
  p_channel           channel_t,
  p_message_type      message_type_t,
  p_triggered_by      triggered_by_t,
  p_provenance_kind   text,
  p_human_authored    boolean,
  p_admin_id          uuid,
  p_claim_ttl_seconds integer
)
returns table (
  send_id            uuid,
  won                boolean,
  status             send_status_t,
  selected_transport transport_t,
  meta_message_id    text,
  policy_reason_code text,
  policy_reason_th   text,
  network_attempts   integer
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v message_sends%rowtype;
begin
  insert into message_sends (
    idempotency_key, customer_id, conversation_id, page_id, channel, message_type,
    triggered_by, provenance_kind, human_authored, admin_id, status, claim_expires_at
  ) values (
    p_idempotency_key, p_customer_id, p_conversation_id, p_page_id, p_channel, p_message_type,
    p_triggered_by, p_provenance_kind, coalesce(p_human_authored, false), p_admin_id,
    'claimed', now() + make_interval(secs => greatest(p_claim_ttl_seconds, 5))
  )
  on conflict (idempotency_key) do nothing
  returning * into v;

  if found then
    return query select v.id, true, v.status, v.selected_transport, v.meta_message_id,
                        v.policy_reason_code, v.policy_reason_th, v.network_attempts;
    return;
  end if;

  select * into v from message_sends where idempotency_key = p_idempotency_key;

  if v.status = 'claimed' and v.claim_expires_at < now() then
    update message_sends
       set status = 'outcome_unknown',
           policy_reason_code = 'CLAIM_EXPIRED',
           policy_reason_th = 'ระบบขาดการติดต่อระหว่างส่ง จึงไม่ทราบว่าข้อความถึงลูกค้าหรือไม่ ต้องตรวจสอบเอง',
           finished_at = now()
     where message_sends.id = v.id and message_sends.status = 'claimed'
     returning * into v;
  end if;

  return query select v.id, false, v.status, v.selected_transport, v.meta_message_id,
                      v.policy_reason_code, v.policy_reason_th, v.network_attempts;
end
$$;

-- ปิดผลการส่ง
create or replace function finish_message_send(
  p_send_id            uuid,
  p_status             send_status_t,
  p_selected_transport transport_t,
  p_policy_reason_code text,
  p_policy_reason_th   text,
  p_policy_decision    jsonb,
  p_meta_message_id    text,
  p_fbtrace_id         text,
  p_network_attempts   integer
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update message_sends
     set status             = p_status,
         selected_transport = p_selected_transport,
         policy_reason_code = p_policy_reason_code,
         policy_reason_th   = p_policy_reason_th,
         policy_decision    = p_policy_decision,
         meta_message_id    = coalesce(p_meta_message_id, meta_message_id),
         fbtrace_id         = coalesce(p_fbtrace_id, fbtrace_id),
         network_attempts   = greatest(coalesce(p_network_attempts, 0), network_attempts),
         finished_at        = now()
   where id = p_send_id;
end $$;

-- บันทึกสิ่งที่ Meta บอก — ⚠️ ห้ามแตะประวัติข้อความจริง
create or replace function record_policy_observation(
  p_conversation_id uuid,
  p_window_closed   boolean,
  p_error_code      integer,
  p_error_subcode   integer,
  p_reason_code     text,
  p_reason_th       text,
  p_fbtrace_id      text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into conversation_policy_state (
    conversation_id, window_closed_observed_at,
    last_policy_error_code, last_policy_error_subcode,
    last_policy_reason_code, last_policy_reason_th, last_fbtrace_id
  ) values (
    p_conversation_id,
    case when p_window_closed then now() else null end,
    p_error_code, p_error_subcode, p_reason_code, p_reason_th, p_fbtrace_id
  )
  on conflict (conversation_id) do update set
    window_closed_observed_at = case
      when p_window_closed then now()
      else conversation_policy_state.window_closed_observed_at
    end,
    last_policy_error_code    = p_error_code,
    last_policy_error_subcode = p_error_subcode,
    last_policy_reason_code   = p_reason_code,
    last_policy_reason_th     = p_reason_th,
    last_fbtrace_id           = p_fbtrace_id;
end $$;

-- บันทึกว่าส่งสำเร็จจริง
create or replace function record_send_verified(p_conversation_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into conversation_policy_state (conversation_id, last_verified_send_at, window_closed_observed_at)
  values (p_conversation_id, now(), null)
  on conflict (conversation_id) do update set
    last_verified_send_at = now(),
    window_closed_observed_at = null;
end $$;

-- ---------------------------------------------------------------------------
--  ตรวจผล : ต้องไม่เหลือฟังก์ชันที่ยังไม่ได้ล็อก search_path
-- ---------------------------------------------------------------------------
do $$
declare bad text[];
begin
  -- ตรวจเฉพาะ "ฟังก์ชันที่เราเขียนเอง" เท่านั้น
  -- ⚠️ ต้องไม่นับฟังก์ชันที่มากับ extension (pgcrypto / pg_trgm)
  --    ของพวกนั้นเป็นของ Postgres เราไม่มีสิทธิ์แก้ และไม่ควรแก้ด้วย
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
--  หมายเหตุเรื่อง extension pg_trgm ที่อยู่ใน schema public
--  ตัวตรวจของ Supabase แจ้งไว้เหมือนกัน แต่ "ตั้งใจไม่ย้าย"
--
--  เพราะ index ค้นหาชื่อลูกค้าและชื่อชุดคำตอบ (customers_name_trgm_idx,
--  canned_title_trgm_idx) ผูกกับ operator class `gin_trgm_ops` ของ extension นี้
--  การย้าย schema ทำให้ index หา operator class ไม่เจอ แล้วค้นหาพัง
--
--  ความเสี่ยงของการปล่อยไว้ต่ำมาก (extension นี้ไม่มีฟังก์ชันที่แก้ข้อมูล)
--  จดไว้ใน DEFERRED_REVIEW แล้ว ถ้าจะย้ายต้องสร้าง index ใหม่พร้อมกัน
-- ---------------------------------------------------------------------------
