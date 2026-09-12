import 'server-only';
import { db } from '@/lib/supabase/admin';

/**
 * จัดการรูปโปรไฟล์แอดมิน (บันทึกลง runtime_settings เพื่อความปลอดภัยและยืดหยุ่น)
 */
export async function getAdminAvatar(adminId: string): Promise<string | null> {
  const { data } = await db()
    .from('runtime_settings')
    .select('plain_value')
    .eq('key', `ADMIN_AVATAR_${adminId}`)
    .maybeSingle();
  return typeof data?.plain_value === 'string' ? data.plain_value : null;
}

export async function setAdminAvatar(adminId: string, url: string | null): Promise<void> {
  if (!url) {
    await db().from('runtime_settings').delete().eq('key', `ADMIN_AVATAR_${adminId}`);
    return;
  }
  await db().from('runtime_settings').upsert(
    {
      key: `ADMIN_AVATAR_${adminId}`,
      kind: 'general',
      plain_value: url,
      readiness: 'LIVE_VERIFIED',
      configured_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
}

export async function getAllAdminAvatars(): Promise<Record<string, string>> {
  const { data } = await db()
    .from('runtime_settings')
    .select('key, plain_value')
    .like('key', 'ADMIN_AVATAR_%');

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    const id = row.key.replace('ADMIN_AVATAR_', '');
    if (typeof row.plain_value === 'string') map[id] = row.plain_value;
  }
  return map;
}
