-- สร้าง bucket 'media' แบบ private สำหรับเก็บรูปภาพ/สลิป/วิดีโอ
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)
on conflict (id) do update set file_size_limit = 52428800, public = true;
