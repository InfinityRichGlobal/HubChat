import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import AssistSettingsClient from './assist-client';

export const dynamic = 'force-dynamic';

export default async function AssistSettingsPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');

  return <AssistSettingsClient isOwner={result.admin.role === 'owner'} />;
}
