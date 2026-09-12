import 'server-only';
import { db } from '@/lib/supabase/admin';

/**
 * จัดการรูปโปรไฟล์แอดมิน (บันทึกลง runtime_settings เพื่อความปลอดภัยและยืดหยุ่น)
 * ⚠️ runtime_settings มี constraint: key ~ '^[A-Z][A-Z0-9_]{1,63}$'
 * จึงต้องแปลง UUID เป็น 32 ตัวอักษรพิมพ์ใหญ่ไม่มีขีด
 */
function toSettingKey(adminId: string): string {
  return `ADMIN_AVATAR_${adminId.replace(/-/g, '').toUpperCase()}`;
}

function fromSettingKey(key: string): string {
  const hex = key.replace('ADMIN_AVATAR_', '').toLowerCase();
  if (hex.length !== 32) return hex;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function getAdminAvatar(adminId: string): Promise<string | null> {
  const key = toSettingKey(adminId);
  const { data } = await db()
    .from('runtime_settings')
    .select('plain_value')
    .eq('key', key)
    .maybeSingle();
  return typeof data?.plain_value === 'string' ? data.plain_value : null;
}

export async function setAdminAvatar(adminId: string, url: string | null): Promise<void> {
  const key = toSettingKey(adminId);
  if (!url) {
    await db().from('runtime_settings').delete().eq('key', key);
    return;
  }
  const { error } = await db().from('runtime_settings').upsert(
    {
      key,
      kind: 'general',
      plain_value: url,
      readiness: 'LIVE_VERIFIED',
      configured_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error) {
    console.error('[avatar] บันทึกรูปโปรไฟล์ไม่สำเร็จ:', error);
    throw new Error(`บันทึกรูปโปรไฟล์ไม่สำเร็จ: ${error.message}`);
  }
}

export async function getAllAdminAvatars(): Promise<Record<string, string>> {
  const { data } = await db()
    .from('runtime_settings')
    .select('key, plain_value')
    .like('key', 'ADMIN_AVATAR_%');

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    const id = fromSettingKey(row.key);
    if (typeof row.plain_value === 'string') map[id] = row.plain_value;
  }
  return map;
}
