'use client';

import { useRef, useState } from 'react';
import { Copy, ImagePlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Item = { id: string; mime: string; bytes: number; preview_url: string; public_url: string | null; created_at: string };

export default function MediaClient({ initialItems, canManage, publicReady }: { initialItems: Item[]; canManage: boolean; publicReady: boolean }) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const res = await fetch('/api/media-library', { cache: 'no-store' });
    const json = await res.json();
    if (json.ok) setItems(json.data.items);
  }

  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData(); form.append('file', file);
      const res = await fetch('/api/media-library', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error?.message_th ?? 'อัปโหลดไม่สำเร็จ');
      toast.success('เพิ่มเข้าคลังสื่อแล้ว');
      await refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'อัปโหลดไม่สำเร็จ'); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div><CardTitle>คลังรูปและวิดีโอ</CardTitle><CardDescription>อัปโหลดครั้งเดียว แล้วคัดลอกลิงก์ไปใช้กับชุดคำตอบได้</CardDescription></div>
        {canManage && <><input ref={inputRef} type="file" className="hidden" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm" onChange={(event) => void upload(event.target.files?.[0] ?? null)} /><Button onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} เพิ่มไฟล์</Button></>}
      </CardHeader>
      <CardContent>
        {!publicReady && <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">ยังไม่ได้ตั้ง R2 Public Base URL — ดูไฟล์ในระบบได้ แต่ต้องตั้งค่านี้ก่อนนำลิงก์ไปส่งผ่าน Meta</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="overflow-hidden rounded-lg border">
              {item.mime.startsWith('video/') ? <video src={item.preview_url} controls className="aspect-square w-full bg-black object-contain" /> : <img src={item.preview_url} alt="สื่อในคลัง" className="aspect-square w-full object-cover" />}
              <div className="flex items-center justify-between gap-1 p-2"><span className="truncate text-[10px] text-muted-foreground">{(item.bytes / 1024 / 1024).toFixed(1)} MB</span><Button size="icon" variant="ghost" disabled={!item.public_url} title="คัดลอกลิงก์สาธารณะ" onClick={() => item.public_url && navigator.clipboard.writeText(item.public_url).then(() => toast.success('คัดลอกลิงก์แล้ว'))}><Copy className="size-3.5" /></Button></div>
            </div>
          ))}
        </div>
        {items.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีไฟล์ในคลัง</p>}
      </CardContent>
    </Card>
  );
}
