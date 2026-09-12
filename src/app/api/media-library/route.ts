import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { db } from '@/lib/supabase/admin';
import { getRuntimeSetting } from '@/server/settings/service';
import { storeUploadedFile } from '@/server/storage/media';
import { getPublicUrl } from '@/server/storage/supabase-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'];
const MAX_BYTES = 25 * 1024 * 1024;

export async function GET() {
  try {
    await requirePermission('content.view');
    const { data, error } = await db()
      .from('media_assets')
      .select('id,storage_key,mime,bytes,created_at')
      .eq('kind', 'library')
      .eq('status', 'stored')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw new Error(`อ่านคลังสื่อไม่สำเร็จ: ${error.message}`);
    const items = ((data ?? []) as Array<{ id: string; storage_key: string; mime: string; bytes: number; created_at: string }>).map((item) => {
      const publicUrl = item.storage_key ? getPublicUrl(item.storage_key) : `/api/media/${item.id}`;
      return {
        ...item,
        preview_url: `/api/media/${item.id}`,
        public_url: publicUrl,
      };
    });
    return ok({ items, public_ready: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission('content.manage');
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('no_file', 'กรุณาเลือกไฟล์ก่อน', 400);
    if (!ALLOWED.includes(file.type)) return fail('unsupported', 'รองรับรูป JPG/PNG/GIF/WEBP และวิดีโอ MP4/MOV/WEBM', 422);
    if (file.size > MAX_BYTES) return fail('too_large', 'ไฟล์ใหญ่เกิน 25 MB', 413);
    const id = await storeUploadedFile(await file.arrayBuffer(), file.type, 'library');
    const asset = await db().from('media_assets').select('storage_key').eq('id', id).maybeSingle();
    const url = asset?.data?.storage_key ? getPublicUrl(asset.data.storage_key) : `/api/media/${id}`;
    return ok({ id, url }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requirePermission('content.manage');
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return fail('missing_id', 'กรุณาระบุ id ไฟล์ที่ต้องการลบ', 400);
    const { data: asset } = await db().from('media_assets').select('storage_key').eq('id', id).maybeSingle();
    if (asset?.storage_key) {
      await db().storage.from('media').remove([asset.storage_key]);
    }
    await db().from('media_assets').delete().eq('id', id);
    return ok({ success: true, message_th: 'ลบไฟล์เรียบร้อย' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
