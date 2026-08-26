import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import DemoClient from './demo-client';

export default async function DemoPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (result.admin.role !== 'owner') redirect('/settings');
  return <div className="mx-auto w-full max-w-3xl"><DemoClient /></div>;
}
