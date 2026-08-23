import { Suspense } from 'react';
import LoginForm from './login-form';

/**
 * หน้าเข้าสู่ระบบ
 * -------------------------------------------------------------------------
 * ⚠️ ไม่มีลิงก์ "สมัครสมาชิก" โดยตั้งใจ (เช็คลิสต์ความปลอดภัยข้อ 6)
 *    เจ้าของเป็นคนสร้างบัญชีแอดมินทั้งหมดจากหน้าจัดการแอดมิน
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-10">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
