import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { db } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  albums: z.array(z.string().trim().min(1)).optional(),
  categories: z.record(z.string(), z.array(z.string())).optional(),
  hidden_ids: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const admin = await requirePermission('content.manage');
    const body = schema.parse(await req.json());
    const now = new Date().toISOString();

    const updates: Array<{ key: string; value: unknown; updated_by: string; updated_at: string }> = [];

    if (body.albums !== undefined) {
      updates.push({ key: 'media_albums', value: body.albums, updated_by: admin.id, updated_at: now });
    }
    if (body.categories !== undefined) {
      updates.push({ key: 'media_categories', value: body.categories, updated_by: admin.id, updated_at: now });
    }
    if (body.hidden_ids !== undefined) {
      updates.push({ key: 'media_hidden_ids', value: body.hidden_ids, updated_by: admin.id, updated_at: now });
    }

    for (const item of updates) {
      await db().from('app_settings').upsert(item, { onConflict: 'key' });
    }

    return ok({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
