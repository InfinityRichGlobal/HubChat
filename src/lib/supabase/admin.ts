/**
 * ตัวเชื่อม Supabase ฝั่งเซิร์ฟเวอร์ (service role)
 * -------------------------------------------------------------------------
 * ⚠️ ห้าม import ไฟล์นี้จาก client component เด็ดขาด
 * service role key ข้าม RLS ได้ทั้งหมด ถ้าหลุดไปหน้าเว็บ = ฐานข้อมูลเปิดโล่ง
 *
 * เราตั้งใจให้ทุกการอ่าน/เขียนวิ่งผ่านเซิร์ฟเวอร์ของเราเท่านั้น
 * (ตาราง Supabase เปิด RLS ไว้แต่ไม่มี policy → anon key อ่านอะไรไม่ได้เลย)
 */
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/config/env';

let _client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (_client) return _client;
  const pub = publicEnv();
  const srv = serverEnv();
  _client = createClient(pub.NEXT_PUBLIC_SUPABASE_URL, srv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      // เราไม่ได้ใช้ Supabase Auth — ระบบ login เป็นของเราเอง (ตารางแอดมิน)
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: { 'x-application-name': 'hubchat-server' },
    },
  });
  return _client;
}
