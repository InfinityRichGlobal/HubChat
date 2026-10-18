-- Fenced leases and delayed retries. Works on PostgreSQL and hosted Supabase.
alter table public.webhook_queue add column if not exists next_attempt_at timestamptz not null default now();
create index if not exists webhook_queue_due_idx on public.webhook_queue(next_attempt_at, id) where status = 'pending';
create or replace function public.claim_webhook_jobs(p_limit integer, p_max_attempts integer, p_stale_seconds integer)
returns setof public.webhook_queue language plpgsql set search_path = public, pg_temp as $$
begin
  -- A process killed on its final attempt must not remain processing forever.
  update webhook_queue set status = 'failed', processed_at = now(), error_message = 'หมดจำนวนครั้งที่ลองใหม่หลัง worker หยุดกลางงาน'
   where attempts >= greatest(p_max_attempts,1) and (status = 'pending' or (status = 'processing' and claimed_at < now() - make_interval(secs => greatest(p_stale_seconds,10))));
  return query update webhook_queue q set status = 'processing', attempts = q.attempts + 1, claimed_at = now()
  where q.id in (
    select w.id from webhook_queue w where w.attempts < greatest(p_max_attempts,1)
      and ((w.status = 'pending' and w.next_attempt_at <= now()) or (w.status = 'processing' and w.claimed_at < now() - make_interval(secs => greatest(p_stale_seconds,10))))
    order by w.created_at, w.id limit least(greatest(p_limit,1),100) for update skip locked
  ) returning q.*;
end $$;
create or replace function public.finish_webhook_job_attempt(p_id bigint, p_attempt integer, p_status public.queue_status_t, p_error text)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare changed integer;
begin
  if p_status not in ('done','failed','pending') then raise exception 'invalid terminal state'; end if;
  update webhook_queue set payload=case when p_error like '%DELETED_SUBJECT:%' then '{}'::jsonb else payload end, status = p_status, error_message = left(p_error,500),
    next_attempt_at = case when p_status = 'pending' then now() + make_interval(secs => least(900, 15 * power(2, greatest(p_attempt-1,0))::int)) else next_attempt_at end,
    claimed_at = case when p_status = 'pending' then null else claimed_at end,
    processed_at = case when p_status in ('done','failed') then now() else null end
  where id = p_id and attempts = p_attempt and status = 'processing';
  get diagnostics changed = row_count;
  return changed = 1;
end $$;
revoke all on function public.finish_webhook_job_attempt(bigint,integer,public.queue_status_t,text) from public,anon,authenticated;
grant execute on function public.finish_webhook_job_attempt(bigint,integer,public.queue_status_t,text) to service_role;

-- A content fingerprint prevents double-clicks, retries and concurrent tabs sending
-- the identical public reply twice. Uncertain outcomes never expire automatically.
create table if not exists public.comment_public_sends (
  comment_id uuid not null references public.comments(id) on delete cascade,
  fingerprint text not null check (length(fingerprint) = 64),
  state text not null default 'claimed' check (state in ('claimed','succeeded','outcome_unknown','rejected')),
  admin_id uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(comment_id,fingerprint)
);
alter table public.comment_public_sends enable row level security;
revoke all on table public.comment_public_sends from public,anon,authenticated;
grant select,insert,update,delete on table public.comment_public_sends to service_role;
create or replace function public.claim_manual_public_reply(p_comment_id uuid,p_fingerprint text,p_admin_id uuid)
returns boolean language plpgsql set search_path = public,pg_temp as $$
declare won integer;
begin
  -- Lock the comment too, to serialize different drafts from concurrent tabs.
  perform id from comments where id = p_comment_id for update;
  if not exists(select 1 from comments where id=p_comment_id and not is_deleted and not is_from_page and (bot_public_claimed_at is null or replied_public)) then return false; end if;
  if exists(select 1 from comment_public_sends where comment_id = p_comment_id and state in ('claimed','outcome_unknown')) then return false; end if;
  insert into comment_public_sends(comment_id,fingerprint,admin_id) values(p_comment_id,p_fingerprint,p_admin_id)
  on conflict(comment_id,fingerprint) do update set state = 'claimed',updated_at = now(),admin_id = excluded.admin_id
    where comment_public_sends.state = 'rejected';
  get diagnostics won = row_count;
  if won=1 then update comments set last_error_th='กำลังส่งคำตอบสาธารณะ หากค้างให้ตรวจโพสต์ต้นทางก่อน ไม่ส่งซ้ำ' where id=p_comment_id; end if;
  return won = 1;
end $$;
revoke all on function public.claim_manual_public_reply(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_manual_public_reply(uuid,text,uuid) to service_role;
-- Share the same row lock between automatic and manual public replies.
create or replace function public.claim_comment_public_reply(p_comment_row_id uuid)
returns table(won boolean) language plpgsql set search_path=public,pg_temp as $$
declare claimed uuid;
begin
  perform id from comments where id=p_comment_row_id for update;
  if exists(select 1 from comment_public_sends where comment_id=p_comment_row_id and state in ('claimed','outcome_unknown','succeeded')) then
    return query select false; return;
  end if;
  update comments set bot_public_claimed_at=now(),last_error_th='จองสิทธิ์ตอบอัตโนมัติแล้ว หากสถานะค้างให้ตรวจคอมเมนต์บน Meta ก่อนตอบเอง'
   where id=p_comment_row_id and not replied_public and not is_from_page and not is_deleted and bot_public_claimed_at is null returning id into claimed;
  return query select claimed is not null;
end $$;
notify pgrst,'reload schema';
-- Retrying a dead letter creates a new lease identity; it never resets attempts on a live lease.
alter table public.webhook_queue add column if not exists retried_as bigint references public.webhook_queue(id) on delete set null;
create or replace function public.retry_failed_webhook_job(p_id bigint) returns bigint language plpgsql set search_path=public,pg_temp as $$
declare old public.webhook_queue; new_id bigint;
begin
  select * into old from webhook_queue where id=p_id for update;
  if not found or old.status!='failed' then raise exception 'Only failed jobs can be retried'; end if;
  if old.retried_as is not null then return old.retried_as; end if;
  if old.payload='{}'::jsonb then raise exception 'Erased or empty events cannot be retried'; end if;
  insert into webhook_queue(payload) values(old.payload) returning id into new_id;
  update webhook_queue set retried_as=new_id where id=p_id;
  return new_id;
end $$;
revoke all on function public.retry_failed_webhook_job(bigint) from public,anon,authenticated;
grant execute on function public.retry_failed_webhook_job(bigint) to service_role;
notify pgrst,'reload schema';
