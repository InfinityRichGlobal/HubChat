'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Eye, Folder, ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Item = {
  id: string;
  mime: string;
  bytes: number;
  preview_url: string;
  public_url: string | null;
  created_at: string;
};

const CATEGORIES = ['ทั้งหมด', 'โปรโมชั่น', 'สินค้า', 'รีวิว / สลิป', 'ทั่วไป'] as const;
type Category = (typeof CATEGORIES)[number];

const FOLDER_STORAGE_KEY = 'hubchat_media_categories';

export default function MediaClient({ initialItems, canManage }: { initialItems: Item[]; canManage: boolean }) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<Category>('ทั้งหมด');
  const [itemCategories, setItemCategories] = useState<Record<string, Category>>({});
  const [previewItem, setPreviewItem] = useState<Item | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // โหลดข้อมูลแฟ้มที่บันทึกไว้ในเบราว์เซอร์
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FOLDER_STORAGE_KEY);
      if (saved) setItemCategories(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  function setCategoryForItem(id: string, cat: Category) {
    setItemCategories((prev) => {
      const next = { ...prev, [id]: cat };
      try {
        localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    toast.success(`ย้ายไฟล์ไปยังแฟ้ม "${cat}" แล้ว`);
  }

  async function refresh() {
    const res = await fetch('/api/media-library', { cache: 'no-store' });
    const json = await res.json();
    if (json.ok) setItems(json.data.items);
  }

  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/media-library', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error?.message_th ?? 'อัปโหลดไม่สำเร็จ');
      
      const newId = json.data?.id;
      if (newId && activeTab !== 'ทั้งหมด') {
        setCategoryForItem(newId, activeTab);
      }
      toast.success('เพิ่มเข้าคลังสื่อแล้ว');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'อัปโหลดไม่สำเร็จ');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('ต้องการลบไฟล์นี้ออกจากคลังสื่อถาวรหรือไม่?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/media-library?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error?.message_th ?? 'ลบไฟล์ไม่สำเร็จ');
      toast.success('ลบไฟล์เรียบร้อยแล้ว');
      if (previewItem?.id === id) setPreviewItem(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ลบไฟล์ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  function getCopyUrl(item: Item): string {
    if (item.public_url && item.public_url.startsWith('http')) return item.public_url;
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/api/media/${item.id}`;
    }
    return item.preview_url;
  }

  const displayedItems = items.filter((item) => {
    if (activeTab === 'ทั้งหมด') return true;
    const cat = itemCategories[item.id] ?? 'ทั่วไป';
    return cat === activeTab;
  });

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-2">
        <div>
          <CardTitle>คลังรูปและวิดีโอ (Media Library)</CardTitle>
          <CardDescription>
            อัปโหลดไฟล์ครั้งเดียว จัดหมวดหมู่แฟ้ม คัดลอกลิงก์ไปใช้ในแชทหรือชุดคำตอบได้ทันที
          </CardDescription>
        </div>
        {canManage && (
          <div>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm"
              onChange={(event) => void upload(event.target.files?.[0] ?? null)}
            />
            <Button onClick={() => inputRef.current?.click()} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              เพิ่มไฟล์ {activeTab !== 'ทั้งหมด' ? `(${activeTab})` : ''}
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* --- แถบแฟ้ม / หมวดหมู่ --- */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b">
          {CATEGORIES.map((cat) => {
            const active = activeTab === cat;
            const count = cat === 'ทั้งหมด'
              ? items.length
              : items.filter((it) => (itemCategories[it.id] ?? 'ทั่วไป') === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveTab(cat)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors shrink-0 ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/70 text-muted-foreground hover:bg-muted'
                }`}
              >
                <Folder className="size-3.5" />
                <span>{cat}</span>
                <span className={`text-[10px] px-1 rounded-full ${active ? 'bg-primary-foreground/20' : 'bg-background'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* --- รายการไฟล์ --- */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {displayedItems.map((item) => {
            const currentCat = itemCategories[item.id] ?? 'ทั่วไป';
            const isVideo = item.mime.startsWith('video/');

            return (
              <div
                key={item.id}
                className="group relative flex flex-col overflow-hidden rounded-lg border bg-card hover:shadow-md transition-shadow"
              >
                {/* พรีวิวภาพ/วิดีโอ */}
                <div
                  className="relative aspect-square w-full cursor-pointer overflow-hidden bg-muted flex items-center justify-center"
                  onClick={() => setPreviewItem(item)}
                >
                  {isVideo ? (
                    <video src={item.preview_url} className="size-full object-cover" preload="metadata" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.preview_url}
                      alt="สื่อในคลัง"
                      className="size-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                  )}

                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button size="icon" variant="secondary" className="size-8 rounded-full">
                      <Eye className="size-4" />
                    </Button>
                  </div>

                  {/* ป้ายแฟ้ม */}
                  <div className="absolute top-1.5 left-1.5">
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-background/80 backdrop-blur-sm">
                      {currentCat}
                    </Badge>
                  </div>
                </div>

                {/* แถบเครื่องมือใต้รูป */}
                <div className="flex items-center justify-between gap-1 p-2 bg-background border-t">
                  <span className="truncate text-[10px] text-muted-foreground">
                    {(item.bytes / 1024 / 1024).toFixed(1)} MB
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      title="คัดลอกลิงก์นำไปใช้"
                      onClick={() => {
                        const url = getCopyUrl(item);
                        void navigator.clipboard.writeText(url).then(() => toast.success('คัดลอกลิงก์ไฟล์แล้ว'));
                      }}
                    >
                      <Copy className="size-3.5" />
                    </Button>

                    {canManage && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive hover:text-destructive"
                        title="ลบไฟล์"
                        onClick={() => void deleteItem(item.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {displayedItems.length === 0 && (
          <div className="py-16 text-center space-y-2">
            <Folder className="size-10 mx-auto text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">ไม่มีไฟล์ในแฟ้ม "{activeTab}"</p>
            {canManage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                className="mt-2"
              >
                เพิ่มไฟล์เข้าแฟ้มนี้
              </Button>
            )}
          </div>
        )}
      </CardContent>

      {/* --- กล่องแสดงพรีวิวภาพขนาดใหญ่ (Lightbox) --- */}
      <Dialog open={!!previewItem} onOpenChange={(o) => !o && setPreviewItem(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>พรีวิวไฟล์สื่อ</DialogTitle>
          </DialogHeader>

          {previewItem && (
            <div className="space-y-4">
              <div className="flex justify-center bg-black/5 rounded-lg overflow-hidden max-h-[55vh]">
                {previewItem.mime.startsWith('video/') ? (
                  <video src={previewItem.preview_url} controls autoPlay className="max-h-[55vh] max-w-full" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewItem.preview_url}
                    alt="พรีวิวขนาดใหญ่"
                    className="max-h-[55vh] w-auto object-contain rounded"
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t text-sm">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">ID: {previewItem.id}</p>
                  <p className="text-xs text-muted-foreground">
                    ขนาด: {(previewItem.bytes / 1024 / 1024).toFixed(2)} MB · วันที่: {new Date(previewItem.created_at).toLocaleDateString('th-TH')}
                  </p>
                </div>

                {/* เปลี่ยนแฟ้ม */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">ย้ายแฟ้ม:</span>
                  <div className="flex flex-wrap gap-1">
                    {CATEGORIES.filter((c) => c !== 'ทั้งหมด').map((cat) => (
                      <Button
                        key={cat}
                        size="sm"
                        variant={(itemCategories[previewItem.id] ?? 'ทั่วไป') === cat ? 'default' : 'outline'}
                        className="h-7 text-xs"
                        onClick={() => setCategoryForItem(previewItem.id, cat)}
                      >
                        {cat}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                {canManage && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void deleteItem(previewItem.id)}
                    className="gap-1.5"
                  >
                    <Trash2 className="size-3.5" />
                    ลบไฟล์นี้
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const url = getCopyUrl(previewItem);
                    void navigator.clipboard.writeText(url).then(() => toast.success('คัดลอกลิงก์ไฟล์แล้ว'));
                  }}
                  className="gap-1.5"
                >
                  <Copy className="size-3.5" />
                  คัดลอกลิงก์
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
