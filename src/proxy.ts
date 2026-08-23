/**
 * ด่านแรก — ตรวจตั๋ว session ก่อนเข้าหน้าใด ๆ (Next.js 16 เรียกไฟล์นี้ว่า proxy เดิมชื่อ middleware)
 * -------------------------------------------------------------------------
 * ⚠️ ที่นี่ตรวจแค่ "ลายเซ็นตั๋ว" กับ "วันหมดอายุ" เท่านั้น
 *    เพราะ middleware รันบน Edge ต่อฐานข้อมูลไม่ได้
 *    ด่านจริงที่เทียบกับฐานข้อมูล (บัญชีถูกปิด / โดนเตะออก) อยู่ที่
 *    requireAdmin() ใน src/lib/auth/current-admin.ts
 *
 * หน้าที่ของไฟล์นี้คือ "พาไปหน้าที่ถูก" ให้เร็ว ไม่ใช่การรักษาความปลอดภัยชั้นสุดท้าย
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';

/** หน้าที่เข้าได้โดยไม่ต้อง login */
const PUBLIC_PATHS = ['/login'];

/** เส้นทางที่ปล่อยผ่านเสมอ (ไฟล์ static, health check, webhook ของ Meta) */
function isBypassed(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/health') ||
    pathname.startsWith('/api/webhooks') || // Meta ยิงเข้ามาโดยไม่มี cookie
    pathname === '/favicon.ico' ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname.startsWith('/icons')
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isBypassed(pathname)) return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // ตั้ง env ไม่ครบ — บอกให้ชัดดีกว่าปล่อยผ่านเงียบ ๆ
    return NextResponse.json(
      { ok: false, error: { code: 'env_missing', message_th: 'ยังไม่ได้ตั้งค่า SESSION_SECRET บนเซิร์ฟเวอร์' } },
      { status: 500 },
    );
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token, secret) : null;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isApi = pathname.startsWith('/api');

  // --- ยังไม่ได้ login -----------------------------------------------------
  if (!session) {
    if (isPublic || pathname.startsWith('/api/auth/login')) return NextResponse.next();
    if (isApi) {
      return NextResponse.json(
        { ok: false, error: { code: 'no_session', message_th: 'กรุณาเข้าสู่ระบบ' } },
        { status: 401 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // จำหน้าที่ตั้งใจจะไป เพื่อพากลับมาหลัง login สำเร็จ
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // --- login แล้ว แต่ยังต้องเปลี่ยนรหัสผ่านครั้งแรก ------------------------
  const onChangePasswordPage =
    pathname === '/change-password' || pathname.startsWith('/api/auth/change-password');
  if (session.mcp && !onChangePasswordPage && !pathname.startsWith('/api/auth/logout')) {
    if (isApi) {
      return NextResponse.json(
        { ok: false, error: { code: 'must_change_password', message_th: 'กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งาน' } },
        { status: 403 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = '/change-password';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // --- login แล้ว แต่ยังอยู่หน้า login → พาเข้าระบบเลย ---------------------
  if (isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/inbox';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // ปล่อยผ่านไฟล์ static ทั้งหมด ที่เหลือให้ผ่าน middleware
  matcher: ['/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)'],
};
