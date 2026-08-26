import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/supabase/admin';
import { getRuntimeSetting } from '@/server/settings/service';
import MediaClient from './media-client';

export const dynamic = 'force-dynamic';

export default async function MediaPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  const [{ data }, base] = await Promise.all([
    db().from('media_assets').select('id,storage_key,mime,bytes,created_at').eq('kind', 'library').eq('status', 'stored').order('created_at', { ascending: false }).limit(200),
    getRuntimeSetting('R2_PUBLIC_BASE_URL'),
  ]);
  const items = ((data ?? []) as Array<{ id: string; storage_key: string; mime: string; bytes: number; created_at: string }>).map((item) => ({ ...item, preview_url: `/api/media/${item.id}`, public_url: base ? `${base.replace(/\/$/, '')}/${item.storage_key}` : null }));
  return <div className="mx-auto w-full max-w-5xl"><MediaClient initialItems={items} canManage={can(result.admin.role, 'content.manage')} publicReady={Boolean(base)} /></div>;
}
