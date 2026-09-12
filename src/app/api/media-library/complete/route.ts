import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, toErrorResponse } from '@/lib/api';
import { db } from '@/lib/supabase/admin';
import { getPublicUrl } from '@/server/storage/supabase-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  key: z.string().min(1),
  mime: z.string().min(1),
  bytes: z.number().int().min(1),
});

export async function POST(req: NextRequest) {
  try {
    await requirePermission('content.manage');
    const body = schema.parse(await req.json());

    const { data, error } = await db()
      .from('media_assets')
      .insert({
        kind: 'library',
        storage_key: body.key,
        mime: body.mime,
        bytes: body.bytes,
        status: 'stored',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`บันทึกข้อมูลสื่อไม่สำเร็จ: ${error?.message || 'ไม่มีข้อมูล'}`);
    }

    const publicUrl = getPublicUrl(body.key);

    return ok({
      id: data.id,
      url: publicUrl,
    }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
