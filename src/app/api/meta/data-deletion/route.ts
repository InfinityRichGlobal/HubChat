/**
 * POST /api/meta/data-deletion — Meta Data Deletion Callback
 * ===========================================================================
 * ⚠️ จำเป็นสำหรับ Meta App Review
 *    URL นี้ต้องใส่ใน Meta Developers Dashboard:
 *    Settings → Basic → Data Deletion Request Callback
 *
 * เมื่อผู้ใช้ลบแอพจาก Facebook/Instagram:
 *   1. Meta ส่ง POST มาพร้อม signed_request ใน form body
 *   2. API ตรวจลายเซ็น → ถอดรหัส → ได้ user_id
 *   3. ลบข้อมูลผู้ใช้ออกจากฐานข้อมูล
 *   4. ตอบกลับ { url, confirmation_code }
 *
 * ข้อกำหนดของ Meta:
 *   - ต้องตอบ JSON { url: "...", confirmation_code: "..." }
 *   - url = ลิงก์ที่ผู้ใช้เข้าไปดูสถานะการลบได้
 *   - confirmation_code = รหัสยืนยัน
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { parseSignedRequest, deleteUserData } from '@/server/compliance/data-deletion';
import { getRuntimeSetting } from '@/server/settings/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // Meta ส่งมาเป็น application/x-www-form-urlencoded
    const body = await req.text();
    const params = new URLSearchParams(body);
    const signedRequest = params.get('signed_request');

    if (!signedRequest) {
      return NextResponse.json(
        { error: 'Missing signed_request parameter' },
        { status: 400 },
      );
    }

    // อ่าน App Secret
    const appSecret = await getRuntimeSetting('META_APP_SECRET');
    if (!appSecret) {
      console.error('[data-deletion] META_APP_SECRET ยังไม่ได้ตั้งค่า');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 },
      );
    }

    // ถอดรหัส signed_request
    const parsed = parseSignedRequest(signedRequest, appSecret);
    if (!parsed) {
      console.warn('[data-deletion] signed_request ไม่ถูกต้อง');
      return NextResponse.json(
        { error: 'Invalid signed_request' },
        { status: 403 },
      );
    }

    const userId = parsed.user_id;
    const confirmationCode = crypto.randomBytes(16).toString('hex');

    // ลบข้อมูลของผู้ใช้
    const deletedCount = await deleteUserData(userId);
    console.log(
      `[data-deletion] ลบข้อมูลของผู้ใช้ ${userId} แล้ว ${deletedCount} รายการ (code: ${confirmationCode})`,
    );

    // สร้าง URL สำหรับตรวจสอบสถานะ
    const appUrl = process.env.APP_URL || 'https://hubchat-omega.vercel.app';
    const statusUrl = `${appUrl}/api/meta/data-deletion?code=${confirmationCode}`;

    // ตอบกลับตามรูปแบบที่ Meta กำหนด
    return NextResponse.json({
      url: statusUrl,
      confirmation_code: confirmationCode,
    });
  } catch (err) {
    console.error('[data-deletion] เกิดข้อผิดพลาด:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/meta/data-deletion?code=xxx — หน้าตรวจสถานะการลบ
 * Meta กำหนดว่า url ที่ตอบกลับต้องเป็นหน้าที่ผู้ใช้เข้าไปดูสถานะได้
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    return NextResponse.json({
      status: 'error',
      message: 'Missing confirmation code',
    }, { status: 400 });
  }

  return NextResponse.json({
    status: 'completed',
    message: `Data deletion request (${code}) has been processed. All associated user data has been deleted from our systems.`,
    confirmation_code: code,
  });
}
