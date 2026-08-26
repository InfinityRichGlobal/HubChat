import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { db } from '@/lib/supabase/admin';
import { getRuntimeSetting } from '@/server/settings/service';
import { storeUploadedFile } from '@/server/storage/media';
import { StorageNotConfiguredError } from '@/server/storage/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'];
const MAX_BYTES = 25 * 1024 * 1024;

export async function GET() {
  try {
    await requirePermission('content.view');
    const [{ data, error }, base] = await Promise.all([
      db().from('media_assets').select('id,storage_key,mime,bytes,created_at').eq('kind', 'library').eq('status', 'stored').order('created_at', { ascending: false }).limit(200),
      getRuntimeSetting('R2_PUBLIC_BASE_URL'),
    ]);
    if (error) throw new Error(`อ่านคลังสื่อไม่สำเร็จ: ${error.message}`);
    const items = ((data ?? []) as Array<{ id: string; storage_key: string; mime: string; bytes: number; created_at: string }>).map((item) => ({
      ...item,
      preview_url: `/api/media/${item.id}`,
      public_url: base ? `${base.replace(/\/$/, '')}/${item.storage_key}` : null,
    }));
    return ok({ items, public_ready: Boolean(base) });
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
    return ok({ id }, { status: 201 });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return fail('storage_not_configured', 'ต้องตั้งค่า Cloudflare R2 ก่อนจึงจะอัปโหลดเข้าคลังสื่อได้', 503);
    return toErrorResponse(err);
  }
}
