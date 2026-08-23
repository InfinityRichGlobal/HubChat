import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import AppShell from '@/components/app-shell';

/**
 * โครงหน้าจอหลังเข้าสู่ระบบ
 * -------------------------------------------------------------------------
 * ตรวจสิทธิ์ที่นี่อีกชั้น (middleware ตรวจแค่ลายเซ็นตั๋ว)
 * ถ้าบัญชีถูกปิด หรือโดนเตะออกทุกเครื่อง จะหลุดออกตรงนี้
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const result = await getCurrentAdmin();

  if (!result.ok) {
    if (result.reason === 'must_change_password') redirect('/change-password');
    redirect('/login');
  }

  return <AppShell admin={result.admin}>{children}</AppShell>;
}
