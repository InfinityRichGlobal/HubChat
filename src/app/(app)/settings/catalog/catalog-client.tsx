'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Loader2, Package, Plus, Tag, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { Product, PromotionRow } from '@/server/orders/service';
import type { ShippingMethod } from '@/server/orders/shipping';
import type { PromotionType } from '@/types/db';

/**
 * สินค้า + โปรโมชัน (ฝั่งหน้าเว็บ) — สเปกหัวข้อ 4
 * ⭐ สินค้าแต่ละสีมี swatch ให้จิ้ม ไม่ใช่แค่ตัวหนังสือ
 */

const PROMO_LABEL: Record<PromotionType, string> = {
  single: '1 ชิ้น',
  bundle: 'แพ็ก (ราคาเหมา)',
  buy_x_get_y: 'ซื้อ X แถม Y',
  boxset: 'Boxset ครบทุกสี',
};

const baht = (n: number) => `฿${Number(n).toLocaleString('th-TH')}`;

export default function CatalogClient({
  canManage,
  initialProducts,
  initialPromotions,
  initialShipping,
}: {
  canManage: boolean;
  initialProducts: Product[];
  initialPromotions: PromotionRow[];
  initialShipping: ShippingMethod[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [productOpen, setProductOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<PromotionRow | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [editingShip, setEditingShip] = useState<ShippingMethod | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(url: string, init: RequestInit, successMsg?: string) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message_th ?? 'ทำรายการไม่สำเร็จ');
        return null;
      }
      if (successMsg) toast.success(successMsg);
      startTransition(() => router.refresh());
      return json.data;
    } catch (err) {
      console.error('[catalog] ทำรายการไม่สำเร็จ:', err);
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
      return null;
    }
  }

  async function submitProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      name: String(f.get('name') ?? '').trim(),
      variant: String(f.get('variant') ?? '').trim() || null,
      price: Number(f.get('price') ?? 0),
      image_url: String(f.get('image_url') ?? '').trim() || null,
      sort_order: Number(f.get('sort_order') ?? 0),
    };
    setBusy(true);
    try {
      const result = editing
        ? await call(`/api/products/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) }, 'บันทึกแล้ว')
        : await call('/api/products', { method: 'POST', body: JSON.stringify(payload) }, 'เพิ่มสินค้าแล้ว');
      if (result) {
        setProductOpen(false);
        setEditing(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitPromo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const type = String(f.get('type') ?? 'bundle') as PromotionType;
    const priceRaw = String(f.get('price') ?? '').trim();

    const payload = {
      name: String(f.get('name') ?? '').trim(),
      type,
      config: {
        pick: Number(f.get('pick') ?? 1) || 1,
        ...(type === 'buy_x_get_y' ? { pay: Number(f.get('pay') ?? 1) || 1 } : {}),
      },
      price: priceRaw === '' ? null : Number(priceRaw),
    };

    setBusy(true);
    try {
      const result = editingPromo
        ? await call(`/api/promotions/${editingPromo.id}`, { method: 'PATCH', body: JSON.stringify(payload) }, 'บันทึกโปรแล้ว')
        : await call('/api/promotions', { method: 'POST', body: JSON.stringify(payload) }, 'เพิ่มโปรแล้ว');
      if (result) { setPromoOpen(false); setEditingPromo(null); }
    } finally {
      setBusy(false);
    }
  }

  /**
   * เก็บเข้ากรุแทนการลบ
   * 🔴 ลบสินค้าที่เคยขายไปแล้วไม่ได้ — ออเดอร์เก่าจะตามรอยกลับมาไม่ได้
   *    และรายงานยอดขายย้อนหลังจะเพี้ยน
   */
  async function archive(kind: 'products' | 'promotions' | 'shipping-methods', id: string, label: string) {
    if (!confirm(`เก็บ "${label}" เข้ากรุ?\n\nจะหายจากทุกจุดที่เลือกใช้ แต่ออเดอร์เก่าที่เคยใช้ยังอยู่ครบ`)) return;
    await call(`/api/${kind}/${id}`, { method: 'PATCH', body: JSON.stringify({ archive: true }) }, 'เก็บเข้ากรุแล้ว');
  }

  async function submitShipping(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      name: String(f.get('name') ?? '').trim(),
      fee: Number(f.get('fee') ?? 0),
      cod_supported: f.get('cod_supported') === 'on',
      note: String(f.get('note') ?? '').trim() || null,
      sort_order: Number(f.get('sort_order') ?? 0),
    };
    setBusy(true);
    try {
      const result = editingShip
        ? await call(`/api/shipping-methods/${editingShip.id}`, { method: 'PATCH', body: JSON.stringify(payload) }, 'บันทึกแล้ว')
        : await call('/api/shipping-methods', { method: 'POST', body: JSON.stringify(payload) }, 'เพิ่มวิธีจัดส่งแล้ว');
      if (result) {
        setShipOpen(false);
        setEditingShip(null);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* ------------------ สินค้า ------------------ */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="size-4" />
                สินค้า
              </CardTitle>
              <CardDescription>ใส่สีลิปสติกทีละสี — ใส่รหัสสีไว้ด้วยจะจิ้มเลือกง่ายตอนสร้างออเดอร์</CardDescription>
            </div>
            {canManage && (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setProductOpen(true);
                }}
              >
                <Plus />
                เพิ่มสินค้า
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {initialProducts.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              ยังไม่มีสินค้า — เพิ่มสีลิปสติกก่อนถึงจะสร้างออเดอร์ได้
            </p>
          )}

          {initialProducts.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 rounded-md border p-2.5">
              <span
                className="size-8 shrink-0 rounded-full border"
                style={{ backgroundColor: p.image_url ?? '#e5e7eb' }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{p.variant || p.name}</span>
                  {!p.is_active && <Badge variant="destructive" className="text-[10px]">ปิดขาย</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.name} · {baht(p.price)}
                </div>
              </div>

              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={p.is_active}
                    aria-label="เปิดขาย"
                    onCheckedChange={(v) =>
                      call(
                        `/api/products/${p.id}`,
                        { method: 'PATCH', body: JSON.stringify({ is_active: v }) },
                        v ? 'เปิดขายแล้ว' : 'ปิดขายแล้ว',
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(p);
                      setProductOpen(true);
                    }}
                  >
                    แก้
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="เก็บเข้ากรุ"
                    onClick={() => void archive('products', p.id, p.variant || p.name)}
                  >
                    <Archive />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ------------------ โปรโมชัน ------------------ */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Tag className="size-4" />
                แพ็กเกจ / โปรโมชัน
              </CardTitle>
              <CardDescription>ตอนสร้างออเดอร์ ระบบจะรู้เองว่าโปรนี้ต้องเลือกกี่สี</CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => { setEditingPromo(null); setPromoOpen(true); }}>
                <Plus />
                เพิ่มโปร
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {initialPromotions.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">ยังไม่มีโปรโมชัน</p>
          )}

          {initialPromotions.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-md border p-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{p.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{PROMO_LABEL[p.type]}</Badge>
                  {!p.is_active && <Badge variant="destructive" className="text-[10px]">ปิด</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  เลือก {p.config.pick ?? 1} ชิ้น
                  {p.type === 'buy_x_get_y' && p.config.pay ? ` · จ่าย ${p.config.pay} ชิ้น` : ''}
                  {p.price ? ` · ราคาเหมา ${baht(p.price)}` : ' · คิดตามรายชิ้น'}
                </div>
              </div>

              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={p.is_active}
                  aria-label="เปิดใช้"
                  onCheckedChange={(v) =>
                    call(
                      `/api/promotions/${p.id}`,
                      { method: 'PATCH', body: JSON.stringify({ is_active: v }) },
                      v ? 'เปิดใช้แล้ว' : 'ปิดแล้ว',
                    )
                  }
                />
                <Button variant="ghost" size="sm" onClick={() => { setEditingPromo(p); setPromoOpen(true); }}>
                  แก้
                </Button>
                <Button variant="ghost" size="sm" aria-label="เก็บเข้ากรุ"
                  onClick={() => void archive('promotions', p.id, p.name)}>
                  <Archive />
                </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>


      {/* ------------------ วิธีจัดส่ง (รอบ 6) ------------------ */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Truck className="size-4" />
                วิธีจัดส่ง
              </CardTitle>
              <CardDescription>
                ค่าส่งกับ &quot;รับเก็บเงินปลายทางได้ไหม&quot; ถูกบังคับฝั่งเซิร์ฟเวอร์ —
                ออเดอร์ที่เลือกคู่ที่เป็นไปไม่ได้จะถูกปฏิเสธ
              </CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => { setEditingShip(null); setShipOpen(true); }}>
                <Plus />
                เพิ่มวิธีจัดส่ง
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {initialShipping.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              ยังไม่มีวิธีจัดส่ง — เพิ่มก่อนถึงจะเลือกได้ตอนสร้างออเดอร์
            </p>
          )}

          {initialShipping.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-md border p-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{m.name}</span>
                  <Badge variant={m.cod_supported ? 'secondary' : 'outline'} className="text-[10px]">
                    {m.cod_supported ? 'เก็บปลายทางได้' : 'โอนอย่างเดียว'}
                  </Badge>
                  {!m.is_active && <Badge variant="destructive" className="text-[10px]">ปิด</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  ค่าส่ง {baht(m.fee)}
                  {m.note ? ` · ${m.note}` : ''}
                </div>
              </div>

              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={m.is_active}
                    aria-label="เปิดใช้"
                    onCheckedChange={(v) =>
                      call(
                        `/api/shipping-methods/${m.id}`,
                        { method: 'PATCH', body: JSON.stringify({ is_active: v }) },
                        v ? 'เปิดใช้แล้ว' : 'ปิดแล้ว',
                      )
                    }
                  />
                  <Button variant="ghost" size="sm"
                    onClick={() => { setEditingShip(m); setShipOpen(true); }}>
                    แก้
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="เก็บเข้ากรุ"
                    onClick={() => void archive('shipping-methods', m.id, m.name)}>
                    <Archive />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ------------------ กล่องสินค้า ------------------ */}
      <Dialog open={productOpen} onOpenChange={(v) => { setProductOpen(v); if (!v) setEditing(null); }}>
        <DialogContent>
          <form onSubmit={submitProduct}>
            <DialogHeader>
              <DialogTitle>{editing ? 'แก้สินค้า' : 'เพิ่มสินค้า'}</DialogTitle>
              <DialogDescription>ใส่ทีละสี เพื่อให้จิ้มเลือกได้ตอนสร้างออเดอร์</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">ชื่อสินค้า</Label>
                <Input id="name" name="name" required defaultValue={editing?.name ?? 'ลิปสติก'} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="variant">สี / รุ่น</Label>
                <Input id="variant" name="variant" defaultValue={editing?.variant ?? ''} placeholder="แดงอิฐ" />
              </div>
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="price">ราคา (บาท)</Label>
                  <Input id="price" name="price" type="number" min={0} step="1" required defaultValue={editing?.price ?? 290} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="image_url">สี swatch</Label>
                  <Input
                    id="image_url"
                    name="image_url"
                    type="color"
                    defaultValue={editing?.image_url ?? '#c0392b'}
                    className="h-11 w-20 p-1"
                  />
                </div>
                <div className="flex w-20 flex-col gap-1.5">
                  <Label htmlFor="sort_order">ลำดับ</Label>
                  <Input id="sort_order" name="sort_order" type="number" defaultValue={editing?.sort_order ?? 0} />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProductOpen(false)}>ยกเลิก</Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                บันทึก
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ------------------ กล่องโปร ------------------ */}
      <Dialog open={promoOpen} onOpenChange={(open) => { setPromoOpen(open); if (!open) setEditingPromo(null); }}>
        <DialogContent>
          <form key={editingPromo?.id ?? 'new'} onSubmit={submitPromo}>
            <DialogHeader>
              <DialogTitle>{editingPromo ? 'แก้โปรโมชัน' : 'เพิ่มโปรโมชัน'}</DialogTitle>
              <DialogDescription>
                เว้นช่อง &quot;ราคาเหมา&quot; ไว้ = คิดตามราคารายชิ้น
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="promo_name">ชื่อโปร</Label>
                <Input id="promo_name" name="name" required defaultValue={editingPromo?.name ?? ''} placeholder="โปร 2 ชิ้น" />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="promo_type">แบบ</Label>
                <Select name="type" defaultValue={editingPromo?.type ?? 'bundle'}>
                  <SelectTrigger id="promo_type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROMO_LABEL) as PromotionType[]).map((t) => (
                      <SelectItem key={t} value={t}>{PROMO_LABEL[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="pick">เลือกกี่ชิ้น</Label>
                  <Input id="pick" name="pick" type="number" min={1} defaultValue={editingPromo?.config.pick ?? 2} required />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="pay">จ่ายกี่ชิ้น</Label>
                  <Input id="pay" name="pay" type="number" min={1} defaultValue={editingPromo?.config.pay ?? 2} />
                  <p className="text-[10px] text-muted-foreground">ใช้เฉพาะแบบ &quot;ซื้อ X แถม Y&quot;</p>
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="promo_price">ราคาเหมา</Label>
                  <Input id="promo_price" name="price" type="number" min={0} defaultValue={editingPromo?.price ?? ''} placeholder="เว้นว่างได้" />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPromoOpen(false)}>ยกเลิก</Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                บันทึก
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ------------------ กล่องวิธีจัดส่ง ------------------ */}
      <Dialog open={shipOpen} onOpenChange={(v) => { setShipOpen(v); if (!v) setEditingShip(null); }}>
        <DialogContent>
          <form onSubmit={submitShipping}>
            <DialogHeader>
              <DialogTitle>{editingShip ? 'แก้วิธีจัดส่ง' : 'เพิ่มวิธีจัดส่ง'}</DialogTitle>
              <DialogDescription>
                แก้ค่าส่งที่นี่ไม่กระทบออเดอร์เก่า — ออเดอร์เก็บสำเนาค่าส่งไว้ตั้งแต่ตอนสร้าง
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-3">
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="s-name">ชื่อวิธีจัดส่ง</Label>
                  <Input id="s-name" name="name" required maxLength={80}
                    defaultValue={editingShip?.name ?? ''} placeholder="Flash ส่งธรรมดา" />
                </div>
                <div className="flex w-28 flex-col gap-1.5">
                  <Label htmlFor="s-fee">ค่าส่ง</Label>
                  <Input id="s-fee" name="fee" type="number" min={0} step="0.01"
                    defaultValue={editingShip?.fee ?? 0} />
                </div>
              </div>

              <label className="flex items-start gap-2 rounded-md border p-2.5">
                <input
                  type="checkbox"
                  name="cod_supported"
                  defaultChecked={editingShip?.cod_supported ?? true}
                  className="mt-0.5 size-4"
                />
                <span className="text-sm">
                  รับเก็บเงินปลายทาง (COD)
                  <span className="block text-xs text-muted-foreground">
                    ถ้าไม่ติ๊ก ระบบจะไม่ยอมให้สร้างออเดอร์แบบเก็บปลายทางด้วยวิธีนี้
                  </span>
                </span>
              </label>

              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="s-note">หมายเหตุ</Label>
                  <Input id="s-note" name="note" maxLength={300}
                    defaultValue={editingShip?.note ?? ''} placeholder="ส่งถึงใน 2-3 วัน" />
                </div>
                <div className="flex w-24 flex-col gap-1.5">
                  <Label htmlFor="s-sort">ลำดับ</Label>
                  <Input id="s-sort" name="sort_order" type="number"
                    defaultValue={editingShip?.sort_order ?? 0} />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                บันทึก
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
