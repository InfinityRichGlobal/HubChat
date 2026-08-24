'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardCopy, Loader2, MessageSquare, PackageSearch, Receipt, Search, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { OrderRow, OrderLog } from '@/server/orders/service';
import type { OrderStatus, PaymentStatus } from '@/types/db';

/**
 * หน้าออเดอร์ (ฝั่งหน้าเว็บ) — สเปกหัวข้อ 5.3
 * ลิสต์ + กรอง / รายละเอียดแก้ได้ / ปุ่มไปแชทต้นทาง / ปุ่มคัดลอกที่อยู่
 */

const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'ร่าง',
  confirmed: 'ยืนยันแล้ว',
  paid: 'จ่ายแล้ว',
  packed: 'แพ็กแล้ว',
  shipped: 'ส่งแล้ว',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
  returned: 'ตีกลับ',
};

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  unpaid: 'ยังไม่จ่าย',
  deposit: 'มัดจำ',
  paid: 'จ่ายครบ',
};

const baht = (n: number) => `฿${Number(n).toLocaleString('th-TH')}`;

function dayTh(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* ตกไปใช้ทางสำรอง */
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

type PageInfo = { id: string; display_name: string | null; page_name: string; tag_color: string };

/* ================================================================== */

export default function OrdersClient({
  canEdit,
  initialOrders,
  pages,
}: {
  canEdit: boolean;
  initialOrders: OrderRow[];
  pages: PageInfo[];
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [payment, setPayment] = useState<string>('all');
  const [pageId, setPageId] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const pageById = new Map(pages.map((p) => [p.id, p]));

  const fetchOrders = useCallback(async (): Promise<OrderRow[] | null> => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (status !== 'all') params.set('status', status);
    if (payment !== 'all') params.set('payment_status', payment);
    if (pageId !== 'all') params.set('page_id', pageId);
    try {
      const res = await fetch(`/api/orders?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      return json.ok ? (json.data.orders as OrderRow[]) : null;
    } catch {
      return null;
    }
  }, [search, status, payment, pageId]);

  const reload = useCallback(async () => {
    const rows = await fetchOrders();
    if (rows) setOrders(rows);
  }, [fetchOrders]);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void fetchOrders().then((rows) => {
        if (alive && rows) setOrders(rows);
      });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [fetchOrders]);

  const totalSales = orders
    .filter((o) => o.status !== 'cancelled' && o.status !== 'returned')
    .reduce((s, o) => s + Number(o.total), 0);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">ออเดอร์</h1>
          <p className="text-sm text-muted-foreground">
            {orders.length} รายการ · รวม {baht(totalSales)} (ไม่นับที่ยกเลิก/ตีกลับ)
          </p>
        </div>
      </div>

      {/* ---------- ตัวกรอง ---------- */}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="เลขออเดอร์ / ชื่อ / เบอร์ / เลขพัสดุ"
            className="pl-8"
          />
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกสถานะ</SelectItem>
            {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={payment} onValueChange={setPayment}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกการจ่ายเงิน</SelectItem>
            {(Object.keys(PAYMENT_LABEL) as PaymentStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{PAYMENT_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {pages.length > 1 && (
          <Select value={pageId} onValueChange={setPageId}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกเพจ</SelectItem>
              {pages.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.display_name || p.page_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* ---------- ลิสต์ ---------- */}
      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border py-12 text-center">
          <PackageSearch className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">ยังไม่มีออเดอร์</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            สร้างออเดอร์ได้จากปุ่มในห้องแชท — ระบบจะดึงที่อยู่ของลูกค้ามาให้อัตโนมัติ
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map((o) => {
            const page = o.page_id ? pageById.get(o.page_id) : undefined;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setOpenId(o.id)}
                className="flex items-start gap-3 rounded-lg border p-3 text-left hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-sm font-medium">{o.order_no}</span>
                    <Badge variant={o.status === 'cancelled' ? 'destructive' : 'secondary'} className="text-[10px]">
                      {STATUS_LABEL[o.status]}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{PAYMENT_LABEL[o.payment_status]}</Badge>
                    {page && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: page.tag_color }} />
                        {page.display_name || page.page_name}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-sm">
                    {o.recipient_name || '(ยังไม่ระบุชื่อผู้รับ)'} {o.phone ? `· ${o.phone}` : ''}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {o.items.map((i) => `${i.variant || i.name}×${i.qty}`).join(', ') || '—'}
                  </div>
                  {(o.shipping_snapshot?.name || o.tracking_no) && (
                    <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                      <Truck className="size-3 shrink-0" />
                      {o.shipping_snapshot?.name ?? o.shipping_carrier ?? '—'}
                      {o.payment_method === 'cod' ? ' · เก็บปลายทาง' : ''}
                      {o.tracking_no ? ` · ${o.tracking_no}` : ''}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold">{baht(o.total)}</div>
                  <div className="text-[11px] text-muted-foreground">{dayTh(o.created_at)}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/*
        key = ให้ React สร้าง dialog ใหม่ทุกครั้งที่เปลี่ยนออเดอร์
        ไม่งั้นจะค้างข้อมูลของออเดอร์ก่อนหน้าไว้ (loading เป็น false ไปแล้ว)
      */}
      <OrderDetailDialog
        key={openId ?? 'closed'}
        orderId={openId}
        canEdit={canEdit}
        onClose={() => setOpenId(null)}
        onSaved={reload}
      />
    </div>
  );
}

/* ================================================================== */

function OrderDetailDialog({
  orderId,
  canEdit,
  onClose,
  onSaved,
}: {
  orderId: string | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [logs, setLogs] = useState<OrderLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingSlip, setUploadingSlip] = useState(false);
  const slipRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!orderId) return;
    let alive = true;

    void fetch(`/api/orders/${orderId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        if (json.ok) {
          setOrder(json.data.order as OrderRow);
          setLogs(json.data.logs as OrderLog[]);
        } else {
          toast.error(json?.error?.message_th ?? 'เปิดออเดอร์ไม่สำเร็จ');
        }
      })
      .catch((err) => {
        console.error('[orders] เปิดออเดอร์ไม่สำเร็จ:', err);
        toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [orderId]);

  async function patch(body: Record<string, unknown>, msg: string) {
    if (!orderId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message_th ?? 'บันทึกไม่สำเร็จ');
        return;
      }
      setOrder(json.data.order as OrderRow);
      toast.success(msg);
      onSaved();
      startTransition(() => router.refresh());
    } catch (err) {
      console.error('[orders] บันทึกไม่สำเร็จ:', err);
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setSaving(false);
    }
  }

  /**
   * อัปโหลดสลิปโอนเงิน (D-17)
   * 🔴 สลิปคือหลักฐานการชำระเงิน — เก็บไว้เองอย่างถาวร ไม่ใช่ลิงก์ชั่วคราว
   */
  async function uploadSlip(file: File | null) {
    if (!file || !orderId || uploadingSlip) return;
    setUploadingSlip(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/orders/${orderId}/slip`, { method: 'POST', body });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message_th ?? 'อัปโหลดสลิปไม่สำเร็จ');
        return;
      }
      setOrder(json.data.order as OrderRow);
      toast.success('เก็บสลิปแล้ว');
      onSaved();
    } catch (err) {
      console.error('[orders] อัปโหลดสลิปไม่สำเร็จ:', err);
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setUploadingSlip(false);
      if (slipRef.current) slipRef.current.value = '';
    }
  }

  /** ปุ่มลัดตามสเปก 5.3 : คัดลอกที่อยู่ไปแปะระบบขนส่งข้างนอก */
  async function copyAddress() {
    if (!order) return;
    const text = [order.recipient_name, order.phone, order.address, order.postcode]
      .filter(Boolean)
      .join('\n');
    const ok = await copyText(text);
    toast[ok ? 'success' : 'error'](ok ? 'คัดลอกที่อยู่แล้ว' : 'คัดลอกไม่สำเร็จ');
  }

  return (
    <Dialog open={orderId !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        {loading || !order ? (
          <div className="flex flex-col gap-3 py-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono">{order.order_no}</DialogTitle>
              <DialogDescription>
                สร้างเมื่อ {dayTh(order.created_at)} · {baht(order.total)}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-2">
              {/* ---- รายการสินค้า ---- */}
              <div className="rounded-md border p-2.5">
                {order.items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">ไม่มีรายการสินค้า</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {order.items.map((i, idx) => (
                      <li key={idx} className="flex justify-between gap-2">
                        <span className="truncate">
                          {i.variant || i.name} × {i.qty}
                        </span>
                        <span className="shrink-0 text-muted-foreground">{baht(i.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex flex-col gap-0.5 border-t pt-2 text-xs text-muted-foreground">
                  <div className="flex justify-between"><span>ยอดสินค้า</span><span>{baht(order.subtotal)}</span></div>
                  {order.discount > 0 && (
                    <div className="flex justify-between"><span>ส่วนลด</span><span>-{baht(order.discount)}</span></div>
                  )}
                  {order.shipping_fee > 0 && (
                    <div className="flex justify-between"><span>ค่าส่ง</span><span>{baht(order.shipping_fee)}</span></div>
                  )}
                  <div className="flex justify-between text-sm font-semibold text-foreground">
                    <span>รวม</span><span>{baht(order.total)}</span>
                  </div>
                </div>
              </div>

              {/* ---- ที่อยู่ ---- */}
              <div className="rounded-md border p-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{order.recipient_name || '(ยังไม่ระบุชื่อ)'}</div>
                    <div className="text-xs text-muted-foreground">{order.phone || '(ไม่มีเบอร์)'}</div>
                    <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                      {order.address || '(ยังไม่มีที่อยู่)'}
                      {order.postcode ? ` ${order.postcode}` : ''}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void copyAddress()} className="shrink-0">
                    <ClipboardCopy />
                    คัดลอก
                  </Button>
                </div>
              </div>

              {/* ---- สลิปโอนเงิน (D-17) ---- */}
              <div className="rounded-md border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Receipt className="size-4" />
                    สลิปโอนเงิน
                  </div>
                  {canEdit && (
                    <>
                      <input
                        ref={slipRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={(e) => void uploadSlip(e.target.files?.[0] ?? null)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={uploadingSlip}
                        onClick={() => slipRef.current?.click()}
                      >
                        {uploadingSlip && <Loader2 className="animate-spin" />}
                        {order.slip_media_id ? 'เปลี่ยนสลิป' : 'แนบสลิป'}
                      </Button>
                    </>
                  )}
                </div>

                {order.slip_media_id ? (
                  <a
                    href={`/api/media/${order.slip_media_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/media/${order.slip_media_id}`}
                      alt="สลิปโอนเงิน"
                      className="max-h-48 rounded border object-contain"
                      onError={(e) => {
                        const el = e.currentTarget;
                        el.style.display = 'none';
                        const note = el.parentElement?.nextElementSibling as HTMLElement | null;
                        if (note) note.style.display = 'block';
                      }}
                    />
                  </a>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    ยังไม่มีสลิป — แนบไว้เพื่อใช้เป็นหลักฐานย้อนหลังได้ตลอด
                  </p>
                )}
                <p style={{ display: 'none' }} className="mt-1 text-xs text-muted-foreground">
                  เปิดสลิปไม่ได้ — กดที่รูปเพื่อเปิดในแท็บใหม่
                </p>
              </div>

              {/* ---- สถานะ ---- */}
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <div className="flex min-w-36 flex-1 flex-col gap-1.5">
                    <Label className="text-xs">สถานะออเดอร์</Label>
                    <Select
                      value={order.status}
                      onValueChange={(v) => void patch({ status: v }, 'เปลี่ยนสถานะแล้ว')}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
                          <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex min-w-36 flex-1 flex-col gap-1.5">
                    <Label className="text-xs">การจ่ายเงิน</Label>
                    <Select
                      value={order.payment_status}
                      onValueChange={(v) => void patch({ payment_status: v }, 'อัปเดตการจ่ายเงินแล้ว')}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PAYMENT_LABEL) as PaymentStatus[]).map((s) => (
                          <SelectItem key={s} value={s}>{PAYMENT_LABEL[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* ---- เลขพัสดุ ---- */}
              {canEdit && (
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void patch(
                      {
                        shipping_carrier: String(f.get('carrier') ?? '').trim() || null,
                        tracking_no: String(f.get('tracking') ?? '').trim() || null,
                      },
                      'บันทึกเลขพัสดุแล้ว',
                    );
                  }}
                >
                  <div className="flex w-28 flex-col gap-1.5">
                    <Label htmlFor="carrier" className="text-xs">ขนส่ง</Label>
                    <Input id="carrier" name="carrier" defaultValue={order.shipping_carrier ?? ''} placeholder="Flash" />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="tracking" className="text-xs">เลขพัสดุ</Label>
                    <Input id="tracking" name="tracking" defaultValue={order.tracking_no ?? ''} />
                  </div>
                  <Button type="submit" variant="outline" disabled={saving}>
                    {saving && <Loader2 className="animate-spin" />}
                    บันทึก
                  </Button>
                </form>
              )}

              <p className="text-[11px] text-muted-foreground">
                ⚠️ การแจ้งเลขพัสดุให้ลูกค้าอัตโนมัติยังไม่เปิดใช้ — เป็นงานของรอบถัดไป
                และจะส่งผ่าน Message Policy Engine เท่านั้น
              </p>

              {/* ---- ประวัติแก้ไข ---- */}
              {logs.length > 0 && (
                <details className="rounded-md border p-2.5">
                  <summary className="cursor-pointer text-xs font-medium">ประวัติแก้ไข ({logs.length})</summary>
                  <ul className="mt-2 flex flex-col gap-1 text-[11px] text-muted-foreground">
                    {logs.map((l) => (
                      <li key={l.id} className="flex justify-between gap-2">
                        <span>{l.action === 'created' ? 'สร้างออเดอร์' : 'แก้ไข'} · {l.admin_name ?? 'ระบบ'}</span>
                        <span className="shrink-0">{new Date(l.created_at).toLocaleString('th-TH', { hour12: false })}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            <DialogFooter className={cn('flex-row justify-between gap-2 sm:justify-between')}>
              {order.conversation_id ? (
                <Button variant="outline" asChild>
                  <Link href={`/inbox?c=${order.conversation_id}`}>
                    <MessageSquare />
                    ไปที่แชท
                  </Link>
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={onClose}>ปิด</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
