-- ============================================================================
--  HubChat — 20260913 : Instagram Comments + Profile Picture + Comment Actions
--  วิธีใช้ : เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
--  ไฟล์นี้รันซ้ำได้ และไม่แก้ข้อมูลเดิม
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) comments — เติมคอลัมน์สำหรับ Instagram และการจัดการคอมเมนต์
-- ---------------------------------------------------------------------------
alter table comments add column if not exists from_username     text;
alter table comments add column if not exists from_pic_url      text;
alter table comments add column if not exists is_liked          boolean not null default false;
alter table comments add column if not exists is_deleted        boolean not null default false;
alter table comments add column if not exists profile_fetched_at timestamptz;

create index if not exists comments_from_id_idx on comments (from_id);
create index if not exists comments_is_liked_idx on comments (is_liked) where is_liked = true;
create index if not exists comments_is_deleted_idx on comments (is_deleted) where is_deleted = true;

-- ---------------------------------------------------------------------------
--  2) อัปเดต ingest_comment ให้รองรับ from_username และ from_pic_url
-- ---------------------------------------------------------------------------
create or replace function ingest_comment(
  p_page_id         uuid,
  p_comment_id      text,
  p_post_id         text,
  p_parent_id       text,
  p_from_id         text,
  p_from_name       text,
  p_message         text,
  p_permalink       text,
  p_attachment_url  text,
  p_matched_keyword text,
  p_is_from_page    boolean,
  p_commented_at    timestamptz,
  p_raw             jsonb,
  p_from_username   text default null,
  p_from_pic_url    text default null
)
returns table (comment_row_id uuid, duplicate boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  insert into comments (
    page_id, comment_id, post_id, parent_comment_id,
    from_id, from_name, from_username, from_pic_url,
    message, post_permalink, attachment_url,
    matched_keyword, is_from_page, commented_at, raw,
    -- คอมเมนต์ของเพจเราเอง ไม่ต้องให้แอดมินมาจัดการ
    is_handled
  ) values (
    p_page_id, p_comment_id, p_post_id, nullif(p_parent_id, ''),
    p_from_id, p_from_name, p_from_username, p_from_pic_url,
    p_message, p_permalink, p_attachment_url,
    p_matched_keyword, coalesce(p_is_from_page, false),
    coalesce(p_commented_at, now()), coalesce(p_raw, '{}'::jsonb),
    coalesce(p_is_from_page, false)
  )
  on conflict (comment_id) do update set
    from_username = coalesce(comments.from_username, excluded.from_username),
    from_pic_url = coalesce(comments.from_pic_url, excluded.from_pic_url),
    from_name = coalesce(comments.from_name, excluded.from_name)
  returning id into v_id;

  if v_id is null then
    select c.id into v_id from comments c where c.comment_id = p_comment_id;
    return query select v_id, true;
    return;
  end if;

  return query select v_id, false;
end
$$;
