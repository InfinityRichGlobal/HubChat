/**
 * ตรวจว่า migration ขึ้นครบหรือยัง
 * -------------------------------------------------------------------------
 * รัน : npm run check-db
 * บอกทีละตารางว่ามีหรือไม่มี จะได้รู้ทันทีว่า SQL รันไม่ครบตรงไหน
 */
import { config as loadEnv } from 'dotenv';

// อ่านค่าจาก .env.local ก่อน แล้วค่อย .env (เหมือนที่ Next.js ทำ)
loadEnv({ path: ['.env.local', '.env'], quiet: true });
import { createClient } from '@supabase/supabase-js';
import { ALL_TABLES } from '../src/types/db';

function need(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`❌ ยังไม่ได้ตั้งค่า ${key} ในไฟล์ .env.local`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const supabase = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('\nตรวจตารางตามสเปกหัวข้อ 3');
  console.log('──────────────────────────────────────────');

  const missing: string[] = [];
  for (const table of ALL_TABLES) {
    const { error, count } = await supabase.from(table).select('*', { head: true, count: 'exact' });
    if (error) {
      missing.push(table);
      console.log(`  ❌ ${table.padEnd(22)} ${error.message}`);
    } else {
      console.log(`  ✅ ${table.padEnd(22)} ${count ?? 0} แถว`);
    }
  }

  console.log('──────────────────────────────────────────');
  if (missing.length) {
    console.log(`\n❌ ยังขาด ${missing.length} ตาราง — เปิด Supabase → SQL Editor แล้วรันไฟล์ supabase/migrations/ ตามลำดับให้ครบ\n`);
    process.exit(1);
  }

  // Reading table names alone cannot detect an outdated RPC or missing column.
  const { error: columnError } = await supabase.from('comments')
    .select('bot_public_claimed_at', { head: true }).limit(1);
  // NULL can never match a row: verify the RPC without claiming any real comment.
  const { data: claim, error: claimError } = await supabase.rpc('claim_comment_public_reply', {
    p_comment_row_id: null,
  });
  if (columnError || claimError || claim?.[0]?.won !== false) {
    console.log('\n❌ ฐานข้อมูลยังไม่พร้อมสำหรับระบบกันตอบคอมเมนต์ซ้ำ');
    console.log('   รัน supabase/migrations/20261018_comment_delivery_hardening.sql ก่อน deploy แล้วตรวจอีกครั้ง\n');
    process.exit(1);
  }
  console.log('✅ คอลัมน์และ RPC กันตอบคอมเมนต์ซ้ำพร้อมใช้งาน');

  const { count: owners } = await supabase
    .from('admins')
    .select('id', { head: true, count: 'exact' })
    .eq('role', 'owner');

  console.log(`\n✅ ตารางครบทั้ง ${ALL_TABLES.length} ตาราง`);
  console.log(owners && owners > 0 ? '✅ มีบัญชีเจ้าของแล้ว\n' : '⚠️  ยังไม่มีบัญชีเจ้าของ — รัน npm run create-owner\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
