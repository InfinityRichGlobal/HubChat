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

export async function GET(req: NextRequest) {
  try {
    await requirePermission('content.view');
    const forPicker = req.nextUrl.searchParams.get('for_picker') === '1';

    const [{ data, error }, { data: settingsData }] = await Promise.all([
      db()
        .from('media_assets')
        .select('id,storage_key,mime,bytes,created_at')
        .eq('kind', 'library')
        .eq('status', 'stored')
        .order('created_at', { ascending: false })
        .limit(200),
      db()
        .from('app_settings')
        .select('key,value')
        .in('key', ['media_albums', 'media_categories', 'media_hidden_ids']),
    ]);

    if (error) throw new Error(`อ่านคลังสื่อไม่สำเร็จ: ${error.message}`);

    const settingsMap = new Map((settingsData ?? []).map((s) => [s.key, s.value]));
    const defaultAlbums = ['โปรโมชั่น', 'สินค้า', 'รีวิว / สลิป', 'วิดีโอ', 'ระบบ', 'ทั่วไป'];
    const albums = (settingsMap.get('media_albums') as string[] | undefined) ?? defaultAlbums;
    const rawCategories = (settingsMap.get('media_categories') as Record<string, string | string[]> | undefined) ?? {};
    const hiddenIds = (settingsMap.get('media_hidden_ids') as string[] | undefined) ?? [];

    // Normalise categories to string[]
    const categories: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(rawCategories)) {
      categories[k] = Array.isArray(v) ? v : [v];
    }

    const items = ((data ?? []) as Array<{ id: string; storage_key: string; mime: string; bytes: number; created_at: string }>)
      .map((item) => {
        const isVideo = item.mime.startsWith('video/');
        const defaultCats = isVideo ? ['วิดีโอ'] : ['ทั่วไป'];
        const itemCats = categories[item.id] ?? defaultCats;
        const isHidden = hiddenIds.includes(item.id);
        const publicUrl = item.storage_key ? getPublicUrl(item.storage_key) : `/api/media/${item.id}`;

        return {
          ...item,
          preview_url: `/api/media/${item.id}`,
          public_url: publicUrl,
          categories: itemCats,
          is_hidden: isHidden,
        };
      })
      .filter((item) => {
        // เมื่อเรียกจากกล่องเลือกรูปในห้องแชท ห้ามนำไฟล์ที่ปิดตามาแสดงผลเด็ดขาด
        if (forPicker && item.is_hidden) return false;
        return true;
      });

    return ok({
      items,
      albums,
      categories,
      hidden_ids: hiddenIds,
      public_ready: true,
    });
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
    const category = typeof form.get('category') === 'string' ? (form.get('category') as string).trim() : null;
    if (category) {
      const { data: existing } = await db()
        .from('app_settings')
        .select('value')
        .eq('key', 'media_categories')
        .maybeSingle();
      const currentMap = ((existing?.value as Record<string, string[]>) || {});
      currentMap[id] = [category];
      await db().from('app_settings').upsert({
        key: 'media_categories',
        value: currentMap,
      });
    }

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
