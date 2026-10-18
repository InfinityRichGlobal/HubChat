-- Remember only a page-scoped hash and cutoff, so delayed deliveries cannot restore erased history.
create table public.erased_meta_identities (
  page_id uuid not null references pages(id) on delete cascade,
  kind text not null check(kind in ('message','comment')),
  actor_hash text not null, erased_before timestamptz not null,
  primary key(page_id,kind,actor_hash)
);
alter table public.erased_meta_identities enable row level security;
revoke all on public.erased_meta_identities from public,anon,authenticated;
grant select,insert,update on public.erased_meta_identities to service_role;
create or replace function public.prevent_erased_history() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare page uuid; actor text; event_at timestamptz; event_kind text;
begin
  if tg_table_name='messages' then
    select c.page_id,c.psid into page,actor from customers c join conversations v on v.customer_id=c.id where v.id=new.conversation_id;
    event_at:=new.created_at; event_kind:='message';
  else page:=new.page_id; actor:=new.from_id; event_at:=new.commented_at; event_kind:='comment'; end if;
  if exists(select 1 from erased_meta_identities e where e.page_id=page and e.kind=event_kind and e.actor_hash=encode(sha256(convert_to(page::text || ':' || actor,'UTF8')),'hex') and (event_at is null or event_at<=e.erased_before)) then
    raise exception 'DELETED_SUBJECT: historic event was erased' using errcode='23514';
  end if;
  return new;
end $$;
create trigger prevent_erased_messages before insert on messages for each row execute function public.prevent_erased_history();
create trigger prevent_erased_comments before insert on comments for each row execute function public.prevent_erased_history();

create table public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  confirmation_code text not null unique,
  request_key text not null unique,
  subject_encrypted text,
  status text not null default 'pending_review' check(status in ('pending_review','processing','failed','completed')),
  created_at timestamptz not null default now(), completed_at timestamptz, claimed_at timestamptz,
  reviewed_by uuid references admins(id) on delete set null,
  verification_note text,
  scope jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_th text
);
alter table public.data_deletion_requests enable row level security;
revoke all on public.data_deletion_requests from public,anon,authenticated;
grant select,insert,update on public.data_deletion_requests to service_role;

-- The caller must authenticate an owner and verify the person's identity first.
-- App-scoped callback IDs must NEVER be used as page-scoped customer IDs.
create or replace function public.prepare_data_deletion(p_request_id uuid,p_customers jsonb,p_comments jsonb,p_admin_id uuid,p_note text)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare r data_deletion_requests; customers_ids uuid[]; comments_ids uuid[]; conv_ids uuid[]; order_ids uuid[]; asset_ids uuid[]; keys jsonb; result_scope jsonb;
begin
  select * into r from data_deletion_requests where id=p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status='completed' then raise exception 'Already completed'; end if;
  if r.status='processing' and r.claimed_at>now()-interval '10 minutes' then raise exception 'Request is being processed'; end if;
  if not exists(select 1 from admins where id=p_admin_id and role='owner' and is_active) then raise exception 'Owner required'; end if;
  if length(trim(p_note))<10 then raise exception 'Identity verification is required'; end if;
  if r.status in ('failed','processing') then
    update data_deletion_requests set status='processing',claimed_at=now(),error_th=null where id=p_request_id;
    return r.scope;
  end if;
  select coalesce(array_agg(value::uuid),'{}') into customers_ids from jsonb_array_elements_text(p_customers);
  select coalesce(array_agg(value::uuid),'{}') into comments_ids from jsonb_array_elements_text(p_comments);
  if cardinality(customers_ids)>100 or cardinality(comments_ids)>100 then raise exception 'Too many records'; end if;
  if exists(select 1 from unnest(customers_ids) i where not exists(select 1 from customers c where c.id=i)) or exists(select 1 from unnest(comments_ids) i where not exists(select 1 from comments c where c.id=i)) then raise exception 'Selected record no longer exists'; end if;
  select coalesce(array_agg(id),'{}') into conv_ids from conversations where customer_id=any(customers_ids);
  select coalesce(array_agg(id),'{}') into order_ids from orders where customer_id=any(customers_ids) or conversation_id=any(conv_ids);
  select coalesce(array_agg(id),'{}') into comments_ids from comments where id=any(comments_ids) or customer_id=any(customers_ids) or conversation_id=any(conv_ids);
  select coalesce(array_agg(distinct m.id),'{}') into asset_ids from media_assets m
    where m.conversation_id=any(conv_ids) or m.message_id in(select id from messages where conversation_id=any(conv_ids))
    or m.id in(select slip_media_id from orders where id=any(order_ids)) or m.id in(select media_id from order_media_links where order_id=any(order_ids));
  if exists(select 1 from order_media_links where media_id=any(asset_ids) and not(order_id=any(order_ids))) or exists(select 1 from orders where slip_media_id=any(asset_ids) and not(id=any(order_ids))) then raise exception 'A file is shared with another customer. Review its ownership before deletion'; end if;
  if exists(select 1 from media_assets where not(id=any(asset_ids)) and storage_key in(select storage_key from media_assets where id=any(asset_ids))) then raise exception 'A storage object is shared. Review its ownership before deletion'; end if;
  select coalesce(jsonb_agg(distinct storage_key) filter(where storage_key is not null),'[]') into keys from media_assets where id=any(asset_ids);
  result_scope := jsonb_build_object('customers',to_jsonb(customers_ids),'comments',to_jsonb(comments_ids),'conversations',to_jsonb(conv_ids),'orders',to_jsonb(order_ids),'assets',to_jsonb(asset_ids),'storage_keys',keys);
  update data_deletion_requests set status='processing',claimed_at=now(),reviewed_by=p_admin_id,verification_note=p_note,scope=result_scope,error_th=null where id=p_request_id;
  return result_scope;
end $$;

create or replace function public.finish_data_deletion(p_request_id uuid)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare r data_deletion_requests; customer_ids uuid[]; comment_ids uuid[]; conv_ids uuid[]; order_ids uuid[]; asset_ids uuid[]; identifiers jsonb; qrow record; entry jsonb; kept_entries jsonb; kept_events jsonb; new_entry jsonb; field text; event jsonb; matched boolean; counts jsonb;
begin
  select * into r from data_deletion_requests where id=p_request_id for update;
  if not found or r.status!='processing' then raise exception 'Deletion is not prepared'; end if;
  select coalesce(array_agg(value::uuid),'{}') into customer_ids from jsonb_array_elements_text(r.scope->'customers');
  select coalesce(array_agg(value::uuid),'{}') into comment_ids from jsonb_array_elements_text(r.scope->'comments');
  select coalesce(array_agg(value::uuid),'{}') into conv_ids from jsonb_array_elements_text(r.scope->'conversations');
  select coalesce(array_agg(value::uuid),'{}') into order_ids from jsonb_array_elements_text(r.scope->'orders');
  select coalesce(array_agg(value::uuid),'{}') into asset_ids from jsonb_array_elements_text(r.scope->'assets');
  select coalesce(jsonb_agg(x),'[]') into identifiers from (
    select p.page_id as page, c.psid as actor from customers c join pages p on p.id=c.page_id where c.id=any(customer_ids)
    union select p.page_id,c.from_id from comments c join pages p on p.id=c.page_id where c.id=any(comment_ids) and c.from_id is not null
  ) x;
  insert into erased_meta_identities(page_id,kind,actor_hash,erased_before)
    select page_id,'message',encode(sha256(convert_to(page_id::text || ':' || psid,'UTF8')),'hex'),now() from customers where id=any(customer_ids)
    on conflict(page_id,kind,actor_hash) do update set erased_before=excluded.erased_before;
  insert into erased_meta_identities(page_id,kind,actor_hash,erased_before)
    select distinct page_id,'comment',encode(sha256(convert_to(page_id::text || ':' || from_id,'UTF8')),'hex'),now() from comments where id=any(comment_ids) and from_id is not null
    on conflict(page_id,kind,actor_hash) do update set erased_before=excluded.erased_before;
  -- Remove only matching events, preserving other people in a batched delivery.
  for qrow in select id,payload from webhook_queue where jsonb_typeof(payload->'entry')='array' for update loop
    kept_entries := '[]'; matched := false;
    for entry in select value from jsonb_array_elements(qrow.payload->'entry') loop
      new_entry := entry;
      foreach field in array array['messaging','changes','standby'] loop
        if jsonb_typeof(entry->field)='array' then
          kept_events := '[]';
          for event in select value from jsonb_array_elements(entry->field) loop
            if exists(select 1 from jsonb_array_elements(identifiers) i where i->>'page'=entry->>'id' and jsonb_path_exists(event,'$.** ? (@ == $actor)',jsonb_build_object('actor',i->>'actor'))) then matched := true;
            else kept_events := kept_events || jsonb_build_array(event); end if;
          end loop;
          new_entry := jsonb_set(new_entry,array[field],kept_events);
        end if;
      end loop;
      kept_entries := kept_entries || jsonb_build_array(new_entry);
    end loop;
    if matched then update webhook_queue set payload=jsonb_set(payload,'{entry}',kept_entries) where id=qrow.id; end if;
  end loop;
  -- Historical import source files may contain this person's address. Row data for other orders remains.
  update tracking_imports set raw_csv=null where id in(select import_id from tracking_import_rows where matched_order_id=any(order_ids));
  delete from tracking_import_rows where matched_order_id=any(order_ids);
  delete from activity_logs where target_id::text=any((customer_ids || comment_ids || conv_ids || order_ids)::text[]);
  delete from notification_jobs where conversation_id=any(conv_ids) or exists(select 1 from unnest(comment_ids) i where strpos(dedupe_key,i::text)>0);
  delete from fulfillment_notifications where order_id=any(order_ids) or conversation_id=any(conv_ids);
  delete from send_attempts where customer_id=any(customer_ids) or conversation_id=any(conv_ids);
  delete from message_sends where customer_id=any(customer_ids) or conversation_id=any(conv_ids);
  delete from orders where id=any(order_ids);
  delete from media_assets where id=any(asset_ids);
  delete from comments where id=any(comment_ids);
  delete from customers where id=any(customer_ids);
  counts := jsonb_build_object('customers',cardinality(customer_ids),'comments',cardinality(comment_ids),'conversations',cardinality(conv_ids),'orders',cardinality(order_ids),'files',cardinality(asset_ids));
  update data_deletion_requests set status='completed',completed_at=now(),subject_encrypted=null,scope='{}',result=counts,error_th=null where id=p_request_id;
  return counts;
end $$;

revoke all on function public.prepare_data_deletion(uuid,jsonb,jsonb,uuid,text) from public,anon,authenticated;
revoke all on function public.finish_data_deletion(uuid) from public,anon,authenticated;
grant execute on function public.prepare_data_deletion(uuid,jsonb,jsonb,uuid,text) to service_role;
grant execute on function public.finish_data_deletion(uuid) to service_role;
notify pgrst,'reload schema';
