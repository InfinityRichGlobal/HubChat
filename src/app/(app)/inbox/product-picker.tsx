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
import { Loader2, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Product = {
  id: string;
  name: string;
  variant: string | null;
  price: number;
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
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

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
      if (alive) setPicked([]);
      if (alive) setQ('');
      if (alive) setLoading(true);

      try {
        const res = await fetch('/api/products?active=1', { cache: 'no-store' });
        const json = (await res.json()) as { ok: boolean; data?: { products: Product[] } };
        if (alive && json.ok) setProducts(json.data?.products ?? []);
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

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function insert() {
    if (picked.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/compose`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // ⭐ ส่งแค่ id — ราคาให้เซิร์ฟเวอร์เป็นคนหา
        body: JSON.stringify({ kind: 'products', product_ids: picked.slice(0, 10) }),
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
            เลือกได้หลายอย่าง — ระบบจะใส่ชื่อและราคาให้ ⚠️ ไม่ได้ส่งออกไปเอง ต้องกดส่งอีกที
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
            const on = picked.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border-b px-2 py-2.5 text-left last:border-b-0',
                  on ? 'bg-accent' : 'hover:bg-accent/50',
                )}
              >
                <span
                  className={cn(
                    'size-4 shrink-0 rounded border',
                    on && 'border-primary bg-primary',
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.name}
                  {p.variant && <span className="text-muted-foreground"> ({p.variant})</span>}
                </span>
                {/* ราคาที่แสดงตรงนี้เป็นแค่ตัวช่วยเลือก — ตัวที่วางจริงมาจากเซิร์ฟเวอร์ */}
                <span className="shrink-0 text-sm text-muted-foreground">
                  {Number(p.price).toLocaleString('th-TH')}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button disabled={busy || picked.length === 0} onClick={() => void insert()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            ใส่ {picked.length > 0 ? `(${picked.length})` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
