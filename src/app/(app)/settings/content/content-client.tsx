'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ImageIcon, Images, Loader2, Plus, Tag as TagIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import SettingsBackButton from '@/components/settings-back-button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CannedResponse, Tag } from '@/server/content/service';

/**
 * ชุดคำตอบ + แท็ก (ฝั่งหน้าเว็บ)
 * ⚠️ หน้านี้ไม่มีการส่งข้อความหาลูกค้าเลย — เป็นแค่คลังข้อความสำเร็จรูป
 */
export default function ContentClient({
  canManage,
  initialCanned,
  initialTags,
}: {
  canManage: boolean;
  initialCanned: CannedResponse[];
  initialTags: Tag[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cannedOpen, setCannedOpen] = useState(false);
  const [editing, setEditing] = useState<CannedResponse | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#64748b');
  const [busy, setBusy] = useState(false);
  const [imageUrls, setImageUrls] = useState('');
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [libraryItems, setLibraryItems] = useState<Array<{ id: string; preview_url: string; public_url: string | null; mime?: string }>>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  async function openMediaPicker() {
    setMediaPickerOpen(true);
    if (libraryItems.length === 0) {
      setLoadingLibrary(true);
      try {
        const res = await fetch('/api/media-library?for_picker=1');
        const json = await res.json();
        if (json.ok && json.data?.items) {
          const imgs = json.data.items.filter((it: { mime: string }) => !it.mime.startsWith('video/'));
          setLibraryItems(imgs);
        }
      } catch {
        toast.error('โหลดคลังรูปภาพไม่สำเร็จ');
      } finally {
        setLoadingLibrary(false);
      }
    }
  }

  function handleSelectFromLibrary(item: { id: string; preview_url: string; public_url: string | null }) {
    const url = item.public_url || (typeof window !== 'undefined' ? `${window.location.origin}/api/media/${item.id}` : item.preview_url);
    setImageUrls((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return url;
      const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.includes(url)) {
        toast.info('รูปนี้อยู่ในรายการแล้ว');
        return prev;
      }
      return `${trimmed}\n${url}`;
    });
    toast.success('เพิ่มรูปลงในชุดคำตอบแล้ว');
  }

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
      console.error('[content] ทำรายการไม่สำเร็จ:', err);
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
      return null;
    }
  }

  async function submitCanned(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = {
      title: String(form.get('title') ?? '').trim(),
      shortcut: String(form.get('shortcut') ?? '').trim() || null,
      category: String(form.get('category') ?? '').trim() || null,
      text: String(form.get('text') ?? ''),
      images: imageUrls
        .split('\n')
        .map((url) => url.trim())
        .filter(Boolean)
        .map((url, index) => ({ url, name: `รูป ${index + 1}`, mime: 'image/*' })),
    };

    if (payload.images.length === 0) {
      toast.error('ชุดคำตอบต้องมีรูปอย่างน้อย 1 รูป');
      return;
    }

    setBusy(true);
    try {
      const result = editing
        ? await call(`/api/canned/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) }, 'บันทึกแล้ว')
        : await call('/api/canned', { method: 'POST', body: JSON.stringify(payload) }, 'เพิ่มชุดคำตอบแล้ว');
      if (result) {
        setCannedOpen(false);
        setEditing(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function addTag(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tagName.trim()) return;
    setBusy(true);
    try {
      const result = await call(
        '/api/tags',
        { method: 'POST', body: JSON.stringify({ name: tagName.trim(), color: tagColor }) },
        'เพิ่มแท็กแล้ว',
      );
      if (result) setTagName('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <SettingsBackButton title="ชุดคำตอบ + แท็ก" />
      {/* ------------------ ชุดคำตอบ ------------------ */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>ชุดคำตอบ</CardTitle>
              <CardDescription>
                พิมพ์ <kbd className="rounded border px-1 font-mono text-xs">/</kbd> ในห้องแชทเพื่อค้นหาและวางลงช่องพิมพ์
              </CardDescription>
            </div>
            {canManage && (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setImageUrls('');
                  setCannedOpen(true);
                }}
              >
                <Plus />
                เพิ่ม
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {initialCanned.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              ยังไม่มีชุดคำตอบ — เพิ่มข้อความที่ต้องพิมพ์ซ้ำ ๆ ไว้ที่นี่
            </p>
          )}

          {initialCanned.map((c) => (
            <div key={c.id} className="flex items-start gap-2 rounded-md border p-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{c.title}</span>
                  {c.shortcut && (
                    <Badge variant="secondary" className="font-mono text-[10px]">/{c.shortcut}</Badge>
                  )}
                  {c.category && <Badge variant="outline" className="text-[10px]">{c.category}</Badge>}
                  {c.use_count > 0 && (
                    <span className="text-[10px] text-muted-foreground">ใช้ {c.use_count} ครั้ง</span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                  {c.text}
                </p>
                <div className="mt-2 flex gap-1.5 overflow-x-auto">
                  {c.images.map((image, index) => image.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={`${image.url}-${index}`} src={image.url} alt={`ตัวอย่าง ${c.title}`} className="size-14 shrink-0 rounded-md border object-cover" />
                  ) : null)}
                </div>
              </div>

              {canManage && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(c);
                      setImageUrls(c.images.map((image) => image.url).filter(Boolean).join('\n'));
                      setCannedOpen(true);
                    }}
                  >
                    แก้
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="ลบ"
                    onClick={() => {
                      if (confirm(`ลบชุดคำตอบ "${c.title}" ?`)) {
                        void call(`/api/canned/${c.id}`, { method: 'DELETE' }, 'ลบแล้ว');
                      }
                    }}
                  >
                    <Trash2 className="text-[var(--destructive)]" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ------------------ แท็ก ------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TagIcon className="size-4" />
            แท็ก
          </CardTitle>
          <CardDescription>ใช้จัดกลุ่มแชท เช่น &quot;รอโอน&quot; &quot;ส่งแล้ว&quot; แล้วกรองในหน้าอินบ็อกซ์ได้</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {initialTags.length === 0 && (
              <p className="text-sm text-muted-foreground">ยังไม่มีแท็ก</p>
            )}
            {initialTags.map((t) => (
              <span
                key={t.id}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                style={{ borderColor: t.color }}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
                {t.name}
                {t.is_auto && <span className="text-[10px] text-muted-foreground">(อัตโนมัติ)</span>}
                {canManage && !t.is_auto && (
                  <button
                    type="button"
                    aria-label={`ลบแท็ก ${t.name}`}
                    className="text-muted-foreground hover:text-[var(--destructive)]"
                    onClick={() => {
                      if (confirm(`ลบแท็ก "${t.name}" ? แชทที่ติดแท็กนี้จะถูกถอดออกทั้งหมด`)) {
                        void call(`/api/tags/${t.id}`, { method: 'DELETE' }, 'ลบแท็กแล้ว');
                      }
                    }}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>

          {canManage && (
            <form onSubmit={addTag} className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-40 flex-1 flex-col gap-1.5">
                <Label htmlFor="tag_name" className="text-xs">ชื่อแท็กใหม่</Label>
                <Input
                  id="tag_name"
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  placeholder="เช่น รอโอน"
                />
              </div>
              <Input
                type="color"
                aria-label="สีแท็ก"
                value={tagColor}
                onChange={(e) => setTagColor(e.target.value)}
                className="h-11 w-16 p-1"
              />
              <Button type="submit" disabled={busy || !tagName.trim()}>
                {busy && <Loader2 className="animate-spin" />}
                เพิ่ม
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* ------------------ กล่องเพิ่ม/แก้ชุดคำตอบ ------------------ */}
      <Dialog
        open={cannedOpen}
        onOpenChange={(v) => {
          setCannedOpen(v);
          if (!v) setEditing(null);
        }}
      >
        <DialogContent>
          <form onSubmit={submitCanned}>
            <DialogHeader>
              <DialogTitle>{editing ? 'แก้ชุดคำตอบ' : 'เพิ่มชุดคำตอบ'}</DialogTitle>
              <DialogDescription>ข้อความที่ต้องพิมพ์ซ้ำ ๆ เก็บไว้ที่นี่แล้วเรียกใช้ด้วย /</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="title">ชื่อ</Label>
                <Input id="title" name="title" required defaultValue={editing?.title ?? ''} placeholder="เช่น แจ้งเลขบัญชี" />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="image_urls" className="flex items-center gap-1.5">
                    <ImageIcon className="size-4" /> รูปประกอบ (อย่างน้อย 1 รูป)
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => void openMediaPicker()}
                  >
                    <Images className="size-3.5" />
                    เลือกจากคลังสื่อ
                  </Button>
                </div>
                <textarea
                  id="image_urls"
                  rows={3}
                  required
                  value={imageUrls}
                  onChange={(event) => setImageUrls(event.target.value)}
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  placeholder={'วางลิงก์รูป หรือกดปุ่ม "เลือกจากคลังสื่อ" ด้านบน\nhttps://.../product.jpg'}
                />
                <div className="flex gap-2 overflow-x-auto pt-1">
                  {imageUrls.split('\n').map((url) => url.trim()).filter(Boolean).slice(0, 10).map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={url} src={url} alt="ภาพพรีวิว" className="size-20 shrink-0 rounded-md border object-cover" />
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="shortcut">ตัวย่อ (พิมพ์ / แล้วค้นเจอ)</Label>
                  <Input id="shortcut" name="shortcut" defaultValue={editing?.shortcut ?? ''} placeholder="bank" />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="category">หมวด</Label>
                  <Input id="category" name="category" defaultValue={editing?.category ?? ''} placeholder="การเงิน" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="text">ข้อความ</Label>
                <textarea
                  id="text"
                  name="text"
                  rows={5}
                  defaultValue={editing?.text ?? ''}
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  placeholder="พิมพ์ข้อความที่จะใช้ซ้ำ…"
                />
                <p className="text-xs text-muted-foreground">
                  ข้อความนี้จะถูกวางลงช่องพิมพ์ให้ — แอดมินยังต้องกดส่งเองเสมอ
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCannedOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                บันทึก
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ------------------ กล่องเลือกภาพจากคลังสื่อ ------------------ */}
      <Dialog open={mediaPickerOpen} onOpenChange={setMediaPickerOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>เลือกภาพจากคลังสื่อ</DialogTitle>
            <DialogDescription>แตะรูปที่ต้องการนำมาใส่ในชุดคำตอบ (แตะเลือกได้หลายรูป)</DialogDescription>
          </DialogHeader>

          {loadingLibrary ? (
            <div className="flex justify-center p-8">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : libraryItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              ยังไม่มีรูปภาพในคลังสื่อ (สามารถไปเพิ่มรูปได้ที่เมนูคลังสื่อ)
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5 py-2">
              {libraryItems.map((item) => {
                const targetUrl = item.public_url || (typeof window !== 'undefined' ? `${window.location.origin}/api/media/${item.id}` : item.preview_url);
                const isAlreadySelected = imageUrls.split('\n').map((l) => l.trim()).includes(targetUrl);

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectFromLibrary(item)}
                    className={cn(
                      'group relative aspect-square rounded-lg border overflow-hidden hover:opacity-90 transition-all focus-visible:ring-2 focus-visible:ring-ring',
                      isAlreadySelected ? 'ring-2 ring-primary border-primary' : '',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.preview_url} alt="" className="size-full object-cover" />
                    {isAlreadySelected && (
                      <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                        <div className="rounded-full bg-primary p-1 text-primary-foreground shadow-sm">
                          <Check className="size-4" />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <Button type="button" onClick={() => setMediaPickerOpen(false)}>
              เสร็จสิ้น
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
