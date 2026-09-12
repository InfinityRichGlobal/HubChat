import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import AiSettingsClient from './ai-client';

export const dynamic = 'force-dynamic';

export default async function AiSettingsPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');

  return <AiSettingsClient isOwner={result.admin.role === 'owner'} />;
}
