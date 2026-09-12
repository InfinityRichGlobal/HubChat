'use client';
/**
 * เลือกสินค้าแล้ววางลงช่องพิมพ์ (ก้อน 2 ข้อ 1.10)
 * ===========================================================================
 * ⚠️ ตั้งใจ **ไม่** ทำหน้าร้านใหม่ — ใช้แคตตาล็อกที่มีอยู่แล้ว
 *    สิ่งที่แอดมินต้องการตอนคุยกับลูกค้าคือ "พิมพ์ชื่อกับราคาให้ถูก โดยไม่ต้องจำ"
 *
 * 🔴 ราคาและโปรโมชันมาจากเซิร์ฟเวอร์เท่านั้น เพื่อความถูกต้อง
 *    มีช่องตัวอย่างข้อความแบบแก้ไขได้ ให้แอดมินพิมพ์ข้อความเพิ่มหรือแก้คำได้อิสระก่อนใส่ลงแชท
 */
import { useEffect, useState, useCallback } from 'react';
import { Loader2, Minus, Plus, RefreshCw, Search, Tag } from 'lucide-react';
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

type Promotion = {
  id: string;
  name: string;
  type?: string;
  price?: number | null;
  is_active: boolean;
};

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
  const [composing, setComposing] = useState(false);
  const [q, setQ] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [promotionIds, setPromotionIds] = useState<string[]>([]);
  const [showAmount, setShowAmount] = useState(true);

  // ปะหัว-ปะท้าย snippets
  const [headerSnippet, setHeaderSnippet] = useState(true);
  const [transferSnippet, setTransferSnippet] = useState(false);
  const [codSnippet, setCodSnippet] = useState(false);

  // ข้อความตัวอย่างที่แก้ไขได้อิสระ
  const [previewText, setPreviewText] = useState('');
  const [isManualEdited, setIsManualEdited] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;

    void (async () => {
      if (alive) setQuantities({});
      if (alive) setPromotionIds([]);
      if (alive) setShowAmount(true);
      if (alive) setHeaderSnippet(true);
      if (alive) setTransferSnippet(false);
      if (alive) setCodSnippet(false);
      if (alive) setPreviewText('');
      if (alive) setIsManualEdited(false);
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
    setIsManualEdited(false);
  }

  // คำนวณและดึงข้อความจากเซิร์ฟเวอร์
  const fetchComposedText = useCallback(async (
    currentQuantities: Record<string, number>,
    currentPromos: string[],
    includeAmount: boolean,
    hasHeader: boolean,
    hasTransfer: boolean,
    hasCod: boolean,
  ) => {
    const items = Object.entries(currentQuantities).map(([product_id, qty]) => ({ product_id, qty }));
    if (items.length === 0) {
      setPreviewText('');
      return;
    }

    const footerParts: string[] = [];
    if (hasTransfer) footerParts.push('ลูกค้าเลือกชำระแบบโอน แอดมินจัดส่งฟรีให้ค่า');
    if (hasCod) footerParts.push('หากเลือกชำระปลายทาง + เพิ่ม 40 บาทค่า');

    try {
      setComposing(true);
      const res = await fetch(`/api/conversations/${conversationId}/compose`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'products', items: items.slice(0, 10), promotion_ids: currentPromos, include_amount: includeAmount, custom_header: hasHeader ? 'แอดมินสรุปยอดให้เรียบร้อยนะคะ' : undefined, custom_footer: footerParts.length > 0 ? footerParts.join('\n') : undefined }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { text: string };
      };
      if (json.ok && json.data?.text) {
        setPreviewText(json.data.text);
      }
    } catch {
      // Ignored
    } finally {
      setComposing(false);
    }
  }, [conversationId]);

  // ซิงก์พรีวิวเมื่อตัวเลือกเปลี่ยน และยังไม่ได้พิมพ์เอง
  useEffect(() => {
    if (!open || isManualEdited) return;
    const timer = setTimeout(() => {
      void fetchComposedText(quantities, promotionIds, showAmount, headerSnippet, transferSnippet, codSnippet);
    }, 150);
    return () => clearTimeout(timer);
  }, [open, quantities, promotionIds, showAmount, headerSnippet, transferSnippet, codSnippet, isManualEdited, fetchComposedText]);

  const selectedItems = Object.entries(quantities).map(([id, qty]) => {
    const p = products.find((x) => x.id === id);
    return { id, qty, product: p };
  }).filter((x) => Boolean(x.product));

  const totalQty = selectedItems.reduce((sum, item) => sum + item.qty, 0);

  function insert() {
    if (!previewText.trim()) return;
    onInsertText(previewText.trim());
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-hidden flex flex-col max-w-xl">
        <DialogHeader className="pb-1">
          <DialogTitle>สรุปยอด / ใส่รายการสินค้า</DialogTitle>
          <DialogDescription>
            เลือกสินค้า โปรโมชัน และข้อความสรุปยอด สามารถพิมพ์แก้ไขข้อความได้อิสระก่อนใส่ลงแชท
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาชื่อสินค้า / รุ่น..."
            className="pl-8 h-9 text-sm"
          />
        </div>

        <div className="-mx-1 max-h-44 overflow-y-auto px-1 divide-y">
          {loading && (
            <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          )}
          {!loading && visible.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
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
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors',
                  on ? 'bg-primary/5' : 'hover:bg-muted/40',
                )}
              >
                <span className="min-w-0 flex-1 truncate text-xs sm:text-sm font-medium">
                  {p.name}
                  {p.variant && <span className="text-muted-foreground font-normal"> ({p.variant})</span>}
                </span>
                <span className="shrink-0 text-xs sm:text-sm font-semibold text-muted-foreground">
                  {Number(p.price).toLocaleString('th-TH')} ฿
                </span>
                <div className="flex shrink-0 items-center rounded-md border bg-background">
                  <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => changeQty(p.id, -1)} disabled={!on} aria-label={`ลดจำนวน ${p.name}`}>
                    <Minus className="size-3" />
                  </Button>
                  <span className="w-6 text-center text-xs font-semibold">{qty}</span>
                  <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => changeQty(p.id, 1)} aria-label={`เพิ่มจำนวน ${p.name}`}>
                    <Plus className="size-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* --- โปรโมชัน --- */}
        {promotions.length > 0 && (
          <div className="space-y-1.5 rounded-lg border bg-muted/20 p-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><Tag className="size-3.5 text-primary" /> โปรโมชัน</p>
            <div className="flex flex-wrap gap-1.5">
              {promotions.map((promotion) => {
                const on = promotionIds.includes(promotion.id);
                return (
                  <Button
                    key={promotion.id}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    className="h-7 text-xs px-2.5"
                    onClick={() => {
                      setPromotionIds((prev) => on ? prev.filter((id) => id !== promotion.id) : [promotion.id]);
                      setIsManualEdited(false);
                    }}
                  >
                    {promotion.name}
                    {promotion.price ? ` (${Number(promotion.price).toLocaleString('th-TH')}฿)` : ''}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {/* --- ตัวเลือกสรุปยอดและ Snippets หัวท้าย --- */}
        <div className="space-y-1.5 rounded-lg border bg-muted/10 p-2.5 text-xs">
          <div className="flex items-center gap-2 pb-1 border-b">
            <Checkbox
              id="show-product-price"
              checked={showAmount}
              onCheckedChange={(value) => { setShowAmount(value === true); setIsManualEdited(false); }}
            />
            <label htmlFor="show-product-price" className="font-semibold cursor-pointer text-foreground">
              แสดงราคา ส่วนลด และยอดรวม
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground">
              <Checkbox
                checked={headerSnippet}
                onCheckedChange={(v) => { setHeaderSnippet(v === true); setIsManualEdited(false); }}
              />
              <span>แอดมินสรุปยอดให้</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground">
              <Checkbox
                checked={transferSnippet}
                onCheckedChange={(v) => { setTransferSnippet(v === true); setIsManualEdited(false); }}
              />
              <span>โอนเงิน = ส่งฟรี</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground">
              <Checkbox
                checked={codSnippet}
                onCheckedChange={(v) => { setCodSnippet(v === true); setIsManualEdited(false); }}
              />
              <span>ปลายทาง +40 บ.</span>
            </label>
          </div>
        </div>

        {/* --- ช่องแก้ไขข้อความก่อนส่ง --- */}
        <div className="space-y-1 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              ตัวอย่างข้อความ
              {composing && <Loader2 className="size-3 animate-spin text-primary" />}
              {isManualEdited && <span className="text-[10px] text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded font-normal">แก้ไขเอง</span>}
            </span>
            {isManualEdited && (
              <button
                type="button"
                onClick={() => {
                  setIsManualEdited(false);
                  void fetchComposedText(quantities, promotionIds, showAmount, headerSnippet, transferSnippet, codSnippet);
                }}
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <RefreshCw className="size-3" /> รีเซ็ตข้อความ
              </button>
            )}
          </div>
          <textarea
            value={previewText}
            onChange={(e) => {
              setPreviewText(e.target.value);
              setIsManualEdited(true);
            }}
            placeholder={selectedItems.length === 0 ? 'เลือกสินค้าด้านบนเพื่อสร้างข้อความสรุปยอด' : 'กำลังคำนวณข้อความ...'}
            rows={4}
            className="w-full flex-1 min-h-[90px] rounded-md border border-input bg-background p-2 text-xs font-mono leading-relaxed outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t mt-auto">
          <Button variant="ghost" size="sm" onClick={onClose}>ยกเลิก</Button>
          <Button
            size="sm"
            disabled={!previewText.trim() || selectedItems.length === 0}
            onClick={insert}
          >
            ใส่ลงแชท ({totalQty} ชิ้น)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
