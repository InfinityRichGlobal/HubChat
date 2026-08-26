-- HubChat 0018: owner-managed runtime settings (safe to run repeatedly)

create table if not exists runtime_settings (
  key text primary key,
  kind text not null,
  encrypted_value text,
  plain_value jsonb,
  secret_hint text,
  readiness text not null default 'CONFIGURED',
  configured_at timestamptz not null default now(),
  tested_at timestamptz,
  live_verified_at timestamptz,
  updated_by uuid references admins(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint runtime_settings_key_chk check (key ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint runtime_settings_kind_chk check (kind in ('secret', 'general')),
  constraint runtime_settings_readiness_chk check (readiness in ('CONFIGURED', 'TESTED', 'LIVE_VERIFIED')),
  constraint runtime_settings_value_chk check (
    (kind = 'secret' and encrypted_value is not null and plain_value is null)
    or (kind = 'general' and encrypted_value is null and plain_value is not null)
  ),
  constraint runtime_settings_hint_chk check (secret_hint is null or char_length(secret_hint) <= 4)
);

alter table runtime_settings enable row level security;
revoke all on table runtime_settings from public, anon, authenticated;
grant select, insert, update, delete on table runtime_settings to service_role;

create index if not exists runtime_settings_updated_idx on runtime_settings (updated_at desc);
create index if not exists runtime_settings_updated_by_idx on runtime_settings (updated_by);

do $$
begin
  if not exists (select 1 from pg_class where relname = 'runtime_settings' and relrowsecurity) then
    raise exception 'runtime_settings RLS is not enabled';
  end if;
end
$$;
