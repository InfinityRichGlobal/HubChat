'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type Item = {
  id: string;
  mime: string;
  bytes: number;
  preview_url: string;
  public_url: string | null;
  created_at: string;
};

const DEFAULT_ALBUMS = ['โปรโมชั่น', 'สินค้า', 'รีวิว / สลิป', 'ระบบ', 'ทั่วไป'] as const;

const ALBUMS_STORAGE_KEY = 'hubchat_media_albums_v2';
const FOLDER_STORAGE_KEY = 'hubchat_media_categories_v2';
const HIDDEN_STORAGE_KEY = 'hubchat_media_hidden_items_v2';

export default function MediaClient({
  initialItems,
  canManage,
}: {
  initialItems: Item[];
  canManage: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const [albums, setAlbums] = useState<string[]>([...DEFAULT_ALBUMS]);
  const [activeTab, setActiveTab] = useState<string>('ทั้งหมด');
  const [itemCategories, setItemCategories] = useState<Record<string, string>>({});
  const [hiddenItemIds, setHiddenItemIds] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [previewItem, setPreviewItem] = useState<Item | null>(null);

  // Dialog states for album CRUD
  const [isAddAlbumOpen, setIsAddAlbumOpen] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [isRenameAlbumOpen, setIsRenameAlbumOpen] = useState(false);
  const [renamingAlbum, setRenamingAlbum] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);

  // โหลดอัลบั้ม, หมวดหมู่ของไฟล์, และรายการที่ถูกซ่อนจาก LocalStorage
  useEffect(() => {
    try {
      const savedAlbums = localStorage.getItem(ALBUMS_STORAGE_KEY);
      if (savedAlbums) {
        const parsed = JSON.parse(savedAlbums);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setAlbums(parsed);
        }
      }
    } catch {}

    try {
      const savedCats = localStorage.getItem(FOLDER_STORAGE_KEY);
      if (savedCats) setItemCategories(JSON.parse(savedCats));
    } catch {}

    try {
      const savedHidden = localStorage.getItem(HIDDEN_STORAGE_KEY);
      if (savedHidden) setHiddenItemIds(JSON.parse(savedHidden));
    } catch {}
  }, []);

  function saveAlbums(newAlbums: string[]) {
    setAlbums(newAlbums);
    try {
      localStorage.setItem(ALBUMS_STORAGE_KEY, JSON.stringify(newAlbums));
    } catch {}
  }

  function handleCreateAlbum() {
    const trimmed = newAlbumName.trim();
    if (!trimmed) {
      toast.error('กรุณาระบุชื่ออัลบั้ม');
      return;
    }
    if (trimmed === 'ทั้งหมด' || albums.includes(trimmed)) {
      toast.error('มีอัลบั้มชื่อนี้อยู่แล้ว');
      return;
    }
    const updated = [...albums, trimmed];
    saveAlbums(updated);
    setActiveTab(trimmed);
    setNewAlbumName('');
    setIsAddAlbumOpen(false);
    toast.success(`สร้างอัลบั้ม "${trimmed}" เรียบร้อย`);
  }

  function handleRenameAlbum() {
    if (!renamingAlbum) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast.error('กรุณาระบุชื่ออัลบั้ม');
      return;
    }
    if (trimmed === renamingAlbum) {
      setIsRenameAlbumOpen(false);
      return;
    }
    if (trimmed === 'ทั้งหมด' || albums.includes(trimmed)) {
      toast.error('มีอัลบั้มชื่อนี้อยู่แล้ว');
      return;
    }

    const updated = albums.map((a) => (a === renamingAlbum ? trimmed : a));
    saveAlbums(updated);

    // อัปเดตรายการรูปที่เคยอยู่ในอัลบั้มนี้
    setItemCategories((prev) => {
      const next: Record<string, string> = {};
      for (const [id, cat] of Object.entries(prev)) {
        next[id] = cat === renamingAlbum ? trimmed : cat;
      }
      try {
        localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

    if (activeTab === renamingAlbum) setActiveTab(trimmed);
    setIsRenameAlbumOpen(false);
    setRenamingAlbum(null);
    toast.success(`เปลี่ยนชื่ออัลบั้มเป็น "${trimmed}" เรียบร้อย`);
  }

  function handleDeleteAlbum(albumName: string) {
    if (albumName === 'ทั่วไป' || albumName === 'ระบบ') {
      toast.error(`ไม่สามารถลบอัลบั้ม "${albumName}" ได้`);
      return;
    }
    if (!confirm(`ต้องการลบอัลบั้ม "${albumName}" หรือไม่? รูปในอัลบั้มนี้จะถูกย้ายไปที่ "ทั่วไป"`)) return;

    const updated = albums.filter((a) => a !== albumName);
    saveAlbums(updated);

    // ย้ายรูปไปทั่วไป
    setItemCategories((prev) => {
      const next: Record<string, string> = {};
      for (const [id, cat] of Object.entries(prev)) {
        next[id] = cat === albumName ? 'ทั่วไป' : cat;
      }
      try {
        localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

    if (activeTab === albumName) setActiveTab('ทั้งหมด');
    toast.success(`ลบอัลบั้ม "${albumName}" เรียบร้อย`);
  }

  function setCategoryForItem(id: string, cat: string, showToast = true) {
    setItemCategories((prev) => {
      const next = { ...prev, [id]: cat };
      try {
        localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    if (showToast) toast.success(`ย้ายไฟล์ไปยังอัลบั้ม "${cat}" แล้ว`);
  }

  function toggleHideItem(id: string) {
    setHiddenItemIds((prev) => {
      const isCurrentlyHidden = prev.includes(id);
      const next = isCurrentlyHidden ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      toast.success(isCurrentlyHidden ? 'ยกเลิกการซ่อนไฟล์แล้ว' : 'ซ่อนไฟล์นี้เรียบร้อย (กดไอคอนตาเพื่อดูไฟล์ที่ซ่อน)');
      return next;
    });
  }

  async function refresh() {
    const res = await fetch('/api/media-library', { cache: 'no-store' });
    const json = await res.json();
    if (json.ok) setItems(json.data.items);
  }

  async function uploadMultiple(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    setBusy(true);
    let successCount = 0;
    try {
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/media-library', { method: 'POST', body: form });
        const json = await res.json();
        if (res.ok && json.ok) {
          successCount++;
          const newId = json.data?.id;
          if (newId && activeTab !== 'ทั้งหมด') {
            setCategoryForItem(newId, activeTab, false);
          }
        }
      }
      toast.success(`เพิ่มไฟล์เข้าคลังสื่อสำเร็จ ${successCount} รายการ`);
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

  const hiddenCount = items.filter((it) => hiddenItemIds.includes(it.id)).length;

  const displayedItems = items.filter((item) => {
    const isHidden = hiddenItemIds.includes(item.id);
    if (!showHidden && isHidden) return false;
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
            จัดการอัลบั้ม ซ่อน/แสดงไฟล์ และคัดลอกลิงก์ไปใช้ในแชทหรือชุดคำตอบได้ทันที
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* ปุ่มเปิด/ปิดการแสดงไฟล์ที่ถูกซ่อน */}
          <Button
            variant={showHidden ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowHidden((v) => !v)}
            className="gap-1.5 text-xs"
            title={showHidden ? 'กำลังแสดงไฟล์ทั้งหมดรวมถึงไฟล์ที่ซ่อน' : 'คลิกเพื่อดูไฟล์ที่ซ่อนไว้'}
          >
            {showHidden ? <Eye className="size-3.5 text-primary" /> : <EyeOff className="size-3.5 text-muted-foreground" />}
            <span>{showHidden ? 'แสดงไฟล์ที่ซ่อนอยู่' : 'ไฟล์ที่ซ่อน'}</span>
            {hiddenCount > 0 && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {hiddenCount}
              </Badge>
            )}
          </Button>

          {canManage && (
            <div>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm"
                onChange={(event) => void uploadMultiple(event.target.files)}
              />
              <Button onClick={() => inputRef.current?.click()} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                เพิ่มไฟล์ {activeTab !== 'ทั้งหมด' ? `(${activeTab})` : ''}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* --- แถบอัลบั้ม / หมวดหมู่ --- */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b">
          <button
            type="button"
            onClick={() => setActiveTab('ทั้งหมด')}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors shrink-0',
              activeTab === 'ทั้งหมด'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/70 text-muted-foreground hover:bg-muted',
            )}
          >
            <Folder className="size-3.5" />
            <span>ทั้งหมด</span>
            <span className={cn('text-[10px] px-1 rounded-full', activeTab === 'ทั้งหมด' ? 'bg-primary-foreground/20' : 'bg-background')}>
              {items.length}
            </span>
          </button>

          {albums.map((cat) => {
            const active = activeTab === cat;
            const count = items.filter((it) => (itemCategories[it.id] ?? 'ทั่วไป') === cat).length;
            const isSystemOrGeneral = cat === 'ทั่วไป' || cat === 'ระบบ';

            return (
              <div key={cat} className="flex items-center shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveTab(cat)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/70 text-muted-foreground hover:bg-muted',
                  )}
                >
                  <Folder className="size-3.5" />
                  <span>{cat}</span>
                  <span className={cn('text-[10px] px-1 rounded-full', active ? 'bg-primary-foreground/20' : 'bg-background')}>
                    {count}
                  </span>
                </button>

                {/* เมนูจัดการอัลบั้ม (เปลี่ยนชื่อ/ลบ) */}
                {canManage && !isSystemOrGeneral && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`จัดการอัลบั้ม ${cat}`}
                        className="p-1 -ml-1 text-muted-foreground hover:text-foreground"
                      >
                        <MoreHorizontal className="size-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() => {
                          setRenamingAlbum(cat);
                          setRenameValue(cat);
                          setIsRenameAlbumOpen(true);
                        }}
                      >
                        <Pencil className="mr-2 size-3.5" />
                        เปลี่ยนชื่ออัลบั้ม
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => handleDeleteAlbum(cat)}
                      >
                        <Trash2 className="mr-2 size-3.5" />
                        ลบอัลบั้มนี้
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}

          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsAddAlbumOpen(true)}
              className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0 rounded-full border border-dashed px-2.5"
            >
              <Plus className="size-3" />
              เพิ่มอัลบั้ม
            </Button>
          )}
        </div>

        {/* --- รายการไฟล์ (Grid 4 คอลัมน์บนจอมือถือ, 6-8 คอลัมน์บนจอใหญ่) --- */}
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 sm:gap-2.5">
          {displayedItems.map((item) => {
            const currentCat = itemCategories[item.id] ?? 'ทั่วไป';
            const isVideo = item.mime.startsWith('video/');
            const isHidden = hiddenItemIds.includes(item.id);

            return (
              <div
                key={item.id}
                className={cn(
                  'group relative flex flex-col overflow-hidden rounded-md border bg-card transition-all hover:shadow-md',
                  isHidden && 'opacity-50 ring-1 ring-amber-500/50',
                )}
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

                  {/* ปุ่มเปิด/ปิดตา (ซ่อน/แสดง) มุมขวาบน */}
                  <button
                    type="button"
                    title={isHidden ? 'ไฟล์นี้ถูกซ่อนอยู่ (คลิกเพื่อยกเลิกซ่อน)' : 'คลิกเพื่อซ่อนไฟล์นี้'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleHideItem(item.id);
                    }}
                    className={cn(
                      'absolute top-1 right-1 size-6 rounded-full flex items-center justify-center backdrop-blur-sm transition-all shadow-sm',
                      isHidden
                        ? 'bg-amber-600 text-white'
                        : 'bg-black/40 text-white/90 hover:bg-black/70 sm:opacity-0 sm:group-hover:opacity-100',
                    )}
                  >
                    {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>

                  {/* ป้ายอัลบั้มมุมซ้ายบน */}
                  <div className="absolute top-1 left-1 max-w-[70%] truncate">
                    <Badge variant="secondary" className="text-[8px] sm:text-[9px] px-1 py-0 bg-background/85 backdrop-blur-sm truncate">
                      {currentCat}
                    </Badge>
                  </div>

                  {/* ป้ายวิดีโอ */}
                  {isVideo && (
                    <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[8px] text-white">
                      วิดีโอ
                    </div>
                  )}
                </div>

                {/* แถบเครื่องมือใต้รูป */}
                <div className="flex items-center justify-between gap-0.5 p-1 bg-background border-t">
                  <span className="truncate text-[9px] text-muted-foreground">
                    {(item.bytes / 1024 / 1024).toFixed(1)}M
                  </span>

                  <div className="flex items-center gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      title="คัดลอกลิงก์นำไปใช้"
                      onClick={(e) => {
                        e.stopPropagation();
                        const url = getCopyUrl(item);
                        void navigator.clipboard.writeText(url).then(() => toast.success('คัดลอกลิงก์ไฟล์แล้ว'));
                      }}
                    >
                      <Copy className="size-3" />
                    </Button>

                    {canManage && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6 text-destructive hover:text-destructive"
                        title="ลบไฟล์"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteItem(item.id);
                        }}
                      >
                        <Trash2 className="size-3" />
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
            <p className="text-sm font-medium text-muted-foreground">
              {showHidden ? 'ไม่มีไฟล์ที่ถูกซ่อน' : `ไม่มีไฟล์ในอัลบั้ม "${activeTab}"`}
            </p>
            {canManage && !showHidden && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                className="mt-2"
              >
                เพิ่มไฟล์เข้าอัลบั้มนี้
              </Button>
            )}
          </div>
        )}
      </CardContent>

      {/* --- กล่องสร้างอัลบั้มใหม่ --- */}
      <Dialog open={isAddAlbumOpen} onOpenChange={setIsAddAlbumOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>สร้างอัลบั้มใหม่</DialogTitle>
            <DialogDescription>ตั้งชื่ออัลบั้มสำหรับจัดหมวดหมู่รูปภาพและสื่อ</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="ชื่ออัลบั้ม เช่น รีวิวลูกค้า, แบนเนอร์..."
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateAlbum()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddAlbumOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleCreateAlbum}>สร้างอัลบั้ม</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- กล่องเปลี่ยนชื่ออัลบั้ม --- */}
      <Dialog open={isRenameAlbumOpen} onOpenChange={setIsRenameAlbumOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>เปลี่ยนชื่ออัลบั้ม</DialogTitle>
            <DialogDescription>รูปทั้งหมดในอัลบั้มนี้จะถูกย้ายไปยังชื่อใหม่</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRenameAlbum()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenameAlbumOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleRenameAlbum}>บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

                {/* เปลี่ยนอัลบั้ม */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">ย้ายอัลบั้ม:</span>
                  <div className="flex flex-wrap gap-1">
                    {albums.map((cat) => (
                      <Button
                        key={cat}
                        size="sm"
                        variant={(itemCategories[previewItem.id] ?? 'ทั่วไป') === cat ? 'default' : 'outline'}
                        className="h-7 text-xs px-2"
                        onClick={() => setCategoryForItem(previewItem.id, cat)}
                      >
                        {cat}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t">
                {/* ปุ่มซ่อน / แสดงไฟล์ */}
                <Button
                  variant={hiddenItemIds.includes(previewItem.id) ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => toggleHideItem(previewItem.id)}
                  className="gap-1.5 text-xs"
                >
                  {hiddenItemIds.includes(previewItem.id) ? (
                    <>
                      <Eye className="size-3.5 text-primary" />
                      เลิกซ่อนไฟล์นี้
                    </>
                  ) : (
                    <>
                      <EyeOff className="size-3.5 text-muted-foreground" />
                      ซ่อนไฟล์นี้
                    </>
                  )}
                </Button>

                <div className="flex items-center gap-2">
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
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
