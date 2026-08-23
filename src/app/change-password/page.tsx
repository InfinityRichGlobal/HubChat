import ChangePasswordForm from './change-password-form';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { redirect } from 'next/navigation';

/**
 * หน้าเปลี่ยนรหัสผ่าน
 * เข้ามาที่นี่ 2 กรณี :
 *   • login ครั้งแรกด้วยรหัสชั่วคราว (must_change_password = true) — บังคับ
 *   • เข้ามาเองจากเมนู
 */
export default async function ChangePasswordPage() {
  const result = await getCurrentAdmin({ allowMustChangePassword: true });
  if (!result.ok) redirect('/login');

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-10">
      <ChangePasswordForm forced={result.admin.must_change_password} name={result.admin.name} />
    </main>
  );
}
