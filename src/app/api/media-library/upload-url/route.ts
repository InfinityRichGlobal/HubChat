import { NextRequest } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { db } from '@/lib/supabase/admin';
import { buildKey } from '@/server/storage/supabase-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm',
];
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

const schema = z.object({
  filename: z.string().min(1).max(200),
  mime: z.string().min(1),
  bytes: z.number().int().min(1).max(MAX_BYTES),
});

export async function POST(req: NextRequest) {
  try {
    await requirePermission('content.manage');
    const body = schema.parse(await req.json());

    if (!ALLOWED.includes(body.mime)) {
      return fail('unsupported', 'รองรับรูป JPG/PNG/GIF/WEBP และวิดีโอ MP4/MOV/WEBM', 422);
    }

    const randomHex = randomBytes(16).toString('hex');
    const key = buildKey('library', randomHex, body.mime, new Date());

    const { data, error } = await db().storage.from('media').createSignedUploadUrl(key);
    if (error || !data) {
      throw new Error(`สร้างลิงก์อัปโหลดไม่สำเร็จ: ${error?.message || 'ไม่มีข้อมูล'}`);
    }

    return ok({
      signedUrl: data.signedUrl,
      key,
      mime: body.mime,
      bytes: body.bytes,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
