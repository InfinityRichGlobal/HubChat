import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { getRuntimeSetting } from '@/server/settings/service';
import { serverEnv } from '@/config/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ทดสอบยิง GET Challenge จำลองไปที่ Webhook ของ Meta
 * เพื่อให้ผู้ใช้สามารถกดทดสอบได้จากหน้าเว็บทันที โดยไม่ต้องรอให้ Meta ยิงเข้ามา
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const settingToken = await getRuntimeSetting('META_VERIFY_TOKEN');
    const envToken = serverEnv().META_VERIFY_TOKEN;
    const verifyToken = settingToken || envToken;

    if (!verifyToken) {
      return fail('token_missing', 'ยังไม่ได้ตั้งค่า META_VERIFY_TOKEN ทั้งในระบบและ .env.local', 400);
    }

    const appUrl = (await getRuntimeSetting('APP_BASE_URL')) || process.env.APP_URL || 'http://localhost:3000';
    const cleanUrl = appUrl.replace(/\/+$/, '');
    const challenge = `test_challenge_${Math.random().toString(36).substring(2, 10)}`;

    const testUrl = `${cleanUrl}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${challenge}`;

    try {
      const res = await fetch(testUrl, {
        method: 'GET',
        cache: 'no-store',
      });

      const responseText = await res.text();

      if (res.status === 200 && responseText.trim() === challenge) {
        return ok({
          ok: true,
          status: 200,
          challenge_matched: true,
          verify_token_preview: `••••${verifyToken.slice(-4)}`,
          message_th: '✅ Webhook ทำงานสมบูรณ์ 100%! เซิร์ฟเวอร์ตอบกลับ 200 OK พร้อม Challenge ถูกต้องตรงตามมาตรฐาน Meta',
        });
      }

      return fail(
        'challenge_failed',
        `เซิร์ฟเวอร์ตอบกลับ HTTP ${res.status}: "${responseText.slice(0, 100)}" ไม่ตรงกับ Challenge "${challenge}"`,
        400,
      );
    } catch (fetchErr) {
      return fail(
        'connection_error',
        `ไม่สามารถยิงทดสอบไปยัง ${cleanUrl} ได้: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
        500,
      );
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
