'use client';
/**
 * ตัวเชื่อม Supabase ฝั่งเบราว์เซอร์ (anon key)
 * -------------------------------------------------------------------------
 * ใช้สำหรับ Realtime อย่างเดียว (แชทเด้งสด — รอบถัดไป)
 * อ่าน/เขียนตารางตรง ๆ จากที่นี่ "ไม่ได้" เพราะเปิด RLS ไว้และไม่มี policy
 * นั่นคือความตั้งใจ ข้อมูลทุกอย่างต้องผ่าน API ของเราที่ตรวจสิทธิ์แล้ว
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function browserDb(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _client;
}
