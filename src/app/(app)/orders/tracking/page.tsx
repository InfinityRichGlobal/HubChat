import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { listImports } from '@/server/tracking/service';
import TrackingClient from './tracking-client';

/**
 * นำเข้าเลขพัสดุ — สเปกหัวข้อ 5.8
 *
 * ⭐ อยู่ใต้ /orders โดยตั้งใจ ไม่ใช่เมนูหลัก
 *    เพราะเป็นงานที่ทำเป็นรอบ ๆ (วันละครั้ง) ไม่ใช่หน้าที่เปิดค้างไว้
 *    และเมนูล่างบนมือถือมีที่จำกัด — ของที่ใช้ทุกวันต้องได้ที่ก่อน
 */
export const dynamic = 'force-dynamic';

export default async function TrackingImportPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (!can(result.admin.role, 'order.create')) redirect('/orders');

  return (
    <TrackingClient
      isOwner={result.admin.role === 'owner'}
      initialImports={await listImports(result.admin)}
    />
  );
}
