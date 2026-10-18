-- Fix replay detection and reserve automated public replies before calling Meta.
-- Apply before deploying the corresponding application code. Safe to re-run.
begin;

-- Remove the old overload: its 13 arguments overlap with the default arguments
-- of the newer function and make PostgREST/SQL calls ambiguous.
drop function if exists public.ingest_comment(uuid,text,text,text,text,text,text,text,text,text,boolean,timestamptz,jsonb);

create or replace function public.ingest_comment(
  p_page_id uuid, p_comment_id text, p_post_id text, p_parent_id text,
  p_from_id text, p_from_name text, p_message text, p_permalink text,
  p_attachment_url text, p_matched_keyword text, p_is_from_page boolean,
  p_commented_at timestamptz, p_raw jsonb,
  p_from_username text default null, p_from_pic_url text default null
)
returns table (comment_row_id uuid, duplicate boolean)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into comments (
    page_id, comment_id, post_id, parent_comment_id, from_id, from_name,
    from_username, from_pic_url, message, post_permalink, attachment_url,
    matched_keyword, is_from_page, commented_at, raw, is_handled
  ) values (
    p_page_id, p_comment_id, p_post_id, nullif(p_parent_id, ''), p_from_id, p_from_name,
    p_from_username, p_from_pic_url, p_message, p_permalink, p_attachment_url,
    p_matched_keyword, coalesce(p_is_from_page, false), coalesce(p_commented_at, now()),
    coalesce(p_raw, '{}'::jsonb), coalesce(p_is_from_page, false)
  ) on conflict (comment_id) do nothing
  returning id into v_id;

  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  -- Enrich existing profiles without reporting an UPDATE as a new comment.
  -- A concurrent INSERT has finished before ON CONFLICT returns here.
  update comments c
     set from_username = coalesce(c.from_username, p_from_username),
         from_pic_url = coalesce(c.from_pic_url, p_from_pic_url),
         from_name = coalesce(c.from_name, p_from_name)
   where c.comment_id = p_comment_id and c.page_id = p_page_id
   returning c.id into v_id;

  if v_id is null then
    select c.id into v_id from comments c where c.comment_id = p_comment_id;
  end if;
  return query select v_id, true;
end
$$;

alter table public.comments add column if not exists bot_public_claimed_at timestamptz;

create or replace function public.claim_comment_public_reply(p_comment_row_id uuid)
returns table (won boolean)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  update comments
     set bot_public_claimed_at = now(),
         last_error_th = 'จองสิทธิ์ตอบอัตโนมัติแล้ว หากสถานะค้างให้ตรวจคอมเมนต์บน Meta ก่อนตอบเอง'
   where id = p_comment_row_id
     and not replied_public and not is_from_page and not is_deleted
     and bot_public_claimed_at is null
   returning id into v_id;
  return query select v_id is not null;
end
$$;

-- Never expire a claim automatically: after a crash/timeout Meta may already
-- have published the reply. Explicit manual follow-up remains available.
revoke all on function public.ingest_comment(uuid,text,text,text,text,text,text,text,text,text,boolean,timestamptz,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.ingest_comment(uuid,text,text,text,text,text,text,text,text,text,boolean,timestamptz,jsonb,text,text) to service_role;
revoke all on function public.claim_comment_public_reply(uuid) from public, anon, authenticated;
grant execute on function public.claim_comment_public_reply(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
