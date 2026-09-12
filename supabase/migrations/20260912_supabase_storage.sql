-- สร้าง bucket 'media' แบบ private สำหรับเก็บรูปภาพ/สลิป/วิดีโอ
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 26214400)
on conflict (id) do nothing;
