'use client';
/**
 * เลือกสินค้าแล้ววางลงช่องพิมพ์ (ก้อน 2 ข้อ 1.10)
 * ===========================================================================
 * ⚠️ ตั้งใจ **ไม่** ทำหน้าร้านใหม่ — ใช้แคตตาล็อกที่มีอยู่แล้ว
 *    สิ่งที่แอดมินต้องการตอนคุยกับลูกค้าคือ "พิมพ์ชื่อกับราคาให้ถูก โดยไม่ต้องจำ"
 *    ไม่ใช่ระบบเลือกสินค้าที่สวยแต่กดหลายขั้น
 *
 * 🔴 ราคาที่วางลงช่องพิมพ์มาจาก **เซิร์ฟเวอร์** เท่านั้น
 *    คอมโพเนนต์นี้ส่งไปแค่ id สินค้า ไม่เคยส่งราคากลับไป
 *    (ถ้าเบราว์เซอร์ส่งราคาได้ ก็แก้ราคาแล้วเสนอผิดให้ลูกค้าได้)
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Minus, Plus, Search, Tag } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

type Product = {
  id: string;
  name: string;
  variant: string | null;
  price: number;
  is_active: boolean;
};

type Promotion = { id: string; name: string; is_active: boolean };

export default function ProductPicker({
  conversationId,
  open,
  onClose,
  onInsertText,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
  onInsertText: (text: string) => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [promotionIds, setPromotionIds] = useState<string[]>([]);
  const [showPrice, setShowPrice] = useState(false);

  /**
   * ⚠️ ตั้งค่า state ใน callback ของ promise ไม่ใช่ในตัว effect ตรง ๆ
   *    React ห้าม setState แบบซิงโครนัสในตัว effect เพราะทำให้ render ซ้อนกันหลายรอบ
   *    (บทเรียนเดียวกับหน้าตั้งค่าแจ้งเตือนในรอบ 10)
   */
  useEffect(() => {
    if (!open) return;
    let alive = true;

    void (async () => {
      // เปิดใหม่ = เริ่มจากศูนย์ ไม่ค้างของรอบก่อน
      if (alive) setQuantities({});
      if (alive) setPromotionIds([]);
      if (alive) setShowPrice(false);
      if (alive) setQ('');
      if (alive) setLoading(true);

      try {
        const [productRes, promotionRes] = await Promise.all([
          fetch('/api/products?active=1', { cache: 'no-store' }),
          fetch('/api/promotions?active=1', { cache: 'no-store' }),
        ]);
        const productJson = (await productRes.json()) as { ok: boolean; data?: { products: Product[] } };
        const promotionJson = (await promotionRes.json()) as { ok: boolean; data?: { promotions: Promotion[] } };
        if (alive && productJson.ok) setProducts(productJson.data?.products ?? []);
        if (alive && promotionJson.ok) setPromotions(promotionJson.data?.promotions ?? []);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [open]);

  const term = q.trim().toLowerCase();
  const visible = term
    ? products.filter((p) =>
        `${p.name} ${p.variant ?? ''}`.toLowerCase().includes(term))
    : products;

  function changeQty(id: string, delta: number) {
    setQuantities((prev) => {
      const next = Math.max(0, Math.min(99, (prev[id] ?? 0) + delta));
      const copy = { ...prev };
      if (next === 0) delete copy[id]; else copy[id] = next;
      return copy;
    });
  }

  async function insert() {
    const items = Object.entries(quantities).map(([product_id, qty]) => ({ product_id, qty }));
    if (items.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/compose`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // ⭐ ส่งแค่ id/จำนวน/ตัวเลือกแสดงผล — ราคาให้เซิร์ฟเวอร์เป็นคนหา
        body: JSON.stringify({ kind: 'products', items: items.slice(0, 10), promotion_ids: promotionIds, include_amount: showPrice }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { text: string; ready: boolean; warning_th: string | null };
        error?: { message_th: string };
      };
      if (!json.ok || !json.data?.text) {
        toast.error(json.error?.message_th ?? 'ใส่สินค้าไม่สำเร็จ');
        return;
      }
      onInsertText(json.data.text);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>ใส่สินค้าในช่องพิมพ์</DialogTitle>
          <DialogDescription>
            เลือกสินค้าและจำนวน แล้วเลือกได้ว่าจะใส่ราคา/โปรโมชันหรือไม่ ระบบจะแยกแต่ละรายการคนละบรรทัด
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาสินค้า"
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="-mx-1 max-h-72 overflow-y-auto px-1">
          {loading && (
            <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin" /></div>
          )}
          {!loading && visible.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {products.length === 0 ? 'ยังไม่มีสินค้าในระบบ' : 'ไม่พบสินค้าที่ค้นหา'}
            </p>
          )}
          {visible.map((p) => {
            const qty = quantities[p.id] ?? 0;
            const on = qty > 0;
            return (
              <div
                key={p.id}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border-b px-2 py-2.5 text-left last:border-b-0',
                  on ? 'bg-accent' : '',
                )}
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.name}
                  {p.variant && <span className="text-muted-foreground"> ({p.variant})</span>}
                </span>
                {/* ราคาที่แสดงตรงนี้เป็นแค่ตัวช่วยเลือก — ตัวที่วางจริงมาจากเซิร์ฟเวอร์ */}
                <span className="shrink-0 text-sm text-muted-foreground">
                  {Number(p.price).toLocaleString('th-TH')}
                </span>
                <div className="flex shrink-0 items-center rounded-md border bg-background">
                  <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => changeQty(p.id, -1)} disabled={!on} aria-label={`ลดจำนวน ${p.name}`}>
                    <Minus className="size-3.5" />
                  </Button>
                  <span className="w-7 text-center text-sm font-medium">{qty}</span>
                  <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => changeQty(p.id, 1)} aria-label={`เพิ่มจำนวน ${p.name}`}>
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 rounded-md border p-2.5">
          <Checkbox id="show-product-price" checked={showPrice} onCheckedChange={(value) => setShowPrice(value === true)} />
          <label htmlFor="show-product-price" className="text-sm">แสดงราคาด้วย</label>
        </div>

        {promotions.length > 0 && (
          <div className="space-y-2 rounded-md border p-2.5">
            <p className="flex items-center gap-1.5 text-sm font-medium"><Tag className="size-4" /> โปรโมชันที่ต้องการใส่</p>
            <div className="flex flex-wrap gap-1.5">
              {promotions.map((promotion) => {
                const on = promotionIds.includes(promotion.id);
                return (
                  <Button
                    key={promotion.id}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    onClick={() => setPromotionIds((prev) => on ? prev.filter((id) => id !== promotion.id) : [...prev, promotion.id])}
                  >
                    {promotion.name}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button disabled={busy || Object.keys(quantities).length === 0} onClick={() => void insert()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            ใส่ ({Object.values(quantities).reduce((sum, qty) => sum + qty, 0)} ชิ้น)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
