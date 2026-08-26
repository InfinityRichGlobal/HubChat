-- Cache the two AI inbox groups on conversations. Filtering a large inbox by
-- first downloading every execution id would eventually exceed PostgREST URL
-- limits; these booleans keep the list query indexed and bounded.

alter table public.conversations
  add column if not exists has_ai_reply boolean not null default false,
  add column if not exists has_ai_handoff boolean not null default false;

create index if not exists conversations_ai_reply_idx
  on public.conversations (last_message_at desc)
  where has_ai_reply and inbox_status = 'active';

create index if not exists conversations_ai_handoff_idx
  on public.conversations (last_message_at desc)
  where has_ai_handoff and inbox_status = 'active';

create or replace function public.sync_conversation_ai_groups()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_conversation_id uuid := coalesce(new.conversation_id, old.conversation_id);
begin
  update public.conversations c
     set has_ai_reply = exists (
           select 1 from public.auto_reply_executions e
            where e.conversation_id = v_conversation_id and e.status = 'sent'
         ),
         has_ai_handoff = exists (
           select 1 from public.auto_reply_executions e
            where e.conversation_id = v_conversation_id
              and e.status in ('blocked', 'failed', 'unknown')
         )
   where c.id = v_conversation_id;
  return coalesce(new, old);
end
$$;

drop trigger if exists auto_reply_sync_conversation_groups on public.auto_reply_executions;
create trigger auto_reply_sync_conversation_groups
after insert or update of status or delete on public.auto_reply_executions
for each row execute function public.sync_conversation_ai_groups();

update public.conversations c
   set has_ai_reply = exists (
         select 1 from public.auto_reply_executions e
          where e.conversation_id = c.id and e.status = 'sent'
       ),
       has_ai_handoff = exists (
         select 1 from public.auto_reply_executions e
          where e.conversation_id = c.id
            and e.status in ('blocked', 'failed', 'unknown')
       );
