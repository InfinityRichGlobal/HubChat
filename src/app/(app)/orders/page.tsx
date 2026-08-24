import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { listOrders } from '@/server/orders/service';
import { db } from '@/lib/supabase/admin';
import OrdersClient from './orders-client';

/** หน้าออเดอร์ — สเปกหัวข้อ 5.3 */
export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');

  const [orders, { data: pages }] = await Promise.all([
    listOrders(result.admin),
    db().from('pages').select('id,display_name,page_name,tag_color').order('created_at'),
  ]);

  return (
    <OrdersClient
      canEdit={result.admin.role !== 'viewer'}
      initialOrders={orders}
      pages={
        (pages ?? []) as Array<{
          id: string;
          display_name: string | null;
          page_name: string;
          tag_color: string;
        }>
      }
    />
  );
}
