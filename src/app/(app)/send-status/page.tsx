import { PAGE_SIZE, pageNumber, pageHref } from '@/lib/pagination';
import type { SendStatus } from '@/server/messaging/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/current-admin';
import { listSendStatuses, statusLabel } from '@/server/messaging/status-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function SendStatusPage({ searchParams }: { searchParams: Promise<{ p?: string; status?: string; q?: string }> }) {
  const { p, status = '', q = '' } = await searchParams;
  const page = pageNumber(p);
  const statuses: SendStatus[] = ['claimed','succeeded','blocked_by_policy','permanent_failed','retryable_failed','outcome_unknown'];
  const selected = statuses.includes(status as SendStatus) ? status as SendStatus : undefined;
  let admin;
  try { admin = await requireAdmin(); } catch { redirect('/login'); }
  const feed = await listSendStatuses(admin, selected, { offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE + 1, q });
  const rows = feed.slice(0, PAGE_SIZE);
  const hasMore = feed.length > PAGE_SIZE;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>สถานะการส่ง</CardTitle><CardDescription>ประวัติส่งจากทางส่งกลาง · แชทและข้อความแจ้งเลขพัสดุ</CardDescription></CardHeader>
      </Card>
      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} aria-label="ค้นหาเหตุผลสถานะการส่ง" placeholder="ค้นหาเหตุผล..." className="min-w-40 flex-1" />
        <select name="status" defaultValue={selected ?? ''} aria-label="กรองสถานะการส่ง" className="h-9 max-w-full rounded-md border bg-background px-3 text-sm">
          <option value="">ทุกสถานะ</option>{statuses.map(s => <option key={s} value={s}>{statusLabel(s).label_th}</option>)}
        </select><Button type="submit">ค้นหา</Button>
      </form>
      <div className="flex items-center justify-between gap-2 text-sm"><span>หน้า {page} · {rows.length} รายการ</span><nav aria-label="หน้าประวัติการส่ง" className="flex gap-2">
        {page > 1 && <Button asChild variant="outline" size="sm"><Link href={pageHref('/send-status', page - 1, { status, q })}>ก่อนหน้า</Link></Button>}
        {hasMore && <Button asChild variant="outline" size="sm"><Link href={pageHref('/send-status', page + 1, { status, q })}>ถัดไป</Link></Button>}
      </nav></div>
      <Card>
        <CardContent className="divide-y p-0">
          {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">ไม่พบประวัติการส่งตามเงื่อนไขนี้</p>}
          {rows.map((row) => {
            const label = statusLabel(row.status);
            return <div key={row.id} className="flex min-w-0 flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><Badge variant={row.status === 'succeeded' ? 'default' : row.status === 'outcome_unknown' ? 'destructive' : 'secondary'}>{label.label_th}</Badge><span className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString('th-TH')}</span></div>
                <p className="mt-1 break-words text-sm">{row.policy_reason_th ?? `${row.message_type} · ${row.triggered_by}`}</p>
                {row.status === 'outcome_unknown' && <p className="text-xs font-medium text-destructive">อาจถึงลูกค้าแล้ว ห้ามกดส่งซ้ำโดยเดา</p>}
              </div>
              {row.conversation_id && <Link className="text-sm text-primary underline" href={`/inbox?c=${row.conversation_id}`}>เปิดแชท</Link>}
            </div>;
          })}
        </CardContent>
      </Card>
    </div>
  );
}
