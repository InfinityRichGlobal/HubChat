import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import AppShell from '@/components/app-shell';
import { getRuntimeSetting } from '@/server/settings/service';

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

  const [displayName, logoUrl] = await Promise.all([
    getRuntimeSetting('APP_DISPLAY_NAME'),
    getRuntimeSetting('APP_LOGO_URL'),
  ]);

  return <AppShell admin={result.admin} brand={{ name: displayName || 'HubChat', logoUrl }}>{children}</AppShell>;
}
