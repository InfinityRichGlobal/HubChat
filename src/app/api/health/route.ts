/**
 * GET /api/health — ตรวจว่าระบบยังมีชีวิตอยู่ไหม
 * -------------------------------------------------------------------------
 * ใช้ 2 อย่าง :
 *   • Railway/Render เรียกเช็คว่า deploy สำเร็จหรือยัง
 *   • เราเปิดเองตอนตั้งค่าเสร็จ เพื่อดูว่า env ครบและต่อ DB ติดจริง
 *
 * ไม่ต้อง login เข้าได้ แต่ห้ามเปิดเผยค่าลับใด ๆ — บอกแค่ "ผ่าน/ไม่ผ่าน"
 */
import { db } from '@/lib/supabase/admin';
import { ALL_TABLES } from '@/types/db';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, { ok: boolean; message_th: string }> = {};

  // 1) env ครบไหม
  try {
    const { assertEnv } = await import('@/config/env');
    await assertEnv();
    checks.env = { ok: true, message_th: 'ตั้งค่า environment และกฎ Policy Engine ถูกต้อง' };
  } catch (err) {
    checks.env = { ok: false, message_th: (err as Error).message.trim() };
    return NextResponse.json({ ok: false, checks }, { status: 503 });
  }

  // 2) ต่อฐานข้อมูลติดไหม
  try {
    const { error } = await db().from('admins').select('id', { head: true, count: 'exact' }).limit(1);
    if (error) throw error;
    checks.database = { ok: true, message_th: 'ต่อฐานข้อมูลได้' };
  } catch (err) {
    checks.database = {
      ok: false,
      message_th: `ต่อฐานข้อมูลไม่ได้ หรือยังไม่ได้รัน migration: ${(err as Error).message}`,
    };
    return NextResponse.json({ ok: false, checks }, { status: 503 });
  }

  // 3) ตารางครบตามสเปกหัวข้อ 3 ไหม
  const missing: string[] = [];
  for (const table of ALL_TABLES) {
    const { error } = await db().from(table).select('*', { head: true, count: 'exact' }).limit(1);
    if (error) missing.push(table);
  }
  checks.tables = missing.length
    ? { ok: false, message_th: `ยังไม่มีตาราง: ${missing.join(', ')} — รัน supabase/migrations/0001_init.sql ก่อน` }
    : { ok: true, message_th: `ตารางครบ ${ALL_TABLES.length} ตาราง` };

  // 4) มีบัญชีเจ้าของแล้วหรือยัง
  const { count } = await db()
    .from('admins')
    .select('id', { head: true, count: 'exact' })
    .eq('role', 'owner')
    .eq('is_active', true);
  checks.owner = (count ?? 0) > 0
    ? { ok: true, message_th: 'มีบัญชีเจ้าของแล้ว' }
    : { ok: false, message_th: 'ยังไม่มีบัญชีเจ้าของ — รัน npm run create-owner' };

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok: allOk, checks }, { status: allOk ? 200 : 503 });
}
