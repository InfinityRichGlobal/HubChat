-- Hosted Supabase has these extensions; plain PostgreSQL tests do not.
do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then create extension if not exists pg_cron with schema pg_catalog; end if;
  if exists(select 1 from pg_available_extensions where name='pg_net') then create extension if not exists pg_net with schema extensions; end if;
end $$;

-- No token is embedded in cron.job, source files, logs or API responses.
create or replace function public.dispatch_hubchat_worker(p_worker text)
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare app_url text; token text; request_id bigint; endpoint text;
begin
  endpoint := case p_worker when 'ingest' then '/api/ingest/process' when 'notifications' then '/api/notify/flush' else null end;
  if endpoint is null then raise exception 'Unknown worker'; end if;
  select decrypted_secret into app_url from vault.decrypted_secrets where name='hubchat_worker_url';
  select decrypted_secret into token from vault.decrypted_secrets where name='hubchat_worker_token';
  if app_url is null or token is null then raise exception 'Worker schedule is not configured'; end if;
  select net.http_post(url:=app_url || endpoint, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || token), body:='{}'::jsonb, timeout_milliseconds:=290000) into request_id;
  return request_id;
end $$;
revoke all on function public.dispatch_hubchat_worker(text) from public,anon,authenticated,service_role;

create or replace function public.configure_worker_schedule(p_app_url text,p_token text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare secret_id uuid;
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') or not exists(select 1 from pg_extension where extname='pg_net') or not exists(select 1 from pg_extension where extname='supabase_vault') then raise exception 'pg_cron, pg_net and Vault are required'; end if;
  if p_app_url !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?/?$' or length(p_token)<32 or length(p_token)>2048 or p_token ~ '[[:space:]]' then raise exception 'Invalid worker configuration'; end if;
  select id into secret_id from vault.secrets where name='hubchat_worker_url';
  if secret_id is null then perform vault.create_secret(rtrim(p_app_url,'/'),'hubchat_worker_url'); else perform vault.update_secret(secret_id,rtrim(p_app_url,'/')); end if;
  select id into secret_id from vault.secrets where name='hubchat_worker_token';
  if secret_id is null then perform vault.create_secret(p_token,'hubchat_worker_token'); else perform vault.update_secret(secret_id,p_token); end if;
  perform cron.schedule('hubchat-ingest-recovery','* * * * *',$job$select public.dispatch_hubchat_worker('ingest')$job$);
  perform cron.schedule('hubchat-notification-flush','*/5 * * * *',$job$select public.dispatch_hubchat_worker('notifications')$job$);
  return true;
end $$;
revoke all on function public.configure_worker_schedule(text,text) from public,anon,authenticated;
grant execute on function public.configure_worker_schedule(text,text) to service_role;

create or replace function public.worker_schedule_status()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare jobs jsonb;
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then return jsonb_build_object('available',false,'jobs','[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active)),'[]'::jsonb) into jobs from cron.job where jobname in ('hubchat-ingest-recovery','hubchat-notification-flush');
  return jsonb_build_object('available',true,'jobs',jobs);
end $$;
revoke all on function public.worker_schedule_status() from public,anon,authenticated;
grant execute on function public.worker_schedule_status() to service_role;
notify pgrst,'reload schema';
