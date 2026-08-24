/**
 * /api/media/[id] — เสิร์ฟไฟล์ที่เราเก็บไว้เอง (D-17)
 *
 * 🔴 ทำไมต้องผ่านเส้นนี้ ไม่ให้เบราว์เซอร์ไปโหลดจาก R2 ตรง ๆ :
 *    ถ้าเปิดถังให้อ่านสาธารณะ ใครเดา URL ถูกก็เห็นสลิปโอนเงินของลูกค้าได้
 *    ถ้าใช้ presigned URL ก็ยังหลุดต่อได้เมื่อมีคนส่งลิงก์ให้กัน
 *    การเสิร์ฟผ่านเส้นนี้ทำให้ "ทุกครั้งที่มีคนดู" ถูกตรวจสิทธิ์เสมอ
 *
 * ⚠️ credential ของ R2 อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่มีทางหลุดออกไปที่เบราว์เซอร์
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/current-admin';
import { fail, toErrorResponse } from '@/lib/api';
import { canSeePage } from '@/lib/auth/permissions';
import { getMediaAsset } from '@/server/storage/media';
import { getObject, StorageNotConfiguredError } from '@/server/storage/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;

    const asset = await getMediaAsset(id);
    if (!asset) return fail('not_found', 'ไม่พบไฟล์นี้', 404);

    // ⭐ สิทธิ์รายเพจ — แอดมินที่ไม่มีสิทธิ์เห็นเพจไหน ต้องไม่เห็นไฟล์ของเพจนั้น
    if (asset.page_id && !canSeePage(admin.role, admin.allowed_page_ids, asset.page_id)) {
      return fail('forbidden', 'คุณไม่มีสิทธิ์เข้าถึงไฟล์นี้', 403);
    }

    if (asset.status !== 'stored' || !asset.storage_key) {
      // บอกสาเหตุตรง ๆ จะได้รู้ว่าเป็นเพราะอะไร ไม่ใช่กรอบว่าง ๆ
      const why =
        asset.status === 'expired' ? 'ลิงก์ต้นทางหมดอายุก่อนที่ระบบจะเก็บทัน'
        : asset.status === 'skipped' ? 'ยังไม่ได้ตั้งค่าที่เก็บไฟล์ (R2) ตอนที่ไฟล์นี้เข้ามา'
        : asset.status === 'pending' ? 'กำลังเก็บไฟล์ ลองใหม่อีกครู่'
        : 'เก็บไฟล์ไม่สำเร็จ';
      return fail('not_stored', why, 404);
    }

    const object = await getObject(asset.storage_key);
    if (!object) return fail('not_found', 'ไฟล์หายไปจากที่เก็บ', 404);

    return new Response(object.body, {
      status: 200,
      headers: {
        'Content-Type': object.mime,
        // ไฟล์ตั้งชื่อตามลายนิ้วมือ เนื้อหาจึงไม่มีวันเปลี่ยน — แคชในเครื่องผู้ใช้ได้ยาว
        // ⚠️ private เพราะเป็นข้อมูลลูกค้า ห้ามให้ proxy กลางทางเก็บไว้แจกต่อ
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      return fail('storage_not_configured', 'ยังไม่ได้ตั้งค่าที่เก็บไฟล์ (Cloudflare R2)', 503);
    }
    return toErrorResponse(err);
  }
}
