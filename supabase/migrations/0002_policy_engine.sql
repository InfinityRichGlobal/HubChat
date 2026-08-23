-- ============================================================================
--  HubChat — รอบ 2 : Message Policy Engine
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ (idempotent)
--
--  รอบนี้ไม่ได้สร้างตารางใหม่ แต่เติมฟิลด์ที่ send_attempts ยังขาด
--  เพื่อให้ตารางนี้ทำหน้าที่ "หลักฐานตอนยื่น App Review" ได้จริง
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) กันส่งซ้ำ (idempotency)
--     scheduler / worker อาจถูกปลุกซ้ำ หรือแอดมินกดปุ่มรัว ๆ
--     ถ้าเคยส่งสำเร็จด้วยกุญแจเดิมแล้ว ต้องไม่ส่งซ้ำให้ลูกค้าได้รับสองรอบ
-- ---------------------------------------------------------------------------
alter table send_attempts add column if not exists idempotency_key text;

-- unique เฉพาะครั้งที่ "ส่งสำเร็จ" เท่านั้น
-- ครั้งที่ส่งไม่ผ่านยังบันทึกซ้ำได้ เพราะเป็นประวัติที่ต้องเก็บครบ
create unique index if not exists send_attempts_idem_uniq
  on send_attempts (idempotency_key)
  where idempotency_key is not null and success = true;

create index if not exists send_attempts_idem_idx
  on send_attempts (idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
--  2) เก็บผลการตัดสินของ Policy Engine แบบเต็ม
--     บอกได้ว่า "ตอนนั้นลองช่องทางไหนไปบ้าง แต่ละตัวตกด้วยเหตุผลอะไร"
--     เวลาส่งไม่ผ่าน นี่คือที่แรกที่ควรเปิดดู
-- ---------------------------------------------------------------------------
alter table send_attempts add column if not exists policy_decision jsonb;

-- ---------------------------------------------------------------------------
--  3) บันทึกว่าใครสั่งส่งและเป็นข้อความที่คนพิมพ์เองหรือไม่
--     ใช้พิสูจน์ตอนยื่น App Review ว่า HUMAN_AGENT ถูกใช้กับข้อความที่คนพิมพ์จริง
-- ---------------------------------------------------------------------------
alter table send_attempts add column if not exists human_typed boolean not null default false;

-- ---------------------------------------------------------------------------
--  4) ดัชนีสำหรับดูว่า HUMAN_AGENT ถูกใช้ไปกี่ครั้งและกับอะไรบ้าง
-- ---------------------------------------------------------------------------
create index if not exists send_attempts_human_agent_idx
  on send_attempts (created_at desc)
  where selected_transport = 'HUMAN_AGENT';

-- ---------------------------------------------------------------------------
--  5) ตาราง send_attempts ใช้ enum message_type_t อยู่แล้วจากรอบ 1
--     ตรวจซ้ำว่าค่าที่ Policy Engine ใช้มีครบทุกตัว
-- ---------------------------------------------------------------------------
do $$
declare want text[] := array[
  'inquiry_response','order_update','shipping_update',
  'appointment_reminder','promotion','upsell'
];
  missing text[];
begin
  select array_agg(w) into missing
  from unnest(want) w
  where not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'message_type_t' and e.enumlabel = w
  );
  if missing is not null then
    raise exception 'enum message_type_t ขาดค่า: %', missing;
  end if;
end $$;
