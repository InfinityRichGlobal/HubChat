'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export type LibraryItem = {
  id: string;
  mime: string;
  bytes: number;
  preview_url: string;
  public_url?: string;
  categories?: string[];
  is_hidden?: boolean;
  created_at: string;
};

export function MediaLibraryPicker({
  open,
  kind = 'image',
  multiple = false,
  onClose,
  onSelect,
  onSelectMultiple,
}: {
  open: boolean;
  kind?: 'image' | 'video';
  multiple?: boolean;
  onClose: () => void;
  onSelect?: (item: LibraryItem) => void;
  onSelectMultiple?: (items: LibraryItem[]) => void;
}) {
  const [loaded, setLoaded] = useState<{ items: LibraryItem[]; albums: string[] } | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<string>('ทั้งหมด');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSelectedIds(new Set());
    setSelectedAlbum('ทั้งหมด');
    void fetch('/api/media-library?for_picker=1', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (!alive) return;
        if (!json.ok) throw new Error(json?.error?.message_th ?? 'อ่านคลังสื่อไม่สำเร็จ');
        const all = (json.data.items as LibraryItem[]) || [];
        const albums = (json.data.albums as string[]) || ['โปรโมชั่น', 'สินค้า', 'รีวิว / สลิป', 'วิดีโอ', 'ระบบ', 'ทั่วไป'];
        setLoaded({
          items: all,
          albums,
        });
      })
      .catch((err) => {
        if (alive) {
          setLoaded({ items: [], albums: [] });
          toast.error(err instanceof Error ? err.message : 'อ่านคลังสื่อไม่สำเร็จ');
        }
      });
    return () => { alive = false; };
  }, [open]);

  const allItems = useMemo(() => {
    if (!loaded) return [];
    return loaded.items.filter((item) => {
      if (kind === 'video') return item.mime.startsWith('video/');
      return item.mime.startsWith('image/') && !item.categories?.includes('ระบบ');
    });
  }, [loaded, kind]);

  const filteredItems = useMemo(() => {
    if (selectedAlbum === 'ทั้งหมด') return allItems;
    return allItems.filter((item) => {
      if (selectedAlbum === 'วิดีโอ') return item.mime.startsWith('video/');
      return item.categories?.includes(selectedAlbum);
    });
  }, [allItems, selectedAlbum]);

  const toggleSelect = (item: LibraryItem) => {
    if (!multiple) {
      onSelect?.(item);
      onClose();
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const handleConfirm = () => {
    const selected = allItems.filter((item) => selectedIds.has(item.id));
    if (selected.length === 0) return;
    onSelectMultiple?.(selected);
    onClose();
  };

  const albumsList = useMemo(() => {
    if (!loaded?.albums) return ['ทั้งหมด'];
    if (kind === 'video') return [];
    const filtered = loaded.albums.filter((a) => a !== 'ทั้งหมด' && a !== 'วิดีโอ' && a !== 'ระบบ');
    return ['ทั้งหมด', ...filtered];
  }, [loaded?.albums, kind]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="bottom-0 left-0 top-auto w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-3xl p-4 sm:left-1/2 sm:top-1/2 sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl max-h-[88dvh] flex flex-col gap-3">
        <DialogHeader className="pb-1 text-left">
          <DialogTitle className="text-base">
            {kind === 'video' ? 'เลือกจากคลังวิดีโอ' : 'เลือกจากคลังรูปภาพ'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {kind === 'video'
              ? 'แตะเลือกวิดีโอ'
              : multiple
              ? 'แตะที่รูปเพื่อเลือกหลายรายการพร้อมกัน แล้วกดปุ่มยืนยัน'
              : 'แตะเลือกรูปภาพที่ต้องการใช้งาน'}
          </DialogDescription>
        </DialogHeader>

        {/* --- แถบเลือกอัลบั้ม --- */}
        {loaded && kind === 'image' && albumsList.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {albumsList.map((alb) => {
              const active = selectedAlbum === alb;
              return (
                <button
                  key={alb}
                  type="button"
                  onClick={() => setSelectedAlbum(alb)}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1 text-xs transition border',
                    active
                      ? 'border-primary bg-primary text-primary-foreground font-medium'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50',
                  )}
                >
                  {alb}
                </button>
              );
            })}
          </div>
        )}

        {/* --- ตารางรูปภาพย่อแบบกะทัดรัด (4-6 คอลัมน์) --- */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loaded === null ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-xs text-muted-foreground">
              {allItems.length === 0 ? (
                <>ยังไม่มี{kind === 'video' ? 'วิดีโอ' : 'รูปภาพ'}ในคลัง<br />เพิ่มไฟล์ได้ที่เมนู “คลังสื่อ”</>
              ) : (
                <>ไม่มีไฟล์ในอัลบั้ม “{selectedAlbum}”</>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 p-0.5">
              {filteredItems.map((item) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleSelect(item)}
                    className={cn(
                      'group relative aspect-square w-full overflow-hidden rounded-lg border bg-muted text-left transition focus:outline-none',
                      isSelected ? 'border-primary ring-2 ring-primary ring-offset-1' : 'hover:border-primary/50',
                    )}
                  >
                    {item.mime.startsWith('video/') ? (
                      <div className="relative size-full bg-black flex items-center justify-center">
                        <video
                          src={`${item.public_url || item.preview_url}#t=0.001`}
                          muted
                          playsInline
                          preload="metadata"
                          className="size-full object-cover"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
                          <Video className="size-6 text-white drop-shadow-md" />
                        </div>
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.preview_url} alt="รูปในคลัง" loading="lazy" className="size-full object-cover" />
                    )}

                    {/* เครื่องหมายถูกเมื่อเลือก (โหมด multiple) */}
                    {multiple && (
                      <div
                        className={cn(
                          'absolute top-1 right-1 size-5 rounded-full flex items-center justify-center text-[10px] font-bold shadow-sm transition',
                          isSelected
                            ? 'bg-primary text-primary-foreground scale-100'
                            : 'border border-white/80 bg-black/40 text-transparent opacity-0 group-hover:opacity-100',
                        )}
                      >
                        <Check className="size-3 stroke-[3]" />
                      </div>
                    )}

                    {/* ป้ายบอกขนาดไฟล์ */}
                    <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white text-[9px] px-1 pb-0.5 pt-2 truncate">
                      {(item.bytes / 1024 / 1024).toFixed(1)}MB
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {multiple && (
          <DialogFooter className="flex flex-row items-center justify-between sm:justify-between border-t pt-2 gap-2">
            <span className="text-xs text-muted-foreground">
              เลือก {selectedIds.size} รายการ
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                ยกเลิก
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={selectedIds.size === 0}
                onClick={handleConfirm}
              >
                ยืนยันการเลือก
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
