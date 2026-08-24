import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { listProducts, listPromotions } from '@/server/orders/service';
import CatalogClient from './catalog-client';

/**
 * หน้าสินค้า + โปรโมชัน — สเปกหัวข้อ 4
 * ดูได้ทุกคนที่มีสิทธิ์ดูเนื้อหา แต่แก้ได้เฉพาะคนที่จัดการเนื้อหาได้
 */
export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (!can(result.admin.role, 'content.view')) redirect('/inbox');

  const [products, promotions] = await Promise.all([listProducts(), listPromotions()]);

  return (
    <CatalogClient
      canManage={can(result.admin.role, 'content.manage')}
      initialProducts={products}
      initialPromotions={promotions}
    />
  );
}
