-- Business Suite-style inbox groups.
--
-- Meta only exposes a writable API for some native moderation actions (notably
-- moving a person to spam). The remaining operational groups are deliberately
-- stored in HubChat so the UI never claims that Meta accepted a state it cannot
-- actually write.

alter table public.conversations
  add column if not exists inbox_status text not null default 'active',
  add column if not exists is_important boolean not null default false,
  add column if not exists inbox_state_updated_at timestamptz,
  add column if not exists inbox_state_updated_by uuid references public.admins(id) on delete set null,
  add column if not exists meta_spam_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'conversations_inbox_status_check'
       and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations
      add constraint conversations_inbox_status_check
      check (inbox_status in ('active', 'done', 'spam'));
  end if;
end $$;

create index if not exists conversations_inbox_status_idx
  on public.conversations (inbox_status, last_message_at desc);

create index if not exists conversations_important_idx
  on public.conversations (last_message_at desc)
  where is_important;

create index if not exists conversations_state_updated_by_idx
  on public.conversations (inbox_state_updated_by)
  where inbox_state_updated_by is not null;

-- A fresh customer message reopens a completed conversation. Spam remains in
-- spam until it is restored in Meta Business Suite because Meta does not expose
-- a public "move out of spam" action that HubChat can safely call.
create or replace function public.reopen_done_conversation_on_inbound()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.direction = 'in' then
    update public.conversations
       set inbox_status = 'active',
           inbox_state_updated_at = now(),
           inbox_state_updated_by = null
     where id = new.conversation_id
       and inbox_status = 'done';
  end if;
  return new;
end
$$;

drop trigger if exists messages_reopen_done_conversation on public.messages;
create trigger messages_reopen_done_conversation
after insert on public.messages
for each row execute function public.reopen_done_conversation_on_inbound();
