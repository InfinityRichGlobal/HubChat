import 'server-only';

import { db } from '@/lib/supabase/admin';
import { syncCustomerProfilesForPage } from '@/server/meta/conversations';
import type { MetaPage } from '@/server/meta/client';

/**
 * ดึงชื่อและโปรไฟล์จริงของลูกค้าทุกคนจาก Meta
 */
export async function syncAllCustomerProfiles(): Promise<number> {
  const { data: pages } = await db()
    .from('pages')
    .select('id, platform, page_id, access_token')
    .eq('is_active', true)
    .not('access_token', 'is', null);

  let totalUpdated = 0;
  for (const page of pages ?? []) {
    const { updated } = await syncCustomerProfilesForPage(page as MetaPage);
    totalUpdated += updated;
  }

  return totalUpdated;
}
