/**
 * สร้างบัญชี "เจ้าของ" ครั้งเดียวตอนติดตั้ง
 * -------------------------------------------------------------------------
 * ใช้ครั้งเดียวจริง ๆ — ถ้ามีเจ้าของอยู่แล้วสคริปต์จะ "ล็อกตัวเอง" ไม่ยอมทำงาน
 * (ตามสเปกหัวข้อ 3 ตาราง admins : "เจ้าของสร้างครั้งเดียวตอนติดตั้งด้วยสคริปต์
 *  + env var แล้วสคริปต์ล็อกตัวเอง")
 *
 * วิธีใช้ :
 *   1. ใส่ค่าใน .env.local :
 *        OWNER_NAME=ชื่อคุณ
 *        OWNER_EMAIL=you@example.com
 *        OWNER_PASSWORD=รหัสผ่านที่ตั้งเอง   (ไม่ใส่ = ระบบสุ่มให้)
 *   2. รัน : npm run create-owner
 *   3. เข้าสู่ระบบ แล้ว "ลบ 3 บรรทัดนั้นออกจาก .env.local" ทันที
 *
 * บังคับให้เปลี่ยนรหัสตอน login ครั้งแรกเสมอ ถึงจะตั้งรหัสมาเองก็ตาม
 */
import { config as loadEnv } from 'dotenv';

// อ่านค่าจาก .env.local ก่อน แล้วค่อย .env (เหมือนที่ Next.js ทำ)
loadEnv({ path: ['.env.local', '.env'], quiet: true });
import { createClient } from '@supabase/supabase-js';
import { hash as argonHash } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';

function need(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`\n❌ ยังไม่ได้ตั้งค่า ${key} ในไฟล์ .env.local\n`);
    process.exit(1);
  }
  return v;
}

/** สุ่มรหัสผ่านที่อ่านออกเสียงง่าย ไม่มีตัวที่สับสน (0/O, 1/l) */
function randomPassword(len = 12): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomUUID().replace(/-/g, ''))
    .slice(0, len)
    .map((c) => alphabet[parseInt(c, 16) % alphabet.length])
    .join('');
}

async function main() {
  const url = need('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');
  const name = need('OWNER_NAME');
  const email = need('OWNER_EMAIL').trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD?.trim() || randomPassword();
  const generated = !process.env.OWNER_PASSWORD?.trim();

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- ตรวจก่อนว่าตารางมีจริงไหม -----------------------------------------
  const probe = await supabase.from('admins').select('id', { head: true, count: 'exact' });
  if (probe.error) {
    console.error(
      `\n❌ ยังไม่มีตาราง admins หรือต่อฐานข้อมูลไม่ได้\n` +
        `   ให้เปิด Supabase → SQL Editor → วางไฟล์ supabase/migrations/0001_init.sql แล้ว Run ก่อน\n` +
        `   รายละเอียด: ${probe.error.message}\n`,
    );
    process.exit(1);
  }

  // --- 🔒 ล็อกตัวเอง : ถ้ามีเจ้าของอยู่แล้ว ห้ามสร้างซ้ำ --------------------
  const { count: ownerCount } = await supabase
    .from('admins')
    .select('id', { head: true, count: 'exact' })
    .eq('role', 'owner');

  if ((ownerCount ?? 0) > 0) {
    console.error(
      `\n🔒 มีบัญชีเจ้าของอยู่แล้ว (${ownerCount} บัญชี) — สคริปต์นี้ทำงานได้ครั้งเดียวเท่านั้น\n` +
        `   ถ้าลืมรหัสผ่าน ให้เข้าไปแก้ที่ Supabase โดยตรง หรือให้เจ้าของอีกคนตั้งรหัสชั่วคราวใหม่ให้\n`,
    );
    process.exit(1);
  }

  // --- สร้างบัญชี ---------------------------------------------------------
  const password_hash = await argonHash(password, {
    algorithm: 2, // Argon2id
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const { data, error } = await supabase
    .from('admins')
    .insert({
      name,
      email,
      password_hash,
      role: 'owner',
      allowed_page_ids: [],
      must_change_password: true, // บังคับเปลี่ยนตอน login ครั้งแรกเสมอ
      is_active: true,
    })
    .select('id,name,email,role')
    .single();

  if (error) {
    console.error(`\n❌ สร้างบัญชีไม่สำเร็จ: ${error.message}\n`);
    process.exit(1);
  }

  console.log('\n✅ สร้างบัญชีเจ้าของเรียบร้อย');
  console.log('──────────────────────────────────────────');
  console.log(`  ชื่อ     : ${data.name}`);
  console.log(`  อีเมล    : ${data.email}`);
  console.log(`  รหัสผ่าน : ${password}${generated ? '   (ระบบสุ่มให้)' : ''}`);
  console.log('──────────────────────────────────────────');
  console.log('  ⚠️  เข้าสู่ระบบครั้งแรกจะถูกบังคับให้ตั้งรหัสผ่านใหม่');
  console.log('  ⚠️  ทำเสร็จแล้วให้ลบ OWNER_NAME / OWNER_EMAIL / OWNER_PASSWORD ออกจาก .env.local\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
