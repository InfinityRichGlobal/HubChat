-- เพิ่มคอลัมน์ avatar_url สำหรับรูปโปรไฟล์แอดมินแต่ละคน
alter table admins add column if not exists avatar_url text;
