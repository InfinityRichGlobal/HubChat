import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/current-admin';
import { listSendStatuses, statusLabel } from '@/server/messaging/status-service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function SendStatusPage() {
  let admin;
  try { admin = await requireAdmin(); } catch { redirect('/login'); }
  const rows = await listSendStatuses(admin);
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>สถานะการส่ง</CardTitle><CardDescription>ประวัติ 200 รายการล่าสุดจากทางส่งกลาง</CardDescription></CardHeader>
      </Card>
      <Card>
        <CardContent className="divide-y p-0">
          {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">ยังไม่มีประวัติการส่ง</p>}
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
