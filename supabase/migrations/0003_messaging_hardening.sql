-- ============================================================================
--  HubChat — รอบ 2.1 : เสริมความปลอดภัยของการส่งข้อความ
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ (idempotent) และไม่แก้ของเดิมใน 0001 / 0002
--
--  แก้ 3 เรื่องที่ตรวจพบ :
--    1. กันส่งซ้ำตอนมีคำขอพร้อมกัน — ให้ "ฐานข้อมูล" เป็นคนตัดสินว่าใครได้สิทธิ์ยิง
--    2. กรณีไม่รู้ผล (timeout / เน็ตหลุดหลังยิงออกไปแล้ว) — ห้ามลองใหม่อัตโนมัติ
--    3. คำตอบจาก Meta ห้ามไปลบประวัติข้อความจริงของลูกค้า
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) สถานะของ "การส่งหนึ่งครั้งในเชิงตรรกะ" (logical send)
-- ---------------------------------------------------------------------------
do $$ begin
  create type send_status_t as enum (
    'claimed',            -- มีคนจองสิทธิ์ยิงแล้ว กำลังดำเนินการ
    'blocked_by_policy',  -- Policy Engine ปฏิเสธ ไม่ได้ยิงออกไปเลย
    'succeeded',          -- Meta ตอบรับแล้ว
    'permanent_failed',   -- ล้มเหลวถาวร ห้ามลองใหม่
    'retryable_failed',   -- ล้มเหลวชั่วคราว ลองใหม่ได้อย่างปลอดภัย
    'outcome_unknown'     -- ⚠️ ไม่รู้ว่า Meta รับไปแล้วหรือยัง ห้ามส่งซ้ำอัตโนมัติ
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
--  2) message_sends — หนึ่งแถวต่อ "การส่งหนึ่งครั้ง" (ไม่ใช่ต่อครั้งที่ยิง)
--
--     ตารางนี้คือกุญแจของการกันส่งซ้ำ :
--     idempotency_key เป็น unique → คำขอที่มาพร้อมกันจะมีเพียงคำขอเดียว
--     ที่ insert สำเร็จและได้สิทธิ์ยิง Meta ที่เหลือรู้ตัวทันทีว่าแพ้ และไม่ยิงซ้ำ
-- ---------------------------------------------------------------------------
create table if not exists message_sends (
  id                  uuid primary key default gen_random_uuid(),

  -- กุญแจกันส่งซ้ำ — ถ้าผู้เรียกไม่ได้ระบุ ระบบจะสร้างให้เอง
  idempotency_key     text        not null,

  customer_id         uuid references customers(id) on delete set null,
  conversation_id     uuid references conversations(id) on delete set null,
  page_id             uuid references pages(id) on delete set null,
  channel             channel_t   not null,
  message_type        message_type_t not null,

  -- ที่มาของคำสั่งส่ง — สร้างจากฝั่งเซิร์ฟเวอร์เท่านั้น ผู้เรียกปลอมไม่ได้
  triggered_by        triggered_by_t not null,
  provenance_kind     text        not null,
  human_authored      boolean     not null default false,
  admin_id            uuid references admins(id) on delete set null,

  status              send_status_t not null default 'claimed',
  selected_transport  transport_t,
  policy_reason_code  text,
  policy_reason_th    text,
  policy_decision     jsonb,

  -- ⭐ เก็บ id ของข้อความฝั่ง Meta ไว้ตรวจย้อนหลัง
  meta_message_id     text,
  fbtrace_id          text,

  -- จำนวนครั้งที่ "ยิงออกไปจริง" (ไม่ใช่จำนวนครั้งที่เรียกฟังก์ชัน)
  network_attempts    integer     not null default 0,

  claimed_at          timestamptz not null default now(),
  -- ถ้าเลยเวลานี้แล้วยังค้างที่ claimed = process ที่จองไว้น่าจะตายไปแล้ว
  claim_expires_at    timestamptz not null,
  finished_at         timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ⭐ หัวใจของการกันส่งซ้ำ : ฐานข้อมูลเป็นคนบังคับ ไม่ใช่โค้ด JavaScript
create unique index if not exists message_sends_idem_uniq on message_sends (idempotency_key);
create index if not exists message_sends_status_idx  on message_sends (status, created_at desc);
create index if not exists message_sends_conv_idx    on message_sends (conversation_id, created_at desc);
create index if not exists message_sends_customer_idx on message_sends (customer_id, created_at desc);
-- รายการที่ต้องให้คนมาตรวจเอง เพราะไม่รู้ว่าถึงลูกค้าหรือยัง
create index if not exists message_sends_unknown_idx on message_sends (created_at desc)
  where status = 'outcome_unknown';
-- claim ที่ค้างอยู่ ใช้ตอนกวาดของค้าง
create index if not exists message_sends_stale_claim_idx on message_sends (claim_expires_at)
  where status = 'claimed';

drop trigger if exists message_sends_set_updated_at on message_sends;
create trigger message_sends_set_updated_at before update on message_sends
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
--  3) ผูก send_attempts (หนึ่งแถวต่อ "หนึ่งครั้งที่ยิงออกไป") เข้ากับ message_sends
--     ⚠️ ห้ามเขียนทับแถวเดิม — ประวัติการ retry ต้องอยู่ครบ
-- ---------------------------------------------------------------------------
alter table send_attempts add column if not exists message_send_id uuid
  references message_sends(id) on delete cascade;
alter table send_attempts add column if not exists attempt_no integer;
-- ⭐ เก็บ id ข้อความของ Meta ไว้ในแถวที่ส่งสำเร็จ
alter table send_attempts add column if not exists meta_message_id text;

create index if not exists send_attempts_send_idx on send_attempts (message_send_id, attempt_no);

-- ---------------------------------------------------------------------------
--  4) conversation_policy_state — สิ่งที่ "Meta บอกเรา" แยกจากประวัติข้อความจริง
--
--     🔴 เหตุผลที่ต้องมีตารางนี้ :
--        เดิมพอ Meta ตอบว่ากรอบเวลาปิดแล้ว ระบบไปลบ last_customer_message_at ทิ้ง
--        นั่นคือการลบ "ประวัติจริง" ว่าลูกค้าเคยทักมาเมื่อไหร่ ซึ่งผิด
--        ประวัติข้อความเป็นข้อเท็จจริง คำตอบของ Meta เป็นเพียงสิ่งที่เราสังเกตเห็น
--        สองอย่างนี้ต้องอยู่คนละที่
-- ---------------------------------------------------------------------------
create table if not exists conversation_policy_state (
  conversation_id          uuid primary key references conversations(id) on delete cascade,

  -- Meta เคยบอกว่าส่งไม่ได้เมื่อไหร่
  window_closed_observed_at timestamptz,
  last_policy_error_code    integer,
  last_policy_error_subcode integer,
  last_policy_reason_code   text,
  last_policy_reason_th     text,
  last_fbtrace_id           text,

  -- ครั้งล่าสุดที่ยืนยันว่าส่งได้จริง (ส่งสำเร็จ)
  last_verified_send_at     timestamptz,

  updated_at                timestamptz not null default now()
);

create index if not exists conv_policy_state_closed_idx
  on conversation_policy_state (window_closed_observed_at desc)
  where window_closed_observed_at is not null;

drop trigger if exists conv_policy_state_set_updated_at on conversation_policy_state;
create trigger conv_policy_state_set_updated_at before update on conversation_policy_state
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
--  5) ⭐ ฟังก์ชันจองสิทธิ์ส่ง — ความปลอดภัยอยู่ตรงนี้
--
--     ทำไมต้องเป็นฟังก์ชันใน Postgres ไม่ใช่โค้ดฝั่ง Node :
--        โค้ดแบบ "SELECT ดูก่อน → ไม่เจอ → ยิง Meta → INSERT"
--        ถ้ามีสอง process ทำพร้อมกัน ทั้งคู่จะผ่าน SELECT แล้วยิง Meta ทั้งคู่
--        → ลูกค้าได้ข้อความซ้ำ แก้ไม่ได้
--        การให้ฐานข้อมูลเป็นคนตัดสินด้วย unique constraint แก้ปัญหานี้ที่ต้นเหตุ
--        และใช้ได้แม้มีหลายเครื่อง/หลาย worker (ล็อกในหน่วยความจำใช้ไม่ได้)
--
--     คืนค่า won = true เฉพาะคำขอที่ได้สิทธิ์ยิงเท่านั้น
-- ---------------------------------------------------------------------------
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
as $$
declare
  v message_sends%rowtype;
begin
  -- พยายามจอง : ถ้ามีคนจองกุญแจนี้ไว้แล้ว insert จะไม่เกิดอะไรขึ้น
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
    -- เราคือคนที่ได้สิทธิ์ยิง
    return query select v.id, true, v.status, v.selected_transport, v.meta_message_id,
                        v.policy_reason_code, v.policy_reason_th, v.network_attempts;
    return;
  end if;

  -- มีคนจองไว้ก่อนแล้ว — อ่านสถานะปัจจุบันมาบอกผู้เรียก
  select * into v from message_sends where idempotency_key = p_idempotency_key;

  -- ถ้าค้างที่ claimed เกินเวลา แปลว่า process ที่จองไว้หายไประหว่างทาง
  -- ⚠️ ห้ามยิงซ้ำให้ เพราะไม่รู้ว่ามันยิงออกไปแล้วหรือยัง
  --    ทำเครื่องหมายว่า "ไม่ทราบผล" ให้คนมาตรวจเองแทน
  if v.status = 'claimed' and v.claim_expires_at < now() then
    -- ⚠️ ต้องเขียนชื่อตารางนำหน้าทุกคอลัมน์ เพราะฟังก์ชันนี้มีคอลัมน์ผลลัพธ์ชื่อซ้ำกัน
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

-- ---------------------------------------------------------------------------
--  6) ปิดผลการส่ง — เขียนสถานะสุดท้ายลง message_sends
-- ---------------------------------------------------------------------------
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
) returns void language plpgsql as $$
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

-- ---------------------------------------------------------------------------
--  7) บันทึกสิ่งที่ Meta บอก โดย "ไม่แตะ" ประวัติข้อความจริง
--     ⚠️ ฟังก์ชันนี้ห้ามเขียนลงตาราง conversations หรือ customers เด็ดขาด
-- ---------------------------------------------------------------------------
create or replace function record_policy_observation(
  p_conversation_id uuid,
  p_window_closed   boolean,
  p_error_code      integer,
  p_error_subcode   integer,
  p_reason_code     text,
  p_reason_th       text,
  p_fbtrace_id      text
) returns void language plpgsql as $$
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

-- ---------------------------------------------------------------------------
--  8) บันทึกว่าส่งสำเร็จจริง — ล้างสถานะ "เคยถูกปฏิเสธ" ทิ้ง
-- ---------------------------------------------------------------------------
create or replace function record_send_verified(p_conversation_id uuid)
returns void language plpgsql as $$
begin
  insert into conversation_policy_state (conversation_id, last_verified_send_at, window_closed_observed_at)
  values (p_conversation_id, now(), null)
  on conflict (conversation_id) do update set
    last_verified_send_at = now(),
    window_closed_observed_at = null;
end $$;

-- ---------------------------------------------------------------------------
--  9) เปิด RLS ให้ตารางใหม่ (ไม่มี policy = anon key อ่านไม่ได้เลย)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['message_sends','conversation_policy_state'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
