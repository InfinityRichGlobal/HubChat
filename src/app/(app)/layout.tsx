import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import AppShell from '@/components/app-shell';
import { getRuntimeSetting } from '@/server/settings/service';
import { getAdminAvatar } from '@/server/admins/avatar';

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
    redirect(`/login?reason=${result.reason ?? 'session_invalid'}`);
  }

  const [displayName, logoUrl, adminAvatar] = await Promise.all([
    getRuntimeSetting('APP_DISPLAY_NAME'),
    getRuntimeSetting('APP_LOGO_URL'),
    getAdminAvatar(result.admin.id),
  ]);

  const adminWithAvatar = {
    ...result.admin,
    avatar_url: adminAvatar,
  };

  return <AppShell admin={adminWithAvatar} brand={{ name: displayName || 'HubChat', logoUrl }}>{children}</AppShell>;
}
