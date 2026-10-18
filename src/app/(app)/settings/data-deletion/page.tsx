import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import DeletionClient from './deletion-client';
export default async function DataDeletionPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (result.admin.role !== 'owner') redirect('/settings');
  return <div className="mx-auto w-full max-w-4xl"><DeletionClient /></div>;
}
