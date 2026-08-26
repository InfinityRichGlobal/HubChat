'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { DashboardData, RangeKey } from '@/server/dashboard/service';

/**
 * หน้าสรุปยอด (ฝั่งหน้าเว็บ) — สเปกหัวข้อ 5.4
 * ===========================================================================
 * ⚠️ หน้านี้ "ไม่คำนวณอะไรเอง" ทั้งสิ้น
 *    ตัวเลขทุกตัวมาจากเซิร์ฟเวอร์ที่คิดจาก metrics.ts (ซึ่งมีชุดทดสอบคุม)
 *    ถ้าหน้าเว็บคำนวณเอง จะมีวันที่ตัวเลขบนจอกับในรายงานไม่ตรงกัน
 *
 * ⭐ ตารางที่มีค่าที่สุดคือ "แยกตามแอด" — เอาไปเทียบกับค่าแอดที่จ่ายจริง
 *    แล้วรู้ว่าแอดตัวไหนกำไร ตัวไหนควรปิด
 */

const baht = (n: number) =>
  `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: 'today', label: 'วันนี้' },
  { key: '7d', label: '7 วัน' },
  { key: '30d', label: '30 วัน' },
  { key: 'custom', label: 'กำหนดเอง' },
];

export default function DashboardClient({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial);
  const [range, setRange] = useState<RangeKey>(initial.range.key);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (key: RangeKey, customFrom?: string, customTo?: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ range: key });
        if (key === 'custom') {
          if (!customFrom) {
            toast.error('เลือกวันเริ่มต้นก่อน');
            return;
          }
          params.set('from', new Date(`${customFrom}T00:00:00+07:00`).toISOString());
          if (customTo) params.set('to', new Date(`${customTo}T23:59:59+07:00`).toISOString());
        }
        const res = await fetch(`/api/dashboard?${params.toString()}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          toast.error(json?.error?.message_th ?? 'อ่านสรุปยอดไม่สำเร็จ');
          return;
        }
        setData(json.data as DashboardData);
      } catch (err) {
        // ⚠️ ต้องมีตัวรับเสมอ ไม่งั้นกดแล้วเหมือนไม่มีอะไรเกิดขึ้น
        console.error('[dashboard] อ่านสรุปยอดไม่สำเร็จ:', err);
        toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const h = data.headline;
  const selfOnly = data.scope === 'self';

  const maxDaySales = useMemo(
    () => Math.max(1, ...data.by_day.map((d) => d.sales)),
    [data.by_day],
  );
  const maxHour = useMemo(() => Math.max(1, ...data.by_hour.map((r) => r.chats)), [data.by_hour]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">สรุปยอด</h1>
        <p className="text-sm text-muted-foreground">
          {selfOnly ? 'เห็นเฉพาะออเดอร์ที่คุณเป็นคนสร้าง' : 'ยอดรวมทั้งร้าน'}
        </p>
      </div>

      {/* ---------- เลือกช่วงเวลา ---------- */}
      <div className="flex flex-wrap items-end gap-2">
        {RANGES.map((r) => (
          <Button
            key={r.key}
            size="sm"
            variant={range === r.key ? 'default' : 'outline'}
            disabled={loading}
            onClick={() => {
              setRange(r.key);
              if (r.key !== 'custom') void load(r.key);
            }}
          >
            {r.label}
          </Button>
        ))}

        {range === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="from" className="text-xs">ตั้งแต่</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="to" className="text-xs">ถึง</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8" />
            </div>
            <Button size="sm" disabled={loading} onClick={() => void load('custom', from, to)}>
              {loading && <Loader2 className="animate-spin" />}
              ดูผล
            </Button>
          </div>
        )}

        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {data.truncated && (
        <Alert variant="warning">
          <AlertTriangle className="size-4" />
          <AlertTitle>ข้อมูลในช่วงนี้เยอะเกินกว่าที่จะสรุปได้ครบ</AlertTitle>
          <AlertDescription>
            ตัวเลขที่เห็นคิดจากข้อมูลบางส่วนเท่านั้น — เลือกช่วงเวลาให้แคบลงเพื่อให้ได้ตัวเลขที่ถูกต้อง
          </AlertDescription>
        </Alert>
      )}

      {/* ---------- ตัวเลขหลัก ---------- */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Stat label="ยอดขาย" value={baht(h.sales)} big />
        <Stat label="จำนวนออเดอร์" value={String(h.order_count)} />
        <Stat label="เฉลี่ยต่อออเดอร์" value={baht(h.average_order)} />
        <Stat
          label="แชทใหม่"
          value={selfOnly ? '—' : String(h.new_chats)}
          hint={selfOnly ? 'แชทเป็นของทั้งเพจ จึงแยกรายคนไม่ได้' : undefined}
        />
        <Stat
          label="อัตราปิดการขาย"
          value={selfOnly ? '—' : `${h.close_rate}%`}
          hint={selfOnly ? 'ต้องใช้ยอดแชทรวม ซึ่งไม่ใช่ของคุณคนเดียว' : undefined}
        />
        <Stat
          label="ทักถึงปิดการขาย"
          value={h.avg_hours_to_close === null ? '—' : `${h.avg_hours_to_close} ชม.`}
          hint={h.avg_hours_to_close === null ? 'ยังไม่มีออเดอร์ที่ปิดได้ในช่วงนี้' : undefined}
        />
      </div>

      {/* ---------- ⭐ ตารางแยกตามแอด ---------- */}
      {!selfOnly && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-base">
              <TrendingUp className="size-4" />
              แยกตามแอด
            </CardTitle>
            <CardDescription>
              เอาช่อง &quot;ยอดขาย&quot; ไปเทียบกับค่าแอดที่จ่ายจริง = รู้ว่าแอดไหนกำไร
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.by_ad.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                ยังไม่มีแชทที่มาจากแอดในช่วงนี้
                <span className="mt-1 block">
                  (ต้องตั้งค่า Ice Breakers / ref ในแอดก่อน ระบบถึงจะรู้ว่าลูกค้ามาจากแอดไหน)
                </span>
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">แอด</th>
                      <th className="py-1.5 px-2 text-right font-medium">แชทเข้า</th>
                      <th className="py-1.5 px-2 text-right font-medium">ปิดได้</th>
                      <th className="py-1.5 px-2 text-right font-medium">อัตรา</th>
                      <th className="py-1.5 pl-2 text-right font-medium">ยอดขาย</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_ad.map((r) => (
                      <tr key={r.ad_id} className="border-b last:border-b-0">
                        <td className="truncate py-1.5 pr-2 font-mono text-xs">{r.ad_id}</td>
                        <td className="py-1.5 px-2 text-right">{r.chats}</td>
                        <td className="py-1.5 px-2 text-right">{r.closed}</td>
                        <td
                          className={cn(
                            'py-1.5 px-2 text-right',
                            r.close_rate >= 20 && 'text-emerald-600',
                            r.chats >= 10 && r.close_rate === 0 && 'text-destructive',
                          )}
                        >
                          {r.close_rate}%
                        </td>
                        <td className="py-1.5 pl-2 text-right font-medium">{baht(r.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- กราฟรายวัน ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ยอดขายรายวัน</CardTitle>
        </CardHeader>
        <CardContent>
          {data.by_day.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">ไม่มีข้อมูลในช่วงนี้</p>
          ) : (
            <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ minHeight: 120 }}>
              {data.by_day.map((d) => (
                <div key={d.day} className="flex min-w-8 flex-1 flex-col items-center gap-1">
                  <span className="text-[9px] text-muted-foreground">
                    {d.sales > 0 ? Math.round(d.sales / 1000) + 'k' : ''}
                  </span>
                  <div
                    className="w-full rounded-t bg-primary/80"
                    style={{ height: `${Math.max(2, (d.sales / maxDaySales) * 90)}px` }}
                    title={`${d.day} — ${baht(d.sales)} · ${d.order_count} ออเดอร์`}
                  />
                  <span className="text-[9px] text-muted-foreground">{d.day.slice(8)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- ช่วงเวลาที่ลูกค้าทักเยอะ ---------- */}
      {!selfOnly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ช่วงเวลาที่ลูกค้าทักเยอะ</CardTitle>
            <CardDescription>ใช้จัดเวรแอดมินให้ตรงกับเวลาที่ลูกค้าอยู่จริง</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-0.5" style={{ minHeight: 80 }}>
              {data.by_hour.map((r) => (
                <div key={r.hour} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className={cn('w-full rounded-t', r.chats > 0 ? 'bg-primary/70' : 'bg-muted')}
                    style={{ height: `${Math.max(2, (r.chats / maxHour) * 60)}px` }}
                    title={`${r.hour}:00 — ${r.chats} แชท`}
                  />
                  {r.hour % 3 === 0 && (
                    <span className="text-[9px] text-muted-foreground">{r.hour}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------- แยกตามเพจ / แอดมิน / สินค้า ---------- */}
      <div className="grid gap-3 md:grid-cols-3">
        <SimpleTable title="แยกตามเพจ" rows={data.by_page.map((r) => ({ label: r.label, sales: r.sales, count: r.order_count }))} />
        <SimpleTable title="แยกตามแอดมิน" rows={data.by_admin.map((r) => ({ label: r.label, sales: r.sales, count: r.order_count }))} />
        <SimpleTable
          title="สินค้าขายดี"
          unit="ชิ้น"
          rows={data.top_products.map((r) => ({ label: r.name, sales: null, count: r.qty }))}
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        ตัวเลขทั้งหมดคิดตามเวลาไทย · ออเดอร์ที่ยกเลิก/ตีกลับไม่นับเป็นยอดขาย ·
        &quot;แชทใหม่&quot; นับจากลูกค้าที่ทักครั้งแรกในช่วงนั้น ไม่ใช่จำนวนห้องแชทที่ขยับ
      </p>
    </div>
  );
}

function Stat({
  label, value, hint, big,
}: { label: string; value: string; hint?: string; big?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 font-semibold', big ? 'text-2xl' : 'text-xl')}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function SimpleTable({
  title, rows, unit,
}: {
  title: string;
  unit?: string;
  rows: Array<{ label: string; sales: number | null; count: number }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">ยังไม่มีข้อมูล</p>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {rows.slice(0, 8).map((r) => (
              <li key={r.label} className="flex items-baseline justify-between gap-2">
                <span className="truncate">{r.label}</span>
                <span className="shrink-0 font-medium">
                  {r.sales !== null
                    ? `฿${r.sales.toLocaleString('th-TH')}`
                    : `${r.count} ${unit ?? ''}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
