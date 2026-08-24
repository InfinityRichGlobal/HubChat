'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, PlugZap, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

/**
 * หน้าจัดการเพจ (ฝั่งหน้าเว็บ)
 * ⚠️ ไฟล์นี้อยู่ฝั่งเบราว์เซอร์ จึงไม่มีทางเห็น access token ของเพจ
 *    เห็นได้แค่ว่า "ใส่ token แล้วหรือยัง" เท่านั้น
 */

export type SafePage = {
  id: string;
  platform: 'facebook' | 'instagram';
  page_id: string;
  page_name: string;
  display_name: string | null;
  tag_color: string;
  is_active: boolean;
  has_token: boolean;
  created_at: string;
};

const PLATFORM_LABEL: Record<SafePage['platform'], string> = {
  facebook: 'Facebook (Messenger)',
  instagram: 'Instagram',
};

export default function PagesClient({ initialPages }: { initialPages: SafePage[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [tokenFor, setTokenFor] = useState<SafePage | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

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
      // ⚠️ ต้องมีตัวรับ error เสมอ ไม่งั้นความผิดพลาดจะหายเงียบ ๆ
      //    แล้วผู้ใช้จะกดปุ่มแล้วไม่เห็นอะไรเกิดขึ้นเลย
      console.error('[pages] ทำรายการไม่สำเร็จ:', err);
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้', {
        description: err instanceof Error ? err.message : undefined,
      });
      return null;
    }
  }

  /** ทดสอบว่า token ใช้ได้จริงไหม */
  async function testPage(page: SafePage) {
    setTesting(page.id);
    try {
      const res = await fetch(`/api/pages/${page.id}/test`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message_th ?? 'ทดสอบไม่สำเร็จ');
        return;
      }
      if (json.data.ok) {
        toast.success(json.data.message_th);
        startTransition(() => router.refresh());
      } else {
        toast.error(json.data.message_th);
      }
    } finally {
      setTesting(null);
    }
  }

  /** สั่งประมวลผลคิว webhook เดี๋ยวนี้ — ใช้ตอนอยากเห็นว่าข้อความไหลเข้ามาจริง */
  async function processQueue() {
    setProcessing(true);
    try {
      const data = await call('/api/ingest/process', { method: 'POST' });
      if (data) {
        toast.success(
          `ประมวลผลแล้ว ${data.jobs} ก้อน — ข้อความเข้าใหม่ ${data.inbound_saved} / ข้อความออก ${data.echo_saved} / ซ้ำ ${data.duplicates}`,
        );
      }
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">จัดการเพจ</h1>
          <p className="text-sm text-muted-foreground">
            เชื่อมเพจ Facebook / Instagram เข้าระบบ — token เก็บไว้ฝั่งเซิร์ฟเวอร์เท่านั้น
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={processQueue} disabled={processing}>
            {processing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            ประมวลผลคิว
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            เชื่อมเพจ
          </Button>
        </div>
      </div>

      {initialPages.length === 0 && (
        <Alert>
          <PlugZap className="size-4" />
          <AlertTitle>ยังไม่ได้เชื่อมเพจไหนเลย</AlertTitle>
          <AlertDescription>
            ทำตามคู่มือในไฟล์ <code className="font-mono">docs/META_SETUP_TH.md</code> ให้ครบก่อน
            แล้วค่อยกลับมากดปุ่ม &quot;เชื่อมเพจ&quot; ด้านบน
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        {initialPages.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: p.tag_color }}
                  aria-hidden
                />
                <CardTitle className="text-base">{p.display_name || p.page_name}</CardTitle>
                <Badge variant="secondary">{PLATFORM_LABEL[p.platform]}</Badge>
                {p.has_token ? (
                  <Badge variant="outline" className="gap-1">
                    <ShieldCheck className="size-3" />
                    มี token
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <ShieldAlert className="size-3" />
                    ยังไม่มี token
                  </Badge>
                )}
                {!p.is_active && <Badge variant="destructive">ปิดใช้งาน</Badge>}
              </div>
              <CardDescription className="font-mono text-xs">
                {p.page_name} · Page ID {p.page_id}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => testPage(p)}
                disabled={testing === p.id || !p.has_token}
              >
                {testing === p.id ? <Loader2 className="animate-spin" /> : <PlugZap />}
                ทดสอบการเชื่อมต่อ
              </Button>
              <Button variant="outline" size="sm" onClick={() => setTokenFor(p)}>
                {p.has_token ? 'เปลี่ยน token' : 'ใส่ token'}
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Label htmlFor={`active-${p.id}`} className="text-xs text-muted-foreground">
                  เปิดใช้งาน
                </Label>
                <Switch
                  id={`active-${p.id}`}
                  checked={p.is_active}
                  disabled={pending}
                  onCheckedChange={(v) =>
                    call(
                      `/api/pages/${p.id}`,
                      { method: 'PATCH', body: JSON.stringify({ is_active: v }) },
                      v ? 'เปิดใช้งานเพจแล้ว' : 'ปิดใช้งานเพจแล้ว — ข้อความเก่ายังอยู่ครบ',
                    )
                  }
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <CreatePageDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={call} />
      <TokenDialog page={tokenFor} onClose={() => setTokenFor(null)} onSubmit={call} />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

type CallFn = (url: string, init: RequestInit, successMsg?: string) => Promise<unknown>;

function CreatePageDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: CallFn;
}) {
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const token = String(form.get('access_token') ?? '').trim();
      const result = await onSubmit(
        '/api/pages',
        {
          method: 'POST',
          body: JSON.stringify({
            platform: form.get('platform'),
            page_id: String(form.get('page_id') ?? '').trim(),
            page_name: String(form.get('page_name') ?? '').trim(),
            display_name: String(form.get('display_name') ?? '').trim() || null,
            tag_color: String(form.get('tag_color') ?? '#3b82f6'),
            ...(token ? { access_token: token } : {}),
          }),
        },
        'เชื่อมเพจแล้ว — กด "ทดสอบการเชื่อมต่อ" เพื่อยืนยันว่า token ใช้ได้จริง',
      );
      if (result) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>เชื่อมเพจใหม่</DialogTitle>
            <DialogDescription>
              ค่าทั้งหมดหาได้จากคู่มือ docs/META_SETUP_TH.md — ทำตามทีละขั้นได้เลย
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="platform">แพลตฟอร์ม</Label>
              <Select name="platform" defaultValue="facebook">
                <SelectTrigger id="platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="facebook">Facebook (Messenger)</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="page_id">Page ID (ตัวเลขจาก Meta)</Label>
              <Input id="page_id" name="page_id" required placeholder="เช่น 102938475610293" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="page_name">ชื่อเพจตามจริง</Label>
              <Input id="page_name" name="page_name" required placeholder="เช่น Lipstick Studio" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="display_name">ชื่อเล่นที่จะโชว์ในระบบ (ไม่ใส่ก็ได้)</Label>
              <Input id="display_name" name="display_name" placeholder="เช่น เพจหลัก" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tag_color">สีป้ายเพจ</Label>
              <Input id="tag_color" name="tag_color" type="color" defaultValue="#3b82f6" className="h-10 w-20 p-1" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="access_token">Page Access Token</Label>
              <Input
                id="access_token"
                name="access_token"
                type="password"
                autoComplete="off"
                placeholder="วางค่าที่ได้จาก Meta"
              />
              <p className="text-xs text-muted-foreground">
                ระบบเข้ารหัสก่อนเก็บลงฐานข้อมูล และจะไม่ส่งกลับมาแสดงอีกไม่ว่ากรณีใด
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              เชื่อมเพจ
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TokenDialog({
  page,
  onClose,
  onSubmit,
}: {
  page: SafePage | null;
  onClose: () => void;
  onSubmit: CallFn;
}) {
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!page) return;
    const token = String(new FormData(e.currentTarget).get('access_token') ?? '').trim();
    if (!token) return;
    setBusy(true);
    try {
      const result = await onSubmit(
        `/api/pages/${page.id}`,
        { method: 'PATCH', body: JSON.stringify({ access_token: token }) },
        'บันทึก token แล้ว — กด "ทดสอบการเชื่อมต่อ" เพื่อยืนยัน',
      );
      if (result) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={page !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Page Access Token</DialogTitle>
            <DialogDescription>
              {page?.display_name || page?.page_name} — ค่าเดิมดูไม่ได้ ใส่ค่าใหม่ทับได้อย่างเดียว
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5 py-4">
            <Label htmlFor="new_token">Token ใหม่</Label>
            <Input id="new_token" name="access_token" type="password" autoComplete="off" required />
            <p className="text-xs text-muted-foreground">
              ใช้ System User token จาก Business Manager ตามสเปกหัวข้อ 6.6 —
              token ที่ผูกกับบัญชีส่วนตัวจะตายเมื่อคนนั้นเปลี่ยนรหัสหรือลาออก
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
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
  );
}
