import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Search, ShoppingBag, UserRound } from 'lucide-react';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { canSeePage } from '@/lib/auth/permissions';
import { db } from '@/lib/supabase/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import CustomerAvatar from '@/components/customer-avatar';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  const { q = '' } = await searchParams;

  const { data: pages } = await db().from('pages').select('id');
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
  const term = q.trim().replace(/[%,_()]/g, '');
  if (term) query = query.or(`name.ilike.%${term}%,recipient_name.ilike.%${term}%,phone.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) throw new Error(`อ่านข้อมูลลูกค้าไม่สำเร็จ: ${error.message}`);
  const customers = (data ?? []) as Array<{
    id: string; name: string | null; profile_pic_url: string | null; phone: string | null;
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
        <h1 className="text-xl font-semibold">ข้อมูลลูกค้า</h1>
        <p className="text-sm text-muted-foreground">ค้นหาชื่อ เบอร์โทร และเปิดกลับไปยังห้องแชทได้ทันที</p>
      </div>
      <form className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} className="pl-9" placeholder="ค้นหาชื่อหรือเบอร์โทร" />
        </div>
        <Button type="submit">ค้นหา</Button>
      </form>
      <div className="grid gap-2 md:grid-cols-2">
        {customers.map((customer) => {
          const conversationId = conversationByCustomer.get(customer.id);
          const name = customer.name || customer.recipient_name || 'ลูกค้า';
          return (
            <Card key={customer.id} className="gap-2 py-3">
              <CardHeader className="flex-row items-center gap-2.5 px-4">
                <CustomerAvatar name={name} src={customer.profile_pic_url} size="md" />
                <div className="min-w-0 flex-1">
                  <CardTitle className="truncate text-base">{name}</CardTitle>
                  <p className="text-xs text-muted-foreground">{customer.phone || 'ยังไม่มีเบอร์โทร'}</p>
                </div>
                {customer.total_orders > 0 && <span className="inline-flex size-7 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">{customer.total_orders}</span>}
              </CardHeader>
              <CardContent className="space-y-1.5 px-4 text-sm">
                <p className="truncate text-muted-foreground">{customer.address ? `${customer.address} ${customer.postcode ?? ''}` : 'ยังไม่มีที่อยู่จัดส่ง'}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><ShoppingBag className="size-3.5" /> ยอดสะสม {Number(customer.total_spent).toLocaleString('th-TH')} บาท</span>
                  {conversationId && <Button asChild size="sm" variant="outline"><Link href={`/inbox?c=${conversationId}`}><UserRound /> เปิดแชท</Link></Button>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {customers.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">ไม่พบข้อมูลลูกค้า</p>}
    </div>
  );
}
