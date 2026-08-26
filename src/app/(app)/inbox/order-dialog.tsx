'use client';

/**
 * กล่องสร้างออเดอร์จากในห้องแชท — สเปกหัวข้อ 4 + 5.3
 * ===========================================================================
 * ขั้นตอนตามสเปก : เลือกโปร → จิ้มสี → ราคาขึ้นเอง → ตรวจที่อยู่ → กดสร้าง
 *
 * 🔴 กฎเหล็กของไฟล์นี้ : ห้ามคูณเลขราคาในเบราว์เซอร์เด็ดขาด
 *    ราคาทุกตัวที่เห็นบนจอมาจาก /api/orders/preview ซึ่งเรียก calculateOrder()
 *    ตัวเดียวกับตอนบันทึกจริง — จอกับฐานข้อมูลจึงเป็นเลขเดียวกันเสมอ
 *
 * ⭐ ที่อยู่ที่เติมให้เป็นแค่ "ตัวช่วยกรอก" แอดมินแก้ได้ทุกช่องก่อนกดสร้าง
 *    และการแก้ตรงนี้ไม่ไปแตะข้อมูลลูกค้าในระบบ (สเปก 5.2)
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, ShoppingCart, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { Product, PromotionRow } from '@/server/orders/service';
import type { ShippingMethod } from '@/server/orders/shipping';
import type { PriceBreakdown } from '@/server/orders/pricing';
import type { PaymentMethod } from '@/types/db';

type Contact = {
  recipient_name: string | null;
  phone: string | null;
  address: string | null;
  postcode: string | null;
};

/** จำนวนชิ้นที่โปรบังคับ — ใช้แค่บอกแอดมินว่าเหลืออีกกี่ชิ้น ไม่ใช่ตัวคิดเงิน */
function pickTarget(p: PromotionRow | null): number | null {
  if (!p) return null;
  if (p.type === 'single') return 1;
  const n = p.config?.pick ?? 0;
  return n > 0 ? n : null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    return json.ok ? (json.data as T) : null;
  } catch {
    return null;
  }
}

export default function OrderDialog({
  conversationId,
  onClose,
  onCreated,
  sourceText,
  sourceMessageId,
}: {
  /** null = ปิดอยู่ */
  conversationId: string | null;
  onClose: () => void;
  onCreated: () => void;
  sourceText?: string | null;
  sourceMessageId?: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [shipping, setShipping] = useState<ShippingMethod[]>([]);

  const [promotionId, setPromotionId] = useState<string | null>(null);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [shippingMethodId, setShippingMethodId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [manualTotal, setManualTotal] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [form, setForm] = useState<Contact>({
    recipient_name: '', phone: '', address: '', postcode: '',
  });

  const [price, setPrice] = useState<PriceBreakdown | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [pricing, setPricing] = useState(false);
  const [saving, setSaving] = useState(false);

  /* ---- โหลดสินค้า / โปร / ที่อยู่ พร้อมกันตอนเปิด ---- */
  useEffect(() => {
    if (!conversationId) return;
    let alive = true;

    void Promise.all([
      getJson<{ products: Product[] }>('/api/products?active=1'),
      getJson<{ promotions: PromotionRow[] }>('/api/promotions?active=1'),
      getJson<{ current: Contact; extracted?: Contact }>(`/api/conversations/${conversationId}/contact${sourceText ? `?from=${encodeURIComponent(sourceText)}` : ''}`),
      getJson<{ methods: ShippingMethod[] }>('/api/shipping-methods?active=1'),
    ]).then(([p, promo, contact, ship]) => {
      if (!alive) return;
      setProducts(p?.products ?? []);
      setPromotions(promo?.promotions ?? []);
      const methods = ship?.methods ?? [];
      setShipping(methods);
      // เลือกวิธีจัดส่งอันแรกให้เลย — แอดมินเปลี่ยนได้ แต่ไม่ต้องเริ่มจากศูนย์
      if (methods.length > 0) setShippingMethodId(methods[0].id);
      if (contact?.current || contact?.extracted) {
        const seed: Partial<Contact> = contact.extracted ?? {};
        setForm({
          recipient_name: seed.recipient_name ?? contact.current?.recipient_name ?? '',
          phone: seed.phone ?? contact.current?.phone ?? '',
          address: seed.address ?? contact.current?.address ?? '',
          postcode: seed.postcode ?? contact.current?.postcode ?? '',
        });
      }
      setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, [conversationId, sourceText]);

  /* ---- ขอราคาจากเซิร์ฟเวอร์ทุกครั้งที่การเลือกเปลี่ยน ---- */
  const fetchPrice = useCallback(async (): Promise<
    { ok: true; price: PriceBreakdown } | { ok: false; message: string } | null
  > => {
    if (pickedIds.length === 0) return null;
    const body = {
      promotion_id: promotionId,
      product_ids: pickedIds,
      // ⭐ ส่ง "วิธีจัดส่ง" ไม่ใช่ "ค่าส่ง" — เซิร์ฟเวอร์เป็นคนหยิบราคามาเอง
      shipping_method_id: shippingMethodId,
      payment_method: paymentMethod,
      manual_total: manualTotal.trim() === '' ? null : Number(manualTotal),
    };
    try {
      const res = await fetch('/api/orders/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) return { ok: true, price: json.data.price as PriceBreakdown };
      return { ok: false, message: json?.error?.message_th ?? 'คิดราคาไม่ได้' };
    } catch {
      return { ok: false, message: 'ติดต่อเซิร์ฟเวอร์ไม่ได้' };
    }
  }, [promotionId, pickedIds, shippingMethodId, paymentMethod, manualTotal]);

  useEffect(() => {
    let alive = true;
    // ⚠️ ตั้ง state ตอนหน่วงครบแล้วเท่านั้น
    //    ถ้าตั้งตรง ๆ ในตัว effect React จะเรนเดอร์ซ้อนกันเป็นทอด ๆ
    //    (ผลพลอยได้ : ตัวหมุน "กำลังคิดราคา" ไม่กะพริบตอนพิมพ์เร็ว ๆ)
    const timer = setTimeout(() => {
      if (!alive) return;
      setPricing(true);
      void fetchPrice().then((r) => {
        if (!alive) return;
        setPricing(false);
        if (r === null) {
          setPrice(null);
          setPriceError(null);
        } else if (r.ok) {
          setPrice(r.price);
          setPriceError(null);
        } else {
          setPrice(null);
          setPriceError(r.message);
        }
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [fetchPrice]);

  const promotion = promotions.find((p) => p.id === promotionId) ?? null;
  const target = pickTarget(promotion);
  const remaining = target === null ? null : target - pickedIds.length;

  function addProduct(id: string) {
    setPickedIds((prev) => [...prev, id]);
  }

  function removeAt(index: number) {
    setPickedIds((prev) => prev.filter((_, i) => i !== index));
  }

  async function create() {
    if (!conversationId || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          source_message_id: sourceMessageId ?? null,
          promotion_id: promotionId,
          product_ids: pickedIds,
          recipient_name: form.recipient_name?.trim() || null,
          phone: form.phone?.trim() || null,
          address: form.address?.trim() || null,
          postcode: form.postcode?.trim() || null,
          shipping_method_id: shippingMethodId,
          payment_method: paymentMethod,
          manual_total: manualTotal.trim() === '' ? null : Number(manualTotal),
          is_paid: isPaid,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message_th ?? 'สร้างออเดอร์ไม่สำเร็จ');
        return;
      }
      const order = json.data.order as { order_no: string };
      toast.success(`สร้างออเดอร์ ${order.order_no} แล้ว`, {
        description: 'ดูและแก้ไขต่อได้ที่หน้าออเดอร์',
      });
      onCreated();
      onClose();
    } catch (err) {
      // ⚠️ ต้องมีตัวรับ error เสมอ ไม่งั้นกดสร้างแล้วเงียบ
      console.error('[order] สร้างออเดอร์ไม่สำเร็จ:', err);
      toast.error('สร้างออเดอร์ไม่สำเร็จ', {
        description: err instanceof Error ? err.message : 'ติดต่อเซิร์ฟเวอร์ไม่ได้',
      });
    } finally {
      setSaving(false);
    }
  }

  const selectedShipping = shipping.find((m) => m.id === shippingMethodId) ?? null;
  const codBlocked = paymentMethod === 'cod' && selectedShipping !== null && !selectedShipping.cod_supported;
  const canCreate = pickedIds.length > 0 && price !== null && !pricing && !saving && !codBlocked;

  return (
    <Dialog open={conversationId !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>สร้างออเดอร์</DialogTitle>
          <DialogDescription>เลือกโปร → จิ้มสี → ตรวจที่อยู่ → กดสร้าง</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col gap-3 py-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : products.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            ยังไม่มีสินค้าในระบบ — ให้เจ้าของร้านเพิ่มที่ ตั้งค่า → สินค้าและโปรโมชัน ก่อน
          </p>
        ) : (
          <div className="flex flex-col gap-3 py-1">
            {/* ---- โปรโมชัน ---- */}
            {promotions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">โปรโมชัน</Label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPromotionId(null)}
                    className={
                      'rounded-full border px-3 py-1 text-xs ' +
                      (promotionId === null ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent')
                    }
                  >
                    ไม่ใช้โปร
                  </button>
                  {promotions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPromotionId(p.id);
                        setPickedIds([]); // เปลี่ยนโปร = เริ่มเลือกใหม่ กันเลือกค้างผิดจำนวน
                      }}
                      className={
                        'rounded-full border px-3 py-1 text-xs ' +
                        (promotionId === p.id ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent')
                      }
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                {remaining !== null && (
                  <p className="text-[11px] text-muted-foreground">
                    {remaining > 0
                      ? `เลือกอีก ${remaining} ชิ้น (โปรนี้ต้องครบ ${target} ชิ้น)`
                      : remaining === 0
                        ? `ครบ ${target} ชิ้นแล้ว`
                        : `เกินมา ${-remaining} ชิ้น — เอาออกก่อน`}
                  </p>
                )}
              </div>
            )}

            {/* ---- จิ้มสี (สเปกข้อ 4 : swatch สี ไม่ใช่แค่ตัวหนังสือ) ---- */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">แตะเพื่อเพิ่มสินค้า</Label>
              <div className="flex flex-wrap gap-1.5">
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProduct(p.id)}
                    title={`${p.name}${p.variant ? ` · ${p.variant}` : ''}`}
                    className="flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-2.5 text-xs hover:bg-accent"
                  >
                    <span
                      className="size-4 rounded-full border"
                      style={{ backgroundColor: p.image_url ?? '#e5e7eb' }}
                    />
                    {p.variant || p.name}
                    <Plus className="size-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>

            {/* ---- ที่เลือกไว้ ---- */}
            {pickedIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 rounded-md border p-2">
                {pickedIds.map((id, index) => {
                  const p = products.find((x) => x.id === id);
                  return (
                    <button
                      key={`${id}-${index}`}
                      type="button"
                      onClick={() => removeAt(index)}
                      className="flex items-center gap-1 rounded-full bg-secondary py-1 pl-1.5 pr-2 text-xs"
                    >
                      <span
                        className="size-3.5 rounded-full border"
                        style={{ backgroundColor: p?.image_url ?? '#e5e7eb' }}
                      />
                      {p?.variant || p?.name || 'สินค้า'}
                      <X className="size-3 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            )}

            {/* ---- วิธีจ่ายเงิน ---- */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">วิธีจ่ายเงิน</Label>
              <div className="flex gap-1.5">
                {(['cod', 'transfer'] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentMethod(m)}
                    className={
                      'flex-1 rounded-md border px-3 py-2 text-xs ' +
                      (paymentMethod === m ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent')
                    }
                  >
                    {m === 'cod' ? 'เก็บเงินปลายทาง' : 'โอนเงิน'}
                  </button>
                ))}
              </div>
            </div>

            {/* ---- วิธีจัดส่ง ---- */}
            {shipping.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">วิธีจัดส่ง</Label>
                <div className="flex flex-wrap gap-1.5">
                  {shipping.map((m) => {
                    // ⚠️ ปิดปุ่มที่เป็นไปไม่ได้ตั้งแต่บนจอ (เซิร์ฟเวอร์กันซ้ำอีกชั้น)
                    const blocked = paymentMethod === 'cod' && !m.cod_supported;
                    const selected = shippingMethodId === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={blocked}
                        title={blocked ? `${m.name} ไม่รองรับเก็บเงินปลายทาง` : undefined}
                        onClick={() => setShippingMethodId(m.id)}
                        className={
                          'rounded-full border px-3 py-1 text-xs ' +
                          (blocked
                            ? 'cursor-not-allowed opacity-40'
                            : selected
                              ? 'border-primary bg-primary/10 font-medium'
                              : 'hover:bg-accent')
                        }
                      >
                        {m.name} · ฿{Number(m.fee).toLocaleString('th-TH')}
                        {blocked ? ' (ไม่รับปลายทาง)' : ''}
                      </button>
                    );
                  })}
                </div>
                {paymentMethod === 'cod' &&
                  shippingMethodId !== null &&
                  shipping.find((m) => m.id === shippingMethodId)?.cod_supported === false && (
                    <p className="text-[11px] text-destructive">
                      วิธีจัดส่งที่เลือกไม่รองรับเก็บเงินปลายทาง — เลือกวิธีอื่น หรือเปลี่ยนเป็นโอนเงิน
                    </p>
                  )}
              </div>
            )}

            {/* ---- ราคากรอกเอง ---- */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual" className="text-xs">ราคารวม (กรอกทับได้)</Label>
              <Input
                id="manual" inputMode="decimal" value={manualTotal} placeholder="อัตโนมัติ"
                onChange={(e) => setManualTotal(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
              <Checkbox id="order-paid" checked={isPaid} onCheckedChange={(value) => setIsPaid(value === true)} />
              <label htmlFor="order-paid" className="text-sm font-medium">ลูกค้าจ่ายเงินแล้ว</label>
            </div>

            {/* ---- ยอดที่เซิร์ฟเวอร์คิดมา ---- */}
            <div className="rounded-md border p-2.5 text-sm">
              {pricing ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> กำลังคิดราคา…
                </div>
              ) : priceError ? (
                <p className="text-xs text-destructive">{priceError}</p>
              ) : price ? (
                <>
                  <ul className="flex flex-col gap-0.5 text-xs">
                    {price.items.map((i, idx) => (
                      <li key={idx} className="flex justify-between gap-2">
                        <span className="truncate">{i.variant || i.name} × {i.qty}</span>
                        <span className="shrink-0 text-muted-foreground">
                          ฿{Number(i.total).toLocaleString('th-TH')}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1.5 flex justify-between border-t pt-1.5 font-semibold">
                    <span>รวมทั้งหมด</span>
                    <span>฿{Number(price.total).toLocaleString('th-TH')}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{price.explain_th}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">เลือกสินค้าก่อน แล้วราคาจะขึ้นเอง</p>
              )}
            </div>

            {/* ---- ที่อยู่ ---- */}
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="o-name" className="text-xs">ชื่อผู้รับ</Label>
                  <Input
                    id="o-name" value={form.recipient_name ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, recipient_name: e.target.value }))}
                  />
                </div>
                <div className="flex w-32 flex-col gap-1.5">
                  <Label htmlFor="o-phone" className="text-xs">เบอร์</Label>
                  <Input
                    id="o-phone" inputMode="tel" value={form.phone ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="o-address" className="text-xs">ที่อยู่</Label>
                <textarea
                  id="o-address" rows={3} value={form.address ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="flex w-32 flex-col gap-1.5">
                <Label htmlFor="o-postcode" className="text-xs">รหัสไปรษณีย์</Label>
                <Input
                  id="o-postcode" inputMode="numeric" value={form.postcode ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, postcode: e.target.value }))}
                />
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              ⚠️ ระบบไม่แจ้งลูกค้าเองตอนสร้างออเดอร์ — ถ้าจะบอกลูกค้า ให้พิมพ์ส่งเองในห้องแชท
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button onClick={() => void create()} disabled={!canCreate}>
            {saving ? <Loader2 className="animate-spin" /> : <ShoppingCart />}
            สร้างออเดอร์
            {price && <Badge variant="secondary">฿{Number(price.total).toLocaleString('th-TH')}</Badge>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
