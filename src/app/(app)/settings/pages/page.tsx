import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { listPagesFor } from '@/server/pages/service';
import PagesClient from './pages-client';

/**
 * หน้าจัดการเพจ — สเปกหัวข้อ 5.6 / 6.6 (เจ้าของเท่านั้น)
 * ดึงข้อมูลฝั่งเซิร์ฟเวอร์ก่อน แล้วส่งให้คอมโพเนนต์ฝั่งหน้าเว็บจัดการต่อ
 *
 * ⚠️ ข้อมูลที่ส่งไปฝั่งหน้าเว็บผ่าน listPagesFor() แล้ว จึงไม่มี access token ติดไปด้วย
 */
import { getRuntimeSetting } from '@/server/settings/service';
import { serverEnv } from '@/config/env';

export const dynamic = 'force-dynamic';

export default async function PagesSettingsPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (!can(result.admin.role, 'page.manage')) redirect('/settings');

  const [pages, appUrl, verifyToken, appId, hasAppSecret] = await Promise.all([
    listPagesFor(result.admin),
    getRuntimeSetting('APP_BASE_URL').then((v) => v || process.env.APP_URL || 'http://localhost:3000'),
    getRuntimeSetting('META_VERIFY_TOKEN').then((v) => v || serverEnv().META_VERIFY_TOKEN || null),
    getRuntimeSetting('META_APP_ID').then((v) => v || serverEnv().META_APP_ID || null),
    getRuntimeSetting('META_APP_SECRET').then((v) => Boolean(v || serverEnv().META_APP_SECRET)),
  ]);

  const metaConfig = {
    webhookUrl: `${appUrl.replace(/\/+$/, '')}/api/webhooks/meta`,
    verifyToken: verifyToken,
    hasVerifyToken: Boolean(verifyToken),
    appId: appId,
    hasAppSecret,
  };

  return <PagesClient initialPages={pages} metaConfig={metaConfig} isOwner={result.admin.role === 'owner'} />;
}
