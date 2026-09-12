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
import { Loader2, Minus, Plus, RefreshCw, Search, Settings, Tag, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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

export type SnippetItem = {
  id: string;
  label: string;
  text: string;
  position: 'header' | 'footer';
  checked: boolean;
};

const DEFAULT_SNIPPETS: SnippetItem[] = [
  { id: 's1', label: 'แอดมินสรุปยอดให้', text: 'แอดมินสรุปยอดให้เรียบร้อยนะคะ', position: 'header', checked: true },
  { id: 's2', label: 'โอนเงิน = ส่งฟรี', text: 'ลูกค้าเลือกชำระแบบโอน แอดมินจัดส่งฟรีให้ค่า', position: 'footer', checked: false },
  { id: 's3', label: 'ปลายทาง +40 บ.', text: 'หากเลือกชำระปลายทาง + เพิ่ม 40 บาทค่า', position: 'footer', checked: false },
];

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

  // ปะหัว-ปะท้าย snippets ที่ปรับแต่ง เพิ่ม ลบ แก้ไขได้เอง
  const [snippets, setSnippets] = useState<SnippetItem[]>(DEFAULT_SNIPPETS);
  const [snippetsDialogOpen, setSnippetsDialogOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newText, setNewText] = useState('');
  const [newPos, setNewPos] = useState<'header' | 'footer'>('footer');

  // ข้อความตัวอย่างที่แก้ไขได้อิสระ
  const [previewText, setPreviewText] = useState('');
  const [isManualEdited, setIsManualEdited] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('hubchat_product_snippets');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSnippets(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const saveSnippets = (next: SnippetItem[]) => {
    setSnippets(next);
    try {
      localStorage.setItem('hubchat_product_snippets', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const toggleSnippet = (id: string, checked: boolean) => {
    const next = snippets.map((s) => (s.id === id ? { ...s, checked } : s));
    saveSnippets(next);
    setIsManualEdited(false);
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;

    void (async () => {
      if (alive) setQuantities({});
      if (alive) setPromotionIds([]);
      if (alive) setShowAmount(true);
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
    currentSnippets: SnippetItem[],
  ) => {
    const items = Object.entries(currentQuantities).map(([product_id, qty]) => ({ product_id, qty }));
    if (items.length === 0) {
      setPreviewText('');
      return;
    }

    const headers = currentSnippets.filter((s) => s.checked && s.position === 'header').map((s) => s.text);
    const footers = currentSnippets.filter((s) => s.checked && s.position === 'footer').map((s) => s.text);
    const headerStr = headers.length > 0 ? headers.join('\n') : undefined;
    const footerStr = footers.length > 0 ? footers.join('\n') : undefined;

    try {
      setComposing(true);
      const res = await fetch(`/api/conversations/${conversationId}/compose`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'products', items: items.slice(0, 10), promotion_ids: currentPromos, include_amount: includeAmount, custom_header: headerStr, custom_footer: footerStr }),
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
      void fetchComposedText(quantities, promotionIds, showAmount, snippets);
    }, 150);
    return () => clearTimeout(timer);
  }, [open, quantities, promotionIds, showAmount, snippets, isManualEdited, fetchComposedText]);

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
          <div className="flex items-center justify-between pb-1 border-b">
            <label htmlFor="show-product-price" className="flex items-center gap-2 font-semibold cursor-pointer text-foreground">
              <Checkbox
                id="show-product-price"
                checked={showAmount}
                onCheckedChange={(value) => { setShowAmount(value === true); setIsManualEdited(false); }}
              />
              <span>แสดงราคา ส่วนลด และยอดรวม</span>
            </label>

            <button
              type="button"
              onClick={() => setSnippetsDialogOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <Settings className="size-3" /> จัดการข้อความ
            </button>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1">
            {snippets.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground">
                <Checkbox
                  checked={s.checked}
                  onCheckedChange={(v) => toggleSnippet(s.id, v === true)}
                />
                <span className="select-none">{s.label}</span>
              </label>
            ))}
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
                  void fetchComposedText(quantities, promotionIds, showAmount, snippets);
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

      {/* --- กล่องจัดการข้อความย่อย / Snippets CRUD --- */}
      <Dialog open={snippetsDialogOpen} onOpenChange={setSnippetsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">จัดการข้อความสำเร็จรูป</DialogTitle>
            <DialogDescription className="text-xs">
              เพิ่ม ลบ หรือแก้ไขข้อความปะหัวหรือปะท้ายสรุปยอด
            </DialogDescription>
          </DialogHeader>

          {/* รายการข้อความ */}
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1 divide-y">
            {snippets.map((s) => (
              <div key={s.id} className="pt-2 first:pt-0 flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-foreground">{s.label}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {s.position === 'header' ? 'ส่วนหัว' : 'ส่วนท้าย'}
                    </span>
                  </div>
                  <p className="text-muted-foreground truncate mt-0.5">{s.text}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-destructive hover:text-destructive shrink-0"
                  onClick={() => {
                    const next = snippets.filter((x) => x.id !== s.id);
                    saveSnippets(next);
                  }}
                  title="ลบ"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {/* ฟอร์มเพิ่มข้อความใหม่ */}
          <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5 text-xs">
            <span className="font-semibold text-foreground">เพิ่มข้อความใหม่</span>
            <div className="flex gap-2">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="ชื่อปุ่ม (เช่น โอนเงิน = ส่งฟรี)"
                className="h-8 text-xs flex-1"
              />
              <select
                value={newPos}
                onChange={(e) => setNewPos(e.target.value as 'header' | 'footer')}
                className="h-8 rounded-md border bg-background px-2 text-xs"
              >
                <option value="header">ต่อด้านบน (หัว)</option>
                <option value="footer">ต่อด้านล่าง (ท้าย)</option>
              </select>
            </div>
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="ข้อความจริงที่จะใส่ในสรุปยอด..."
              rows={2}
              className="w-full rounded-md border bg-background p-2 text-xs outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex justify-end gap-1.5">
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={!newLabel.trim() || !newText.trim()}
                onClick={() => {
                  const item: SnippetItem = {
                    id: `s_${Date.now()}`,
                    label: newLabel.trim(),
                    text: newText.trim(),
                    position: newPos,
                    checked: true,
                  };
                  saveSnippets([...snippets, item]);
                  setNewLabel('');
                  setNewText('');
                  toast.success('เพิ่มข้อความสำเร็จรูปแล้ว');
                }}
              >
                <Plus className="size-3 mr-1" /> เพิ่ม
              </Button>
            </div>
          </div>

          <div className="flex justify-between items-center pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                saveSnippets(DEFAULT_SNIPPETS);
                toast.success('รีเซ็ตเป็นค่าเริ่มต้นแล้ว');
              }}
            >
              รีเซ็ตค่าเดิม
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => setSnippetsDialogOpen(false)}>
              เสร็จสิ้น
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
