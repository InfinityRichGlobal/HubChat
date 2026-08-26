-- HubChat 0017: Block 3 hardening (safe to run repeatedly)

create table if not exists worker_heartbeats (
  worker_name text primary key,
  last_started_at timestamptz,
  last_heartbeat_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_summary text,
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint worker_heartbeats_name_chk check (worker_name ~ '^[a-z0-9_-]{1,50}$'),
  constraint worker_heartbeats_error_chk check (char_length(coalesce(last_error_summary, '')) <= 500)
);

create table if not exists order_media_links (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  media_id uuid not null references media_assets(id) on delete restrict,
  purpose text not null default 'attachment',
  linked_by_admin_id uuid references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_media_links_purpose_chk check (purpose in ('attachment', 'payment_slip')),
  constraint order_media_links_unique unique (order_id, media_id, purpose)
);

create index if not exists order_media_links_order_idx
  on order_media_links (order_id, created_at desc);
create index if not exists order_media_links_media_idx on order_media_links (media_id);
create index if not exists order_media_links_admin_idx on order_media_links (linked_by_admin_id);

alter table worker_heartbeats enable row level security;
alter table order_media_links enable row level security;

revoke all on table worker_heartbeats from public, anon, authenticated;
revoke all on table order_media_links from public, anon, authenticated;
grant select, insert, update, delete on table worker_heartbeats to service_role;
grant select, insert, update, delete on table order_media_links to service_role;

create or replace function link_order_media(
  p_order_id uuid,
  p_media_id uuid,
  p_purpose text,
  p_admin_id uuid
)
returns order_media_links
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order orders%rowtype;
  v_media media_assets%rowtype;
  v_link order_media_links%rowtype;
begin
  if p_purpose not in ('attachment', 'payment_slip') then
    raise exception 'invalid media purpose' using errcode = '23514';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;

  select * into v_media from media_assets where id = p_media_id;
  if not found then raise exception 'media not found' using errcode = 'P0002'; end if;
  if v_media.status <> 'stored' then
    raise exception 'media is not stored' using errcode = '23514';
  end if;
  if v_order.page_id is distinct from v_media.page_id then
    raise exception 'order and media page mismatch' using errcode = '23514';
  end if;
  if v_order.conversation_id is not null
     and v_media.conversation_id is distinct from v_order.conversation_id then
    raise exception 'order and media conversation mismatch' using errcode = '23514';
  end if;

  insert into order_media_links (order_id, media_id, purpose, linked_by_admin_id)
  values (p_order_id, p_media_id, p_purpose, p_admin_id)
  on conflict (order_id, media_id, purpose) do update
    set linked_by_admin_id = excluded.linked_by_admin_id
  returning * into v_link;

  if p_purpose = 'payment_slip' then
    update orders
       set slip_media_id = p_media_id,
           slip_url = null,
           updated_at = now()
     where id = p_order_id;
  end if;

  return v_link;
end
$$;

revoke all on function link_order_media(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function link_order_media(uuid, uuid, text, uuid) to service_role;

do $$
begin
  if not exists (select 1 from pg_class where relname = 'worker_heartbeats' and relrowsecurity) then
    raise exception 'worker_heartbeats RLS is not enabled';
  end if;
  if not exists (select 1 from pg_class where relname = 'order_media_links' and relrowsecurity) then
    raise exception 'order_media_links RLS is not enabled';
  end if;
end
$$;
