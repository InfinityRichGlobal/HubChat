import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import SystemSettingsClient from './system-settings-client';

export default async function SystemSettingsPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (result.admin.role !== 'owner') redirect('/settings');
  return <SystemSettingsClient />;
}
