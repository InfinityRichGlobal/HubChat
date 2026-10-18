'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  Search,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Send,
  Sparkles,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import PlatformIcon from '@/components/platform-icon';
import CustomerAvatar from '@/components/customer-avatar';
import { MediaLibraryPicker, type LibraryItem } from '@/components/media-library-picker';
import { commentStatus, COMMENT_STATUS_LABEL, mergeCommentPage, type CommentStatus } from '@/lib/comment-feed';
import type { CommentFeed, CommentRow } from '@/server/comments/service';
import type { SafePage } from '@/server/pages/service';
import type { CommentBotSettings } from '@/types/comment-bot';

type Feed = CommentFeed;

const POLL_MS = 20_000;

function timeAgo(iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return 'ไม่ทราบเวลา';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.ที่แล้ว`;
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

/** คอมเมนต์เก่าเกิน 7 วัน = Meta ไม่ให้ทักส่วนตัวแล้ว */
function tooOldForPrivate(iso: string | null): boolean {
  if (!iso || !Number.isFinite(Date.parse(iso))) return true;
  return Date.now() - new Date(iso).getTime() > 7 * 24 * 3_600_000;
}

function toAbsoluteUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (typeof window !== 'undefined') return `${window.location.origin}${url}`;
  return url;
}

async function api<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      toast.error(json?.error?.message_th ?? 'ทำรายการไม่สำเร็จ');
      return null;
    }
    return json.data as T;
  } catch (err) {
    console.error('[comments] เรียก API ไม่สำเร็จ:', url, err);
    toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    return null;
  }
}

export default function CommentsClient({ initial, initialError, pages = [], canManageBot }: {
  initial: Feed; initialError: string | null; pages?: SafePage[]; canManageBot: boolean;
}) {
  const [feed, setFeed] = useState(initial);
  const [selectedPageId, setSelectedPageId] = useState('all');
  const [status, setStatus] = useState<CommentStatus | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(initialError);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [botSettings, setBotSettings] = useState<CommentBotSettings | null>(null);
  const [botError, setBotError] = useState(false);
  const [selected, setSelected] = useState<CommentRow | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyRef = useRef(false);
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const syncLock = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/comments/bot', { signal: controller.signal }).then(async (res) => {
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error('bot');
      if (!controller.signal.aborted) setBotSettings(json.data);
    }).catch(() => { if (!controller.signal.aborted) setBotError(true); });
    return () => controller.abort();
  }, []);

  const load = useCallback(async (cursor?: string): Promise<boolean> => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    inFlight.current = true;
    setLoading(true);
    const params = new URLSearchParams({ status, q: query });
    if (selectedPageId !== 'all') params.set('page_id', selectedPageId);
    if (cursor) params.set('cursor', cursor);
    try {
      const res = await fetch(`/api/comments?${params}`, { signal: controller.signal });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error?.message_th ?? 'โหลดคอมเมนต์ไม่สำเร็จ');
      if (controller.signal.aborted) return false;
      const data = json.data as Feed;
      setFeed((prev) => cursor ? { ...data, comments: mergeCommentPage(prev.comments, data.comments) } : data);
      setSelected((prev) => prev ? data.comments.find((c) => c.id === prev.id) ?? prev : null);
      historyRef.current = Boolean(cursor);
      setHistoryLoaded(Boolean(cursor));
      setUpdatedAt(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }));
      setError(null);
      return true;
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'ติดต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      if (!controller.signal.aborted) { inFlight.current = false; setLoading(false); }
    }
  }, [query, selectedPageId, status]);

  // Polling is read-only. Old responses cannot overwrite a newer filter or a newer page.
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (!document.hidden && !historyRef.current && !inFlight.current) void load();
    }, POLL_MS);
    return () => { clearTimeout(first); clearInterval(timer); request.current?.abort(); };
  }, [load]);
  // A Meta import can outlive a filter change; always reload the current filter afterwards.
  const currentLoad = useRef(load);
  useEffect(() => { currentLoad.current = load; }, [load]);

  async function syncFromMeta() {
    if (syncLock.current) return;
    syncLock.current = true;
    setSyncing(true);
    try {
      const result = await api<{ summary: { comments_saved: number; errors: Array<{ error_th: string }> } }>('/api/comments/sync', {
        method: 'POST', body: JSON.stringify(selectedPageId === 'all' ? {} : { page_id: selectedPageId }),
      });
      if (!result) return;
      await currentLoad.current();
      if (result.summary.errors.length) toast.error('ดึงคอมเมนต์ได้ไม่ครบ', { description: result.summary.errors.map((e) => e.error_th).join(' · ') });
      else toast.success(`เพิ่ม ${result.summary.comments_saved} คอมเมนต์ · ไม่ตอบย้อนหลังอัตโนมัติ`);
    } finally { syncLock.current = false; setSyncing(false); }
  }

  const replaceComment = useCallback((c: CommentRow) => {
    setSelected(c);
    // Refresh the authoritative counters and filtered list immediately after an action.
    setFeed((prev) => ({ ...prev, comments: prev.comments.map((x) => x.id === c.id ? c : x) }));
    void currentLoad.current();
  }, []);
  function closeDetail() {
    if (busy) { toast.info('กำลังทำรายการ กรุณารอให้เสร็จก่อน'); return; }
    if (dirty) { setDiscardOpen(true); return; }
    setSelected(null);
  }
  const tabs: Array<{ value: typeof status; label: string; count?: number }> = [
    { value: 'pending', label: 'รอจัดการ', count: feed.unhandled_count },
    { value: 'review', label: 'ต้องตรวจสอบ', count: feed.review_count },
    { value: 'handled', label: 'จัดการแล้ว' },
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'deleted', label: 'ลบแล้ว' },
  ];
  const botOn = botSettings && (botSettings.auto_reply_public || botSettings.auto_reply_private);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">คอมเมนต์</h1>
          <p className="mt-1 text-sm text-muted-foreground">ดูงานที่รอ ตอบลูกค้า และตรวจผลการตอบจากที่เดียว</p>
        </div>
        <Button variant="outline" onClick={() => void syncFromMeta()} disabled={syncing} className="gap-2">
          <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
          {syncing ? 'กำลังดึงจาก Meta…' : 'ดึงคอมเมนต์จาก Meta'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex items-start gap-3">
          <Bot className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">บอทตอบคอมเมนต์ · {botError ? 'ตรวจสถานะไม่ได้' : !botSettings ? 'กำลังตรวจสถานะ…' : botOn ? 'เปิดอยู่' : 'ปิดอยู่'}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{botSettings ? `ตอบใต้โพสต์: ${botSettings.auto_reply_public ? 'เปิด' : 'ปิด'} · ทักส่วนตัว: ${botSettings.auto_reply_private ? 'เปิด' : 'ปิด'}` : 'สถานะการตั้งค่าบอทจะแสดงเมื่อโหลดสำเร็จ'}<br />การดึงย้อนหลังจะเพิ่มรายการเท่านั้น ไม่สั่งบอทตอบย้อนหลัง</p>
          </div>
        </div>
        {canManageBot && <Button variant="ghost" size="sm" asChild><Link href="/settings/autoreply?tab=comments">ตั้งค่าบอท <ChevronRight className="ml-1 size-4" /></Link></Button>}
      </div>

      <section className="overflow-hidden rounded-2xl border bg-card" aria-label="รายการคอมเมนต์">
        <div className="flex flex-wrap gap-2 border-b p-3" role="group" aria-label="กรองสถานะ">
          {tabs.map((tab) => <button key={tab.value} type="button" aria-pressed={status === tab.value} onClick={() => setStatus(tab.value)} className={cn('flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary', status === tab.value ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>
            {tab.label}{tab.count !== undefined && <span className={cn('rounded-md px-1.5 py-0.5 text-xs tabular-nums', tab.value === 'review' && tab.count ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-muted text-foreground')}>{tab.count}</span>}
          </button>)}
        </div>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
            <input aria-label="ค้นหาคอมเมนต์" maxLength={200} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อลูกค้าหรือข้อความ…" className="h-10 w-full rounded-lg border bg-background pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            {search && <button aria-label="ล้างคำค้นหา" onClick={() => setSearch('')} className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>}
          </div>
          <select aria-label="เลือกเพจ" value={selectedPageId} onChange={(e) => setSelectedPageId(e.target.value)} className="h-10 min-w-0 rounded-lg border bg-background px-3 text-sm sm:max-w-64">
            <option value="all">ทุกเพจ ({pages.length})</option>
            {pages.map((page) => <option key={page.id} value={page.id}>{page.display_name || page.page_name} · {page.platform === 'instagram' ? 'Instagram' : 'Facebook'}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground" aria-live="polite">
          <span>{loading ? 'กำลังโหลดรายการ…' : `${feed.comments.length} รายการที่แสดง${query ? ` · ค้นหา “${query}”` : ''}`}</span>
          <button disabled={loading} onClick={() => void load()} className="inline-flex min-h-8 items-center gap-1.5 hover:text-foreground disabled:opacity-50"><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />{historyLoaded ? 'กลับไปรายการล่าสุด' : 'อัปเดตรายการ'}{updatedAt && ` · ${updatedAt}`}</button>
        </div>
        {error && <div role="alert" className="m-4 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertTriangle className="size-4" />{error} · ข้อมูลที่เห็นอาจไม่ใช่รายการล่าสุด<Button variant="outline" size="sm" onClick={() => void load()}>ลองใหม่</Button></div>}
        {!error && !loading && !feed.comments.length && <div className="flex flex-col items-center gap-2 px-6 py-16 text-center"><MessageCircle className="mb-2 size-8 text-muted-foreground/60" /><h2 className="font-semibold">{query ? 'ไม่พบคอมเมนต์ที่ตรงกับคำค้นหา' : status === 'pending' ? 'ไม่มีคอมเมนต์รอจัดการในรายการที่บันทึกไว้' : 'ไม่มีรายการในตัวกรองนี้'}</h2><p className="max-w-md text-sm leading-relaxed text-muted-foreground">{query ? 'ลองเปลี่ยนคำค้นหาหรือเลือกสถานะ “ทั้งหมด”' : 'เปลี่ยนสถานะหรือเพจเพื่อดูรายการอื่น หากมีคอมเมนต์ใหม่ที่ยังไม่เข้า ใช้ปุ่มดึงคอมเมนต์จาก Meta'}</p></div>}
        <div className={cn('divide-y', loading && 'opacity-60')} aria-busy={loading}>
          {feed.comments.map((comment) => {
            const page = pages.find((p) => p.id === comment.page_id);
            const state = commentStatus(comment);
            return <button key={comment.id} type="button" disabled={loading} onClick={() => { setDirty(false); setBusy(false); setSelected(comment); }} className="group flex w-full items-start gap-3 p-4 text-left transition hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:p-5">
              <CustomerAvatar name={comment.from_name || comment.from_username || 'ลูกค้า'} src={comment.from_pic_url} platform={page?.platform} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><span className="truncate text-sm font-semibold">{comment.from_name || comment.from_username || 'Meta ไม่ส่งชื่อผู้คอมเมนต์'}</span><span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', state === 'review' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : state === 'pending' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{COMMENT_STATUS_LABEL[state]}</span></div>
                <p className="mt-2 line-clamp-2 break-words text-sm leading-relaxed">{comment.message || (comment.attachment_url ? 'คอมเมนต์รูปภาพ' : 'ไม่มีข้อความ')}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><PlatformIcon platform={page?.platform ?? 'facebook'} size="xs" /><span>{page?.display_name || page?.page_name || 'เพจ'}</span><span>· {timeAgo(comment.commented_at ?? comment.created_at)}</span>{comment.replied_public && <span>· ตอบใต้โพสต์แล้ว</span>}{comment.replied_private && <span>· ทักส่วนตัวแล้ว</span>}</div>
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
            </button>;
          })}
        </div>
        {feed.has_more && feed.next_cursor && <div className="border-t p-4 text-center"><Button variant="outline" disabled={loading} onClick={() => void load(feed.next_cursor!)}>{loading ? 'กำลังโหลด…' : 'โหลดคอมเมนต์เพิ่มเติม'}</Button></div>}
        {historyLoaded && <p className="border-t px-4 py-3 text-center text-xs text-muted-foreground">กำลังดูรายการย้อนหลัง · กด “กลับไปรายการล่าสุด” เพื่อรับรายการใหม่</p>}
      </section>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) closeDetail(); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>รายละเอียดคอมเมนต์</DialogTitle><DialogDescription>ตรวจข้อความและผลการตอบก่อนทำรายการ</DialogDescription></DialogHeader>
          {selected && <CommentCard key={selected.id} comment={selected} page={pages.find((p) => p.id === selected.page_id)} onChanged={replaceComment} setBusy={setBusy} onDirtyChange={setDirty} />}
        </DialogContent>
      </Dialog>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent><DialogHeader><DialogTitle>ยังมีข้อความที่ไม่ได้ส่ง</DialogTitle><DialogDescription>ต้องการปิดรายละเอียดและทิ้งข้อความร่างนี้หรือไม่?</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDiscardOpen(false)}>เขียนต่อ</Button><Button variant="destructive" onClick={() => { setDiscardOpen(false); setDirty(false); setSelected(null); }}>ทิ้งข้อความร่าง</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}

/* ================================================================== */
/* คอมโพเนนต์แสดงและตอบคอมเมนต์รายรายการ                               */
/* ================================================================== */

function CommentCard({
  comment: c,
  page,
  onChanged,
  setBusy,
  onDirtyChange,
}: {
  comment: CommentRow;
  page?: SafePage;
  onChanged: (c: CommentRow) => void;
  setBusy: (v: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [mode, setMode] = useState<'none' | 'public' | 'private'>('none');
  const [text, setText] = useState('');
  const [selectedImage, setSelectedImage] = useState<{ url: string; preview_url: string; id?: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showReplies, setShowReplies] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const actionLock = useRef(false);
  useEffect(() => { onDirtyChange(Boolean(text.trim() || selectedImage)); }, [text, selectedImage, onDirtyChange]);
  useEffect(() => { setBusy(sending || aiLoading || uploadingImage); }, [sending, aiLoading, uploadingImage, setBusy]);

  const supportsImage = !(page?.platform === 'instagram' && mode === 'public');
  const oldForPrivate = tooOldForPrivate(c.commented_at);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  };

  async function askAi() {
    setAiLoading(true);
    try {
      const res = await fetch(`/api/comments/${c.id}/ai-suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error?.message_th ?? 'AI คิดคำตอบไม่สำเร็จ');
      }
      if (json.data?.suggestion) {
        setText(json.data.suggestion);
        if (supportsImage && json.data?.image_url && !selectedImage) {
          const absUrl = toAbsoluteUrl(json.data.image_url);
          setSelectedImage({ url: absUrl, preview_url: json.data.image_url });
        }
        if (textareaRef.current) {
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.style.height = 'auto';
              textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 260)}px`;
              textareaRef.current.focus();
            }
          }, 50);
        }
        toast.success('AI จำลองคำตอบตามบอทที่เทรนไว้เรียบร้อยแล้ว');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เรียก AI ไม่สำเร็จ');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/media-library', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error?.message_th ?? 'อัปโหลดภาพไม่สำเร็จ');
      const absUrl = toAbsoluteUrl(json.data.url);
      setSelectedImage({
        url: absUrl,
        preview_url: json.data.url,
        id: json.data.id,
      });
      toast.success('แนบรูปภาพเรียบร้อย');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'อัปโหลดภาพไม่สำเร็จ');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function act(body: Record<string, unknown>) {
    if (actionLock.current || uploadingImage || aiLoading) return;
    const replying = body.action === 'reply_public' || body.action === 'reply_private';
    if (replying && (c.is_deleted || !text.trim())) return;
    actionLock.current = true;
    setSending(true);
    setBusy(true);
    try {
      const payload = { ...body };
      if (replying && supportsImage && selectedImage?.url) {
        payload.attachment_url = selectedImage.url;
      }
      const d = await api<{ ok: boolean; message_th: string; outcome_unknown: boolean; comment: CommentRow }>(
        `/api/comments/${c.id}`,
        { method: 'POST', body: JSON.stringify(payload) },
      );
      if (!d) return;
      onChanged(d.comment);

      if (d.ok) {
        toast.success(d.message_th);
        setMode('none');
        setText('');
        setSelectedImage(null);
      } else if (d.outcome_unknown) {
        toast.warning('ไม่ทราบผล', { description: d.message_th, duration: 12_000 });
      } else {
        toast.error(d.message_th, { duration: 8_000 });
      }
    } finally {
      actionLock.current = false;
      setSending(false);
      setBusy(false);
    }
  }

  const hasReplied = Boolean(c.replied_public || c.replied_private || c.public_reply_text || c.private_reply_text);
  const hasBadges = Boolean(c.is_liked || c.replied_public || c.replied_private || c.is_handled || c.is_hidden || c.is_deleted || c.matched_keyword);

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-4 break-words rounded-xl border bg-card p-4 sm:p-5',
        c.is_handled && 'bg-card/85 border-border/70',
        c.is_deleted && 'opacity-60',
      )}
    >
      {/* แถวหัวข้อ: โปรไฟล์ลูกค้า + เวลา (จัดชิดซ้ายและขวา ไม่เบียดกัน) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative shrink-0">
            <CustomerAvatar
              name={c.from_name || c.from_username || 'ลูกค้า'}
              src={c.from_pic_url}
              platform={page?.platform}
              size="sm"
            />
          </div>

          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate max-w-[140px] sm:max-w-xs">
              {c.from_name || c.from_username || 'ไม่ทราบชื่อ'}
            </span>
            {c.from_username && c.from_username !== c.from_name && (
              <span className="text-xs text-muted-foreground font-mono truncate max-w-[100px]">
                @{c.from_username}
              </span>
            )}
            {page && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground shrink-0">
                <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: page.tag_color }} />
                <span className="max-w-[90px] truncate">{page.display_name || page.page_name}</span>
              </span>
            )}
          </div>
        </div>

        {/* เวลา และ ลิงก์โพสต์ต้นทาง อยู่ขวาบน บรรทัดเดียว สบายตา */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          <span className="whitespace-nowrap">{timeAgo(c.commented_at ?? c.created_at)}</span>
          {c.post_permalink && (
            <a
              href={c.post_permalink}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-primary transition p-0.5"
              title="เปิดดูโพสต์ต้นทาง"
            >
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>

      {/* แถบป้ายสถานะ (จัดเรียงเป็นแถวเฉพาะ ไม่แย่งพื้นที่ชื่อลูกค้า) */}
      {hasBadges && (
        <div className="flex flex-wrap items-center gap-1.5">
          {c.replied_public && (
            <Badge variant="outline" className="text-xs border-sky-500/30 text-sky-600 bg-sky-50 dark:bg-sky-950/30 gap-1 h-6 font-normal">
              <MessageSquare className="size-2.5" /> ตอบแล้ว
            </Badge>
          )}
          {c.replied_private && (
            <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-600 bg-purple-50 dark:bg-purple-950/30 gap-1 h-6 font-normal">
              <Send className="size-2.5" /> ทักส่วนตัวแล้ว
            </Badge>
          )}
          {c.is_liked && (
            <Badge variant="secondary" className="text-xs text-primary border-primary/20 bg-primary/10 gap-1 h-6 font-normal">
              <ThumbsUp className="size-2.5 fill-current" /> ไลก์แล้ว
            </Badge>
          )}
          {c.is_handled && (
            <Badge variant="secondary" className="text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-500/20 gap-1 h-6 font-normal">
              <Check className="size-2.5" /> จัดการแล้ว
            </Badge>
          )}
          {c.is_hidden && <Badge variant="secondary" className="text-xs h-6 font-normal">ซ่อนอยู่</Badge>}
          {c.is_deleted && <Badge variant="destructive" className="text-xs h-6 font-normal">ลบแล้ว</Badge>}
          {c.matched_keyword && (
            <Badge className="bg-amber-500 text-xs text-white hover:bg-amber-500 h-6 font-normal">
              คีย์เวิร์ด: {c.matched_keyword}
            </Badge>
          )}
        </div>
      )}

      {/* เนื้อหาคอมเมนต์ของลูกค้า */}
      <div className="flex flex-col gap-1 px-0.5">
        <p className={cn('text-base text-foreground break-words whitespace-pre-wrap leading-relaxed', c.is_deleted && 'line-through text-muted-foreground')}>
          {c.message || (c.attachment_url ? 'รูปภาพจากลูกค้า' : '(ไม่มีข้อความ)')}
        </p>

        {c.attachment_url && <a href={c.attachment_url} target="_blank" rel="noreferrer" className="my-2 block w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.attachment_url} alt="รูปภาพในคอมเมนต์ของลูกค้า" className="max-h-64 max-w-full rounded-lg border object-contain" />
        </a>}
        {/* ส่วนแสดงข้อความที่เคยตอบกลับไปแล้ว (ปิดตาไว้ก่อน กดดูถึงจะเปิด) */}
        {hasReplied && (
          <div className="flex flex-col gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => setShowReplies(!showReplies)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-medium transition w-fit py-0.5"
            >
              {showReplies ? <EyeOff className="size-3 text-primary" /> : <Eye className="size-3" />}
              <span>{showReplies ? 'ซ่อนข้อความที่ตอบกลับ' : 'ดูข้อความที่ตอบกลับไปแล้ว'}</span>
            </button>

            {showReplies && (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 flex flex-col gap-2 text-xs">
                {c.public_reply_text && (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1 text-xs">
                      <MessageSquare className="size-3" /> ข้อความที่ตอบใต้โพสต์:
                    </span>
                    <div className="rounded-md bg-background/90 p-2 border border-border/40 text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {c.public_reply_text}
                    </div>
                  </div>
                )}

                {c.private_reply_text && (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1 text-xs">
                      <Send className="size-3" /> ข้อความที่ทักแชทส่วนตัว (Messenger / IG DM):
                    </span>
                    <div className="rounded-md bg-background/90 p-2 border border-border/40 text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {c.private_reply_text}
                    </div>
                  </div>
                )}

                {!c.public_reply_text && !c.private_reply_text && (
                  <p className="text-muted-foreground italic text-xs">
                    (ระบบได้บันทึกว่าตอบกลับแล้ว แต่อาจเป็นรายการที่ตอบก่อนเปิดระบบบันทึกข้อความ)
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* กล่องแจ้งเตือนข้อผิดพลาด (ถ้ามี) */}
        {c.last_error_th && (
          <div className="rounded-xl border border-red-200/80 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/30 p-2.5 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5 text-red-500" />
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-red-800 dark:text-red-200">ข้อผิดพลาดในการดำเนินการ:</span>
              <span>{c.last_error_th}</span>
            </div>
          </div>
        )}
      </div>

      {/* Dialog ยืนยันการลบ */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันการลบคอมเมนต์</DialogTitle>
            <DialogDescription>
              คุณต้องการลบคอมเมนต์นี้ออกจาก {page?.platform === 'instagram' ? 'Instagram' : 'Facebook'} ใช่หรือไม่? การกระทำนี้ไม่สามารถเรียกคืนได้
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
              ยกเลิก
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={sending}
              onClick={() => {
                setConfirmDelete(false);
                void act({ action: 'delete' });
              }}
            >
              ลบคอมเมนต์
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal เลือกภาพจากคลังสื่อ */}
      <MediaLibraryPicker
        open={pickerOpen}
        kind="image"
        onClose={() => setPickerOpen(false)}
        onSelect={(item: LibraryItem) => {
          const fullUrl = item.public_url ? toAbsoluteUrl(item.public_url) : toAbsoluteUrl(item.preview_url);
          setSelectedImage({
            url: fullUrl,
            preview_url: item.preview_url,
            id: item.id,
          });
          toast.success('เลือกภาพจากคลังสื่อแล้ว');
        }}
      />

      {/* แถบปุ่มจัดการ (เมื่อไม่ได้เปิดฟอร์มตอบ) */}
      {mode === 'none' && (
        <div className="flex flex-wrap items-center justify-between gap-1 border-t border-border/40 pt-1.5 mt-0">
          {/* แถบปุ่มหลัก (ตอบกลับ / ทักแชท / ไลก์) */}
          <div className="flex flex-wrap items-center gap-1">
            {!c.is_deleted && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1 text-xs font-medium rounded-lg hover:border-primary/50"
                onClick={() => {
                  setMode('public');
                  setTimeout(() => textareaRef.current?.focus(), 50);
                }}
              >
                <MessageSquare className="size-3 text-sky-500" />
                ตอบใต้โพสต์
              </Button>
            )}

            {!c.replied_private && !oldForPrivate && !c.is_deleted && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1 text-xs font-medium rounded-lg text-purple-700 border-purple-200 hover:bg-purple-50 dark:border-purple-900/50 dark:text-purple-400 dark:hover:bg-purple-950/30"
                onClick={() => {
                  setMode('private');
                  setTimeout(() => textareaRef.current?.focus(), 50);
                }}
              >
                <Send className="size-3" />
                ทักส่วนตัว
              </Button>
            )}

            {!c.replied_private && oldForPrivate && !c.is_deleted && (
              <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted/40 rounded">
                {c.commented_at ? 'เกิน 7 วัน · ทักส่วนตัวไม่ได้' : 'ไม่ทราบเวลาคอมเมนต์ · ทักส่วนตัวไม่ได้'}
              </span>
            )}

            {!c.is_deleted && (
              <Button
                size="sm"
                variant="ghost"
                disabled={sending || (c.is_liked && page?.platform !== 'instagram')}
                title={c.is_liked && page?.platform !== 'instagram' ? 'Facebook ไม่รองรับการยกเลิกไลก์ผ่านระบบนี้' : undefined}
                onClick={() => void act({ action: c.is_liked ? 'unlike' : 'like' })}
                className={cn('h-9 gap-1 text-xs rounded-lg px-2', c.is_liked && 'text-primary font-semibold')}
              >
                <ThumbsUp className={cn('size-3', c.is_liked && 'fill-current text-primary')} />
                {c.is_liked ? page?.platform === 'instagram' ? 'เลิกถูกใจ' : 'ถูกใจแล้ว' : 'ถูกใจ'}
              </Button>
            )}

            {/* ถ้าตอบครบทั้งสองแบบแล้ว */}
            {c.replied_public && c.replied_private && !c.last_error_th && (
              <span className="text-xs text-muted-foreground py-0.5">
                ตอบกลับครบแล้ว
              </span>
            )}
          </div>

          {/* ปุ่มจัดการเสริม (ซ่อน, จัดการแล้ว, ลบ, ไปที่แชท) */}
          <div className="flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={sending}
              onClick={() => void act({ action: 'handled', handled: !c.is_handled })}
              className="h-9 gap-1 text-xs text-muted-foreground hover:text-foreground rounded-lg px-2"
              title={c.is_handled ? 'กดเพื่อทำเครื่องหมายว่ายังไม่จัดการ' : 'กดเมื่อจัดการเสร็จแล้ว'}
            >
              <Check className={cn('size-3.5', c.is_handled && 'text-emerald-600 font-bold')} />
              <span>{c.is_handled ? 'ย้ายกลับรอจัดการ' : 'ทำเครื่องหมายว่าเสร็จ'}</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="การจัดการเพิ่มเติม" disabled={sending} variant="ghost" size="icon" className="size-9 rounded-lg text-muted-foreground">
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40 text-xs">
                {!c.is_deleted && (
                  <DropdownMenuItem
                    className="cursor-pointer gap-2"
                    onClick={() => void act({ action: 'hide', hidden: !c.is_hidden })}
                  >
                    {c.is_hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                    <span>{c.is_hidden ? 'เลิกซ่อนคอมเมนต์' : 'ซ่อนคอมเมนต์'}</span>
                  </DropdownMenuItem>
                )}

                {c.conversation_id && (
                  <DropdownMenuItem asChild className="cursor-pointer gap-2">
                    <Link href={`/inbox?c=${c.conversation_id}`}>
                      <MessageCircle className="size-3.5" />
                      <span>เปิดห้องแชท</span>
                    </Link>
                  </DropdownMenuItem>
                )}

                {!c.is_deleted && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="cursor-pointer gap-2 text-destructive focus:text-destructive"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="size-3.5" />
                      <span>ลบคอมเมนต์</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {/* ฟอร์มตอบกลับ (Public หรือ Private) */}
      {mode !== 'none' && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/[0.02] p-3.5">
          {/* ส่วนหัวกล่องตอบกลับ */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                {mode === 'public' ? (
                  <>
                    <MessageSquare className="size-3.5 text-sky-500" />
                    ตอบกลับใต้โพสต์ (สาธารณะ)
                  </>
                ) : (
                  <>
                    <Send className="size-3.5 text-purple-600" />
                    ทักแชทส่วนตัว (Messenger / IG DM)
                  </>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {mode === 'public'
                  ? '· ทุกคนบนโซเชียลจะเห็นข้อความนี้'
                  : '· ส่งได้ 1 ครั้งต่อคอมเมนต์ (กฎ 7 วันของ Meta)'}
              </span>
            </div>

            {/* เครื่องมือช่วยคิด/แนบสื่อ */}
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={aiLoading || sending}
                onClick={() => void askAi()}
                className="h-9 gap-1 px-2.5 text-xs text-primary border-primary/30 hover:bg-primary/10 rounded-lg"
              >
                {aiLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3 text-amber-500" />}
                <span>{aiLoading ? 'AI กำลังจำลอง...' : 'ให้ AI ช่วยคิด'}</span>
              </Button>

              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={sending || uploadingImage || !supportsImage}
                onClick={() => setPickerOpen(true)}
                className="h-9 gap-1 px-2.5 text-xs rounded-lg text-muted-foreground hover:text-foreground"
                title="เลือกรูปจากคลังสื่อ"
              >
                <ImageIcon className="size-3" />
                <span className="hidden sm:inline">คลังสื่อ</span>
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handleFileUpload(e)}
              />

              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={sending || uploadingImage || !supportsImage}
                onClick={() => fileInputRef.current?.click()}
                className="h-9 gap-1 px-2.5 text-xs rounded-lg text-muted-foreground hover:text-foreground"
                title="อัปโหลดรูปจากอุปกรณ์"
              >
                {uploadingImage ? <Loader2 className="size-3 animate-spin" /> : <Paperclip className="size-3" />}
                <span className="hidden sm:inline">แนบรูป</span>
              </Button>
            </div>
          </div>

          {/* พรีวิวรูปภาพที่แนบ (ถ้ามี) */}
          {selectedImage && (
            <div className="flex items-center gap-2.5 rounded-lg border bg-background p-2 w-fit">
              <div className="relative size-12 rounded-md overflow-hidden bg-muted border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selectedImage.preview_url} alt="แนบรูป" className="size-full object-cover" />
              </div>
              <div className="flex flex-col gap-0.5 text-xs pr-2">
                <span className="font-medium text-foreground">แนบรูปภาพแล้ว</span>
                <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                  จะถูกส่งไปพร้อมกับข้อความตอบกลับ
                </span>
              </div>
              <button
                type="button"
                aria-label="เอารูปแนบออก"
                disabled={sending || aiLoading}
                onClick={() => setSelectedImage(null)}
                className="size-5 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition"
              >
                <X className="size-3" />
              </button>
            </div>
          )}

          {/* กล่องพิมพ์ข้อความหลายบรรทัด (Textarea ขยายได้) */}
          <textarea
            ref={textareaRef}
            aria-label={mode === 'public' ? 'ข้อความตอบใต้โพสต์' : 'ข้อความทักส่วนตัว'}
            value={text}
            onChange={handleTextChange}
            placeholder={
              mode === 'public'
                ? 'พิมพ์ข้อความตอบกลับใต้คอมเมนต์... (เช่น ขอบคุณที่สนใจครับ สินค้าพร้อมส่งนะคะ)'
                : 'พิมพ์ข้อความทักส่วนตัวเข้า Messenger / IG... (เช่น สวัสดีค่ะ แอดมินทักมาให้ข้อมูลโปรโมชั่นเพิ่มเติมนะคะ)'
            }
            disabled={sending || aiLoading || uploadingImage}
            rows={3}
            maxLength={1000}
            className="w-full min-h-[84px] max-h-[260px] resize-y rounded-xl border bg-background p-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20 transition placeholder:text-muted-foreground/60"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!sending && !aiLoading && !uploadingImage && text.trim()) {
                  void act({ action: mode === 'public' ? 'reply_public' : 'reply_private', text: text.trim() });
                }
              }
            }}
          />

          <p className="text-xs text-muted-foreground">{text.length}/1,000 ตัวอักษร · ต้องมีข้อความก่อนส่ง{!supportsImage ? ' · การตอบใต้โพสต์ Instagram รองรับข้อความเท่านั้น' : selectedImage && mode === 'private' ? ' · รูปภาพในข้อความส่วนตัวจะส่งเป็นลิงก์' : ''}</p>
          {/* แถบล่างของกล่องตอบกลับ */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-xs text-muted-foreground">
              กด <kbd className="px-1 py-0.5 bg-muted rounded text-xs font-mono border">Ctrl</kbd> + <kbd className="px-1 py-0.5 bg-muted rounded text-xs font-mono border">Enter</kbd> หรือกดปุ่มส่ง
            </span>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={sending || aiLoading || uploadingImage}
                onClick={() => {
                  setMode('none');
                  setText('');
                  setSelectedImage(null);
                }}
                className="h-8 text-xs rounded-lg"
              >
                ยกเลิก
              </Button>

              <Button
                type="button"
                size="sm"
                disabled={sending || aiLoading || uploadingImage || c.is_deleted || !text.trim()}
                onClick={() =>
                  void act({
                    action: mode === 'public' ? 'reply_public' : 'reply_private',
                    text: text.trim(),
                  })
                }
                className="h-8 gap-1.5 text-xs font-semibold px-4 rounded-lg shadow-xs"
              >
                {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                <span>{sending ? 'กำลังส่ง...' : mode === 'public' ? 'ส่งตอบใต้โพสต์' : 'ส่งทักส่วนตัว'}</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
