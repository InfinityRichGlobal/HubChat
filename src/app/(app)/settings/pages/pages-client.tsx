'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Plus, PlugZap, RefreshCw, ShieldCheck, ShieldAlert, History, Square,
  Copy, Check, ExternalLink, Globe, Key, Webhook, HelpCircle, ChevronDown, ChevronUp, AlertCircle, Info,
} from 'lucide-react';
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
import PlatformIcon from '@/components/platform-icon';
import SettingsBackButton from '@/components/settings-back-button';
import { cn } from '@/lib/utils';

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

export type MetaConfig = {
  webhookUrl: string;
  verifyToken: string | null;
  hasVerifyToken: boolean;
  appId: string | null;
  hasAppSecret: boolean;
};

export default function PagesClient({
  initialPages,
  metaConfig,
  isOwner = false,
}: {
  initialPages: SafePage[];
  metaConfig?: MetaConfig;
  isOwner?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [tokenFor, setTokenFor] = useState<SafePage | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookResult, setWebhookResult] = useState<{ ok: boolean; message_th: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  async function testWebhook() {
    setTestingWebhook(true);
    setWebhookResult(null);
    try {
      const res = await fetch('/api/webhooks/meta/test', { method: 'POST' });
      const json = await res.json();
      if (json.ok && json.data?.ok) {
        setWebhookResult({ ok: true, message_th: json.data.message_th });
        toast.success('Webhook ผ่านการทดสอบเรียบร้อยแล้ว!');
      } else {
        const msg = json.error?.message_th || json.data?.message_th || 'ทดสอบไม่สำเร็จ';
        setWebhookResult({ ok: false, message_th: msg });
        toast.error(msg);
      }
    } catch {
      setWebhookResult({ ok: false, message_th: 'ไม่สามารถเชื่อมต่อไปยังเซิร์ฟเวอร์เพื่อทดสอบได้' });
      toast.error('ไม่สามารถทดสอบได้');
    } finally {
      setTestingWebhook(false);
    }
  }

  function copyToClipboard(text: string, fieldName: string) {
    void navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    toast.success(`คัดลอก ${fieldName} แล้ว`);
    setTimeout(() => setCopiedField(null), 2000);
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
      <SettingsBackButton title="จัดการเพจ" />
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

      {/* ============================================================ */}
      {/* 🌟 การ์ดตั้งค่า Meta Webhook & การเชื่อมต่อ (Facebook & Instagram) */}
      {/* ============================================================ */}
      <Card className="border-primary/30 shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Webhook className="size-4" />
              </div>
              <div>
                <CardTitle className="text-base">Meta Webhook & การเชื่อมต่อ (Facebook & IG)</CardTitle>
                <CardDescription className="text-xs">
                  นำค่าด้านล่างไปกรอกในหน้า Meta Developer Dashboard เพื่อให้แชทและคอมเมนต์ไหลเข้าระบบ
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={testWebhook}
                disabled={testingWebhook}
                className="gap-1.5 text-xs h-8"
              >
                {testingWebhook ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5 text-primary" />}
                ทดสอบ Webhook ทันที
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setGuideOpen(!guideOpen)}
                className="gap-1 text-xs h-8 text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="size-3.5" />
                {guideOpen ? 'ซ่อนคู่มือ' : 'วิธีตั้งค่าใน Meta'}
                {guideOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          {/* Result banner if tested */}
          {webhookResult && (
            <div
              className={cn(
                'flex items-center gap-2 rounded-lg p-3 text-xs font-medium',
                webhookResult.ok
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                  : 'bg-destructive/10 text-destructive border border-destructive/20',
              )}
            >
              {webhookResult.ok ? <Check className="size-4 shrink-0" /> : <AlertCircle className="size-4 shrink-0" />}
              <span>{webhookResult.message_th}</span>
            </div>
          )}

          {/* Webhook URLs */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Globe className="size-3" /> Callback URL (Webhook URL)
                </Label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => copyToClipboard(metaConfig?.webhookUrl ?? '', 'Callback URL')}
                >
                  {copiedField === 'Callback URL' ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                </Button>
              </div>
              <div className="font-mono text-xs break-all select-all font-medium text-foreground">
                {metaConfig?.webhookUrl || 'กำลังโหลด...'}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Key className="size-3" /> Verify Token
                </Label>
                {metaConfig?.verifyToken && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    onClick={() => copyToClipboard(metaConfig.verifyToken ?? '', 'Verify Token')}
                  >
                    {copiedField === 'Verify Token' ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="font-mono text-xs break-all select-all font-medium text-foreground">
                  {metaConfig?.verifyToken ? metaConfig.verifyToken : 'ยังไม่ได้ตั้งค่า (ไปที่ ตั้งค่า → ระบบ + ความลับ)'}
                </div>
                <Badge variant={metaConfig?.hasVerifyToken ? 'default' : 'destructive'} className="shrink-0 text-[10px] h-4">
                  {metaConfig?.hasVerifyToken ? 'พร้อมใช้' : 'ยังไม่ใส่'}
                </Badge>
              </div>
            </div>
          </div>

          {/* Quick status summary */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1 border-t">
            <span>สถานะระบบ Meta:</span>
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-foreground">App ID:</span>
              <Badge variant={metaConfig?.appId ? 'outline' : 'secondary'} className="text-[10px]">
                {metaConfig?.appId || 'ยังไม่ระบุ'}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-foreground">App Secret:</span>
              <Badge variant={metaConfig?.hasAppSecret ? 'default' : 'destructive'} className="text-[10px]">
                {metaConfig?.hasAppSecret ? 'มีในระบบ' : 'ยังไม่มี'}
              </Badge>
            </div>
          </div>

          {/* Collapsible Guide */}
          {guideOpen && (
            <div className="rounded-lg border bg-card p-4 text-xs flex flex-col gap-3">
              <div className="font-semibold text-sm flex items-center gap-1.5 text-foreground">
                <Info className="size-4 text-primary" /> คู่มือการนำค่าไปใส่ใน Meta Developers (Facebook & Instagram)
              </div>
              <ol className="list-decimal pl-4 space-y-2 text-muted-foreground">
                <li>
                  เข้าที่ <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="text-primary underline font-medium inline-flex items-center gap-0.5">Meta App Dashboard <ExternalLink className="size-2.5" /></a> แล้วเลือก App ของคุณ
                </li>
                <li>
                  ที่เมนูด้านซ้าย เลือก <strong>Webhooks</strong> &rarr; ด้านบนเลือกวัตถุเป็น <strong>&quot;Page&quot;</strong>
                </li>
                <li>
                  กดปุ่ม <strong>&quot;Edit Subscription&quot;</strong> (หรือ Add Callback URL):
                  <ul className="list-disc pl-4 mt-1 space-y-0.5 text-foreground">
                    <li>ช่อง <strong>Callback URL</strong>: วางค่า Callback URL ด้านบน</li>
                    <li>ช่อง <strong>Verify Token</strong>: วางค่า Verify Token ด้านบน</li>
                    <li>กด <strong>&quot;Verify and Save&quot;</strong> (ต้องขึ้นเครื่องหมายถูก)</li>
                  </ul>
                </li>
                <li>
                  ในรายการช่อง Subscription ด้านล่าง ให้กด <strong>Subscribe</strong> 5 ตัวนี้:
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-[11px] font-mono text-foreground font-semibold">messages</code>
                    <code className="bg-muted px-1.5 py-0.5 rounded text-[11px] font-mono text-foreground font-semibold">messaging_postbacks</code>
                    <code className="bg-muted px-1.5 py-0.5 rounded text-[11px] font-mono text-foreground font-semibold">message_deliveries</code>
                    <code className="bg-muted px-1.5 py-0.5 rounded text-[11px] font-mono text-foreground font-semibold">message_reads</code>
                    <code className="bg-muted px-1.5 py-0.5 rounded text-[11px] font-mono text-foreground font-semibold">feed</code>
                  </div>
                </li>
                <li className="pt-1 text-amber-700 dark:text-amber-400 font-medium">
                  ⭐ <strong>สำหรับ Instagram Direct (จุดตายที่สำคัญที่สุด):</strong>
                  <div className="mt-1 text-muted-foreground font-normal space-y-1">
                    <div>1. เชื่อมบัญชี Instagram Professional (Business) เข้ากับ Facebook Page ให้เรียบร้อย</div>
                    <div>2. <strong>เปิดแอป Instagram บนมือถือ</strong> &rarr; ไปที่ <em>การตั้งค่าและความเป็นส่วนตัว (Settings)</em> &rarr; <em>ข้อความและการตอบกลับสตอรี่ (Messages & stories)</em> &rarr; <em>เครื่องมือเชื่อมต่อ (Connected tools)</em> &rarr; <strong>เปิดสวิตช์ &quot;อนุญาตให้เข้าถึงข้อความ&quot; (Allow Access to Messages)</strong> (หากไม่เปิด Meta จะไม่ยอมส่งแชท IG มาที่ Webhook)</div>
                  </div>
                </li>
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

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

      {initialPages.length > 0 && (
        <Alert>
          <History className="size-4" />
          <AlertTitle>เปิดระบบมาแล้วเห็นแต่แชททดสอบ? เป็นเรื่องปกติ</AlertTitle>
          <AlertDescription>
            Meta ส่งข้อความให้เราเฉพาะที่เกิด &quot;หลังจาก&quot; เชื่อมเพจเท่านั้น
            แชทเก่าที่มีอยู่ก่อนหน้าจะไม่ไหลเข้ามาเอง ต้องกดปุ่ม
            &quot;ดึงแชทเก่าเข้าระบบ&quot; ที่การ์ดของเพจนั้น
            ระบบจะทยอยดึงเป็นชุด ๆ กดซ้ำได้ไม่มีปัญหา เพราะข้อความที่มีอยู่แล้วจะไม่ถูกบันทึกซ้ำ
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        {initialPages.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <PlatformIcon platform={p.platform} size="md" />
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
              <SyncButton page={p} onDone={() => startTransition(() => router.refresh())} />
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

/* ------------------------------------------------------------------------ */
/* ปุ่มดึงแชทเก่า (รอบ 7)                                                       */
/* ------------------------------------------------------------------------ */

type SyncTally = {
  conversations: number;
  saved: number;
  duplicates: number;
  rounds: number;
};

/**
 * 1 คลิก = ดึงอัตโนมัติ 5 รอบย่อยต่อเนื่อง (รอบละ ~2-3 วินาที)
 * เพื่อดึงเป็นก้อนใหญ่ได้อย่างรวดเร็ว โดยไม่ชน Timeout ของ Vercel
 */
const MAX_ROUNDS_PER_CLICK = 5;

function SyncButton({ page, onDone }: { page: SafePage; onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [tally, setTally] = useState<SyncTally | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const stopRef = useRef(false);

  async function run() {
    if (page.platform === 'instagram') {
      toast.info('Instagram ไม่อนุญาตให้ดึงประวัติแชทย้อนหลังผ่าน API', {
        description: 'ข้อความใหม่ของ Instagram จะไหลเข้าระบบอัตโนมัติผ่าน Webhook เมื่อมีลูกค้าทักเข้ามาครับ',
      });
      return;
    }

    setRunning(true);
    stopRef.current = false;
    const total: SyncTally = { conversations: 0, saved: 0, duplicates: 0, rounds: 0 };
    let next = cursor;
    let problem: string | null = null;

    try {
      for (let round = 0; round < MAX_ROUNDS_PER_CLICK; round += 1) {
        if (stopRef.current) break;

        const res = await fetch(`/api/pages/${page.id}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ after: next }),
        });
        let json: any = null;
        try {
          json = await res.json();
        } catch {
          problem =
            res.status === 504
              ? 'เซิร์ฟเวอร์ใช้เวลาประมวลผลนานเกินกำหนด — กรุณากดดึงอีกครั้ง'
              : `เซิร์ฟเวอร์ตอบกลับรหัสข้อผิดพลาด (${res.status})`;
          break;
        }

        if (!res.ok || !json?.ok) {
          problem = json?.error?.message_th ?? `ดึงแชทเก่าไม่สำเร็จ (${res.status})`;
          break;
        }

        const s = json.data.summary as {
          conversations_seen: number;
          messages_saved: number;
          duplicates: number;
          has_more: boolean;
          next_cursor: string | null;
          error_th: string | null;
        };

        total.conversations += s.conversations_seen;
        total.saved += s.messages_saved;
        total.duplicates += s.duplicates;
        total.rounds += 1;
        setTally({ ...total });

        // ⚠️ ซิงก์ "สำเร็จบางส่วน" ก็ยังนับของที่ได้มา แล้วค่อยหยุด
        if (s.error_th) {
          problem = s.error_th;
          next = s.next_cursor;
          break;
        }

        if (!s.has_more || !s.next_cursor) {
          next = null;
          break;
        }

        // 🔴 กันวนไม่รู้จบ : ถ้า cursor ไม่ขยับ แปลว่าเดินหน้าต่อไม่ได้จริง
        if (s.next_cursor === next) {
          next = null;
          break;
        }
        next = s.next_cursor;
      }
    } catch (err) {
      console.error('[sync] ดึงแชทเก่าไม่สำเร็จ:', err);
      problem = 'ติดต่อเซิร์ฟเวอร์ไม่ได้ระหว่างดึงแชทเก่า';
    } finally {
      setCursor(next ?? null);
      setRunning(false);
      onDone();
    }

    const line =
      `ห้องแชท ${total.conversations} · ข้อความใหม่ ${total.saved} · มีอยู่แล้ว ${total.duplicates}`;

    if (problem) {
      toast.error(problem, { description: `ที่ดึงมาได้แล้วยังอยู่ครบ — ${line}` });
    } else if (total.saved === 0 && total.conversations > 0) {
      toast.success('ซิงก์เรียบร้อย — ไม่มีข้อความใหม่', { description: line });
    } else if (total.conversations === 0) {
      toast.info('Meta ไม่ได้ส่งห้องแชทกลับมาเลย', {
        description:
          'ถ้าเพจมีลูกค้าทักจริง แปลว่า token ยังไม่มีสิทธิ์อ่านกล่องข้อความ — ลองสร้าง token ใหม่ให้ครบสิทธิ์',
      });
    } else {
      toast.success(`ดึงแชทเก่าเข้าระบบแล้ว`, { description: line });
    }
  }

  if (running) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled>
          <Loader2 className="animate-spin" />
          กำลังดึงแชท... {tally ? `(รอบ ${tally.rounds}/${MAX_ROUNDS_PER_CLICK} · ได้ ${tally.conversations} ห้อง · ${tally.saved} ข้อความ)` : '(กำลังเริ่มดึง...)'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            stopRef.current = true;
          }}
        >
          <Square />
          หยุด
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={!page.has_token}>
      <History />
      {cursor ? 'ดึงต่อ (ยังเหลืออีก)' : 'ดึงแชทเก่าเข้าระบบ'}
    </Button>
  );
}
