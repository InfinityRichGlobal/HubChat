'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Folder,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Video,
  ChevronLeft,
  ChevronRight,
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
  categories?: string[];
  is_hidden?: boolean;
};

const DEFAULT_ALBUMS = ['โปรโมชั่น', 'สินค้า', 'รีวิว / สลิป', 'วิดีโอ', 'ระบบ', 'ทั่วไป'] as const;

type UploadTask = {
  id: string;
  name: string;
  size: number;
  previewUrl: string;
  isVideo: boolean;
  status: 'uploading' | 'done' | 'error';
  error?: string;
};

export default function MediaClient({
  initialItems,
  canManage,
}: {
  initialItems: Item[];
  canManage: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [albums, setAlbums] = useState<string[]>([...DEFAULT_ALBUMS]);
  const [activeTab, setActiveTab] = useState<string>('ทั้งหมด');
  const [itemCategories, setItemCategories] = useState<Record<string, string[]>>({});
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

  // โหลดอัลบั้ม, หมวดหมู่ของไฟล์, และรายการที่ถูกซ่อนจากเซิร์ฟเวอร์
  useEffect(() => {
    void fetch('/api/media-library', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (!json.ok) return;
        if (json.data?.items) setItems(json.data.items);
        if (json.data?.albums && Array.isArray(json.data.albums) && json.data.albums.length > 0) {
          // ให้แน่ใจว่ามี 'วิดีโอ' อยู่ในอัลบั้มเสมอ
          const merged = Array.from(new Set([...json.data.albums, 'วิดีโอ']));
          setAlbums(merged);
        }
        if (json.data?.categories) setItemCategories(json.data.categories);
        if (json.data?.hidden_ids) setHiddenItemIds(json.data.hidden_ids);
      })
      .catch(() => {});
  }, []);

  async function syncSettings(
    newAlbums?: string[],
    newCategories?: Record<string, string[]>,
    newHiddenIds?: string[],
  ) {
    try {
      await fetch('/api/media-library/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albums: newAlbums,
          categories: newCategories,
          hidden_ids: newHiddenIds,
        }),
      });
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
    setAlbums(updated);
    setActiveTab(trimmed);
    setNewAlbumName('');
    setIsAddAlbumOpen(false);
    void syncSettings(updated);
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

    const updatedAlbums = albums.map((a) => (a === renamingAlbum ? trimmed : a));
    setAlbums(updatedAlbums);

    const updatedCats: Record<string, string[]> = {};
    for (const [id, cats] of Object.entries(itemCategories)) {
      updatedCats[id] = cats.map((c) => (c === renamingAlbum ? trimmed : c));
    }
    setItemCategories(updatedCats);

    if (activeTab === renamingAlbum) setActiveTab(trimmed);
    setIsRenameAlbumOpen(false);
    setRenamingAlbum(null);
    void syncSettings(updatedAlbums, updatedCats);
    toast.success(`เปลี่ยนชื่ออัลบั้มเป็น "${trimmed}" เรียบร้อย`);
  }

  function handleDeleteAlbum(albumName: string) {
    if (albumName === 'ทั่วไป' || albumName === 'ระบบ' || albumName === 'วิดีโอ') {
      toast.error(`ไม่สามารถลบอัลบั้มหลัก "${albumName}" ได้`);
      return;
    }
    if (!confirm(`ต้องการลบอัลบั้ม "${albumName}" หรือไม่? รูปในอัลบั้มนี้จะยังอยู่ในอัลบั้มอื่นๆ หรือ "ทั่วไป"`)) return;

    const updatedAlbums = albums.filter((a) => a !== albumName);
    setAlbums(updatedAlbums);

    const updatedCats: Record<string, string[]> = {};
    for (const [id, cats] of Object.entries(itemCategories)) {
      const filtered = cats.filter((c) => c !== albumName);
      updatedCats[id] = filtered.length > 0 ? filtered : ['ทั่วไป'];
    }
    setItemCategories(updatedCats);

    if (activeTab === albumName) setActiveTab('ทั้งหมด');
    void syncSettings(updatedAlbums, updatedCats);
    toast.success(`ลบอัลบั้ม "${albumName}" เรียบร้อย`);
  }

  function setCategoryForItem(id: string, cat: string) {
    setItemCategories((prev) => {
      const item = items.find((x) => x.id === id);
      const isVideo = item?.mime.startsWith('video/');
      const currentCats = prev[id] ?? (isVideo ? ['วิดีโอ'] : ['ทั่วไป']);
      const current = currentCats[0] ?? (isVideo ? 'วิดีโอ' : 'ทั่วไป');

      const nextCat = current === cat ? (isVideo ? 'วิดีโอ' : 'ทั่วไป') : cat;
      const next = { ...prev, [id]: [nextCat] };
      void syncSettings(undefined, next);
      toast.success(`ย้ายรูปไปอัลบั้ม "${nextCat}" เรียบร้อย`);
      return next;
    });
  }

  function toggleHideItem(id: string) {
    setHiddenItemIds((prev) => {
      const isCurrentlyHidden = prev.includes(id);
      const next = isCurrentlyHidden ? prev.filter((x) => x !== id) : [...prev, id];
      void syncSettings(undefined, undefined, next);
      toast.success(isCurrentlyHidden ? 'ยกเลิกการซ่อนไฟล์แล้ว' : 'ซ่อนไฟล์นี้เรียบร้อย (ไฟล์จะไม่แสดงในห้องแชทของทุก User)');
      return next;
    });
  }

  async function refresh() {
    const res = await fetch('/api/media-library', { cache: 'no-store' });
    const json = await res.json();
    if (json.ok) {
      setItems(json.data.items);
      if (json.data.categories) setItemCategories(json.data.categories);
      if (json.data.hidden_ids) setHiddenItemIds(json.data.hidden_ids);
    }
  }

  /**
   * อัปโหลดไฟล์ตรงเข้า Supabase Storage ผ่าน Presigned URL
   * เพื่อข้ามขีดจำกัด 4.5MB ของ Vercel Serverless อย่างปลอดภัย 100%
   */
  async function uploadDirect(file: File): Promise<string> {
    const isVideo = file.type.startsWith('video/');

    // 1. ขอ Signed Upload URL จากเซิร์ฟเวอร์
    const urlRes = await fetch('/api/media-library/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        mime: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
        bytes: file.size,
      }),
    });
    const urlJson = await urlRes.json();
    if (!urlRes.ok || !urlJson.ok) {
      throw new Error(urlJson?.error?.message_th ?? 'ไม่สามารถสร้างช่องทางอัปโหลดได้');
    }

    const { signedUrl, key } = urlJson.data;

    // 2. ยิงไฟล์ไบนารีตรงเข้า Supabase Storage ด้วย PUT
    const putRes = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!putRes.ok) {
      throw new Error(`อัปโหลดไฟล์ขึ้น Storage ล้มเหลว (${putRes.status})`);
    }

    // 3. แจ้งเซิร์ฟเวอร์บันทึกประวัติลงตาราง media_assets
    const compRes = await fetch('/api/media-library/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        mime: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
        bytes: file.size,
      }),
    });
    const compJson = await compRes.json();
    if (!compRes.ok || !compJson.ok) {
      throw new Error(compJson?.error?.message_th ?? 'บันทึกรายการสื่อไม่สำเร็จ');
    }

    const newId = compJson.data?.id;

    // 4. จัดหมวดหมู่อัตโนมัติ: ภาพ 1 ภาพอยู่ได้ 1 อัลบั้ม
    if (newId) {
      const initialCat = isVideo && activeTab === 'ทั้งหมด'
        ? 'วิดีโอ'
        : (activeTab !== 'ทั้งหมด' ? activeTab : (isVideo ? 'วิดีโอ' : 'ทั่วไป'));
      setItemCategories((prev) => {
        const next = { ...prev, [newId]: [initialCat] };
        void syncSettings(undefined, next);
        return next;
      });
    }

    return newId;
  }

  async function uploadMultiple(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    setBusy(true);

    const initialTasks: UploadTask[] = fileList.map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`,
      name: file.name,
      size: file.size,
      previewUrl: URL.createObjectURL(file),
      isVideo: file.type.startsWith('video/'),
      status: 'uploading',
    }));
    setUploadTasks((prev) => [...initialTasks, ...prev]);

    let successCount = 0;
    try {
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const taskId = initialTasks[i].id;
        try {
          await uploadDirect(file);
          successCount++;
          setUploadTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'done' } : t));
        } catch (err) {
          console.error(`[upload error] ${file.name}:`, err);
          const msg = err instanceof Error ? err.message : 'อัปโหลดล้มเหลว';
          setUploadTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'error', error: msg } : t));
          toast.error(`${file.name}: ${msg}`);
        }
      }
      if (successCount > 0) {
        toast.success(`เพิ่มไฟล์เข้าคลังสื่อสำเร็จ ${successCount} รายการ`);
        await refresh();
      }
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
    const isVideo = item.mime.startsWith('video/');
    const cats = itemCategories[item.id] ?? (isVideo ? ['วิดีโอ'] : ['ทั่วไป']);
    return cats.includes(activeTab);
  });

  const previewIndex = previewItem ? displayedItems.findIndex((it) => it.id === previewItem.id) : -1;
  const hasPrev = previewIndex > 0;
  const hasNext = previewIndex >= 0 && previewIndex < displayedItems.length - 1;

  const goToPrev = () => {
    if (hasPrev) setPreviewItem(displayedItems[previewIndex - 1]);
  };
  const goToNext = () => {
    if (hasNext) setPreviewItem(displayedItems[previewIndex + 1]);
  };

  useEffect(() => {
    if (!previewItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goToPrev();
      else if (e.key === 'ArrowRight') goToNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewItem, previewIndex, displayedItems]);

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-2">
        <div>
          <CardTitle>คลังรูปและวิดีโอ (Media Library)</CardTitle>
          <CardDescription>
            จัดการอัลบั้ม จัดกลุ่มหลายแฟ้ม ซ่อน/แสดงไฟล์ และคัดลอกลิงก์ไปใช้ในแชทได้ทันที
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
        {/* --- แสดงรายการกำลังอัปโหลดพร้อม Thumbnail --- */}
        {uploadTasks.length > 0 && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                {busy ? <Loader2 className="size-3.5 animate-spin text-primary" /> : <Check className="size-3.5 text-green-600" />}
                {busy ? `กำลังอัปโหลด ${uploadTasks.filter((t) => t.status === 'uploading').length} รายการ...` : 'การอัปโหลดเสร็จสิ้น'}
              </span>
              {!busy && (
                <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2" onClick={() => setUploadTasks([])}>
                  ปิดแถบนี้
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {uploadTasks.map((task) => (
                <div key={task.id} className="relative flex flex-col rounded-md border bg-background overflow-hidden p-1.5 text-xs">
                  <div className="relative aspect-square w-full rounded bg-muted overflow-hidden flex items-center justify-center">
                    {task.isVideo ? (
                      <video src={task.previewUrl} className="size-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={task.previewUrl} alt="" className="size-full object-cover" />
                    )}
                    {task.status === 'uploading' && (
                      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1 text-white">
                        <Loader2 className="size-5 animate-spin" />
                        <span className="text-[10px]">กำลังส่ง...</span>
                      </div>
                    )}
                    {task.status === 'done' && (
                      <div className="absolute bottom-1 right-1 rounded-full bg-green-500 text-white p-0.5 shadow-sm">
                        <Check className="size-3" />
                      </div>
                    )}
                    {task.status === 'error' && (
                      <div className="absolute inset-0 bg-red-500/50 flex items-center justify-center text-white font-bold text-xs p-1 text-center">
                        ล้มเหลว
                      </div>
                    )}
                  </div>
                  <span className="truncate mt-1 font-medium text-[11px]">{task.name}</span>
                  <span className="text-[10px] text-muted-foreground">{(task.size / 1024 / 1024).toFixed(1)} MB</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
            const count = items.filter((it) => {
              const isVideo = it.mime.startsWith('video/');
              const cats = itemCategories[it.id] ?? (isVideo ? ['วิดีโอ'] : ['ทั่วไป']);
              return cats.includes(cat);
            }).length;
            const isProtected = cat === 'ทั่วไป' || cat === 'ระบบ' || cat === 'วิดีโอ';

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
                  {cat === 'วิดีโอ' ? <Video className="size-3.5" /> : <Folder className="size-3.5" />}
                  <span>{cat}</span>
                  <span className={cn('text-[10px] px-1 rounded-full', active ? 'bg-primary-foreground/20' : 'bg-background')}>
                    {count}
                  </span>
                </button>

                {/* เมนูจัดการอัลบั้ม (เปลี่ยนชื่อ/ลบ) สำหรับอัลบั้มที่สร้างเอง */}
                {canManage && !isProtected && (
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
            const isVideo = item.mime.startsWith('video/');
            const cats = itemCategories[item.id] ?? (isVideo ? ['วิดีโอ'] : ['ทั่วไป']);
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
                    title={isHidden ? 'ไฟล์นี้ถูกซ่อนอยู่ (คลิกเพื่อยกเลิกซ่อน)' : 'คลิกเพื่อซ่อนไฟล์นี้ (จะไม่แสดงในช่องแชท)'}
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
                  <div className="absolute top-1 left-1 max-w-[70%] truncate flex flex-wrap gap-0.5">
                    {cats.slice(0, 1).map((cat) => (
                      <Badge key={cat} variant="secondary" className="text-[8px] sm:text-[9px] px-1 py-0 bg-background/85 backdrop-blur-sm truncate">
                        {cat}
                      </Badge>
                    ))}
                    {cats.length > 1 && (
                      <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-background/85 backdrop-blur-sm">
                        +{cats.length - 1}
                      </Badge>
                    )}
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
            <DialogTitle className="flex items-center justify-between text-base">
              <span>พรีวิวไฟล์สื่อ</span>
              {previewIndex >= 0 && (
                <span className="text-xs font-normal text-muted-foreground mr-6">
                  รูปที่ {previewIndex + 1} จาก {displayedItems.length}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {previewItem && (
            <div className="space-y-4">
              <div className="relative flex items-center justify-center bg-black/5 rounded-lg overflow-hidden max-h-[55vh]">
                {hasPrev && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute left-2 z-10 size-9 rounded-full bg-background/80 hover:bg-background shadow-md backdrop-blur-xs"
                    onClick={goToPrev}
                    title="รูปก่อนหน้า (ปุ่มลูกศรซ้าย)"
                  >
                    <ChevronLeft className="size-5" />
                  </Button>
                )}

                {previewItem.mime.startsWith('video/') ? (
                  <video key={previewItem.id} src={previewItem.preview_url} controls autoPlay className="max-h-[55vh] max-w-full" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={previewItem.id}
                    src={previewItem.preview_url}
                    alt="พรีวิวขนาดใหญ่"
                    className="max-h-[55vh] w-auto object-contain rounded"
                  />
                )}

                {hasNext && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute right-2 z-10 size-9 rounded-full bg-background/80 hover:bg-background shadow-md backdrop-blur-xs"
                    onClick={goToNext}
                    title="รูปถัดไป (ปุ่มลูกศรขวา)"
                  >
                    <ChevronRight className="size-5" />
                  </Button>
                )}
              </div>

              <div className="flex flex-col gap-3 pt-2 border-t text-sm">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">ID: {previewItem.id}</p>
                  <p className="text-xs text-muted-foreground">
                    ขนาด: {(previewItem.bytes / 1024 / 1024).toFixed(2)} MB · วันที่: {new Date(previewItem.created_at).toLocaleDateString('th-TH')}
                  </p>
                </div>

                {/* จัดการอัลบั้ม (ภาพ 1 ภาพอยู่ได้ 1 อัลบั้ม) */}
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-foreground">
                    อัลบั้ม (ภาพ 1 ภาพอยู่ได้ 1 อัลบั้ม):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {albums.map((cat) => {
                      const isVideo = previewItem.mime.startsWith('video/');
                      const currentCats = itemCategories[previewItem.id] ?? (isVideo ? ['วิดีโอ'] : ['ทั่วไป']);
                      const currentCat = currentCats[0] ?? (isVideo ? 'วิดีโอ' : 'ทั่วไป');
                      const isSelected = currentCat === cat;

                      return (
                        <Button
                          key={cat}
                          type="button"
                          size="sm"
                          variant={isSelected ? 'default' : 'outline'}
                          className={cn('h-7 text-xs px-2.5 gap-1', isSelected && 'font-semibold')}
                          onClick={() => setCategoryForItem(previewItem.id, cat)}
                        >
                          {isSelected && <Check className="size-3" />}
                          <span>{cat}</span>
                        </Button>
                      );
                    })}
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
