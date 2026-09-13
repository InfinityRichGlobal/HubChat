import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Search, ShoppingBag, UserRound, Filter } from 'lucide-react';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canSeePage } from '@/lib/auth/permissions';
import { db } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import CustomerAvatar from '@/components/customer-avatar';
import PlatformIcon from '@/components/platform-icon';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  const { q = '', filter = 'verified' } = await searchParams;

  const { data: pages } = await db().from('pages').select('id,platform');
  const pageMap = new Map(((pages ?? []) as Array<{ id: string; platform: 'facebook' | 'instagram' }>).map((p) => [p.id, p.platform]));
  const pageIds = ((pages ?? []) as Array<{ id: string }>)
    .map((page) => page.id)
    .filter((id) => canSeePage(result.admin.role, result.admin.allowed_page_ids, id));

  if (pageIds.length === 0) return <p className="text-sm text-muted-foreground">ยังไม่มีเพจที่คุณมีสิทธิ์ดู</p>;

  let query = db()
    .from('customers')
    .select('id,page_id,name,profile_pic_url,phone,recipient_name,address,postcode,total_orders,total_spent,updated_at')
    .in('page_id', pageIds)
    .order('updated_at', { ascending: false })
    .limit(200);

  // ลูกค้าจะปรากฏก็ต่อเมื่อมีการสรุปยอด (มีออเดอร์) หรือบันทึกข้อมูล
  if (filter === 'orders') {
    query = query.gt('total_orders', 0);
  } else if (filter === 'saved') {
    query = query.or('phone.not.is.null,recipient_name.not.is.null,address.not.is.null');
  } else if (filter === 'verified') {
    // ค่าเริ่มต้น: มีออเดอร์ หรือมีการบันทึกข้อมูล
    query = query.or('total_orders.gt.0,phone.not.is.null,recipient_name.not.is.null,address.not.is.null');
  }

  const term = q.trim().replace(/[%,_()]/g, '');
  if (term) query = query.or(`name.ilike.%${term}%,recipient_name.ilike.%${term}%,phone.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) throw new Error(`อ่านข้อมูลลูกค้าไม่สำเร็จ: ${error.message}`);
  const customers = (data ?? []) as Array<{
    id: string; page_id: string; name: string | null; profile_pic_url: string | null; phone: string | null;
    recipient_name: string | null; address: string | null; postcode: string | null;
    total_orders: number; total_spent: number;
  }>;

  const { data: conversations } = customers.length
    ? await db().from('conversations').select('id,customer_id').in('customer_id', customers.map((customer) => customer.id))
    : { data: [] };
  const conversationByCustomer = new Map(((conversations ?? []) as Array<{ id: string; customer_id: string }>).map((row) => [row.customer_id, row.id]));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold">ข้อมูลลูกค้า (Customer CRM)</h1>
        <p className="text-sm text-muted-foreground">บันทึกรายชื่อ ที่อยู่ และประวัติการสรุปยอดคำสั่งซื้อของลูกค้า</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <form className="flex flex-1 gap-2">
          <input type="hidden" name="filter" value={filter} />
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={q} className="pl-9" placeholder="ค้นหาชื่อ, ผู้รับ, เบอร์โทร..." />
          </div>
          <Button type="submit">ค้นหา</Button>
        </form>

        {/* แท็บตัวกรองประเภทลูกค้า */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Button
            asChild
            size="sm"
            variant={filter === 'verified' ? 'default' : 'outline'}
            className="h-8 text-xs"
          >
            <Link href={`/customers?filter=verified${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
              ลูกค้าที่มีข้อมูล/ออเดอร์
            </Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant={filter === 'orders' ? 'default' : 'outline'}
            className="h-8 text-xs"
          >
            <Link href={`/customers?filter=orders${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
              มีออเดอร์แล้ว
            </Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant={filter === 'saved' ? 'default' : 'outline'}
            className="h-8 text-xs"
          >
            <Link href={`/customers?filter=saved${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
              บันทึกที่อยู่/เบอร์
            </Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant={filter === 'all' ? 'default' : 'ghost'}
            className="h-8 text-xs text-muted-foreground"
          >
            <Link href={`/customers?filter=all${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
              ทั้งหมดที่มีประวัติแชท
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {customers.map((customer) => {
          const conversationId = conversationByCustomer.get(customer.id);
          const name = customer.name || customer.recipient_name || 'ลูกค้า';
          const platform = pageMap.get(customer.page_id) ?? 'facebook';
          return (
            <Card key={customer.id} className="gap-2 py-3 shadow-sm hover:border-primary/40 transition-colors">
              <CardHeader className="flex-row items-center gap-2.5 px-4">
                <div className="relative shrink-0">
                  <CustomerAvatar name={name} src={customer.profile_pic_url} platform={platform} size="md" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <CardTitle className="truncate text-base">{name}</CardTitle>
                    {customer.recipient_name && customer.recipient_name !== customer.name && (
                      <span className="text-xs text-muted-foreground truncate">({customer.recipient_name})</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{customer.phone || 'ยังไม่มีเบอร์โทร'}</p>
                </div>
                {customer.total_orders > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white shadow-sm" title="จำนวนออเดอร์">
                    {customer.total_orders} ออเดอร์
                  </span>
                )}
              </CardHeader>
              <CardContent className="space-y-1.5 px-4 text-sm">
                <p className="truncate text-xs text-muted-foreground">{customer.address ? `${customer.address} ${customer.postcode ?? ''}` : 'ยังไม่มีที่อยู่จัดส่ง'}</p>
                <div className="flex items-center justify-between gap-2 pt-1 border-t">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ShoppingBag className="size-3.5" /> ยอดสะสม {Number(customer.total_spent).toLocaleString('th-TH')} บาท
                  </span>
                  {conversationId && (
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1">
                      <Link href={`/inbox?c=${conversationId}`}>
                        <UserRound className="size-3.5" /> เปิดแชท
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {customers.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <p className="text-sm font-medium">ไม่พบข้อมูลลูกค้าตามเงื่อนไขที่เลือก</p>
          <p className="text-xs mt-1 text-muted-foreground/80">ข้อมูลลูกค้าจะปรากฏขึ้นอัตโนมัติเมื่อแอดมินบันทึกข้อมูลลูกค้า หรือทำการเปิดออเดอร์สรุปยอด</p>
        </div>
      )}
    </div>
  );
}

