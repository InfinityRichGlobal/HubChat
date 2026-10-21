'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  ChevronRight,
  Search,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MessageSquare,
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
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import PlatformIcon from '@/components/platform-icon';
import CustomerAvatar from '@/components/customer-avatar';
import { MediaLibraryPicker, type LibraryItem } from '@/components/media-library-picker';
import { commentStatus, mergeCommentPage, type CommentStatus } from '@/lib/comment-feed';
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

function notifySidebarCountsRefresh() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('hubchat:counts-refresh'));
  }
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

export default function CommentsClient({
  initial,
  initialError,
  pages = [],
  canManageBot,
}: {
  initial: Feed;
  initialError: string | null;
  pages?: SafePage[];
  canManageBot: boolean;
}) {
  const [feed, setFeed] = useState(initial);
  const [selectedPageId, setSelectedPageId] = useState('all');
  // เปิดมาที่ "ทั้งหมด" เสมอเพื่อให้เห็นรายการคอมเมนต์ล่าสุดทันที ไม่เจอหน้าว่าง
  const [status, setStatus] = useState<CommentStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState(initialError);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [botSettings, setBotSettings] = useState<CommentBotSettings | null>(null);
  const [botError, setBotError] = useState(false);
  const [selected, setSelected] = useState<CommentRow | null>(null);
  // เก็บข้อความ error ล่าสุดของคอมเมนต์ที่เพิ่งคลิกเปิด เพื่อให้แอดมินยังอ่านสาเหตุได้แม้สถานะแจ้งเตือนถูกเคลียร์ไปแล้ว
  const [lastViewedError, setLastViewedError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const guideDialogRef = useRef<HTMLDialogElement | null>(null);
  const historyRef = useRef(false);
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const syncLock = useRef(false);

  // Fallback สำหรับเบราว์เซอร์ที่ยังไม่รองรับ <dialog closedby="any"> (เช่น Safari)
  useEffect(() => {
    const dialog = guideDialogRef.current;
    if (!dialog) return;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const handleBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      };
      dialog.addEventListener('click', handleBackdropClick);
      return () => dialog.removeEventListener('click', handleBackdropClick);
    }
  }, []);

  function openGuideDialog() {
    const dialog = guideDialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/comments/bot', { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error('bot');
        if (!controller.signal.aborted) setBotSettings(json.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setBotError(true);
      });
    return () => controller.abort();
  }, []);

  const load = useCallback(
    async (cursor?: string): Promise<boolean> => {
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
        setFeed((prev) =>
          cursor ? { ...data, comments: mergeCommentPage(prev.comments, data.comments) } : data,
        );
        setSelected((prev) => (prev ? data.comments.find((c) => c.id === prev.id) ?? prev : null));
        historyRef.current = Boolean(cursor);
        setHistoryLoaded(Boolean(cursor));
        setUpdatedAt(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }));
        setError(null);
        return true;
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : 'ติดต่อเซิร์ฟเวอร์ไม่ได้');
        return false;
      } finally {
        if (!controller.signal.aborted) {
          inFlight.current = false;
          setLoading(false);
        }
      }
    },
    [query, selectedPageId, status],
  );

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (!document.hidden && !historyRef.current && !inFlight.current) void load();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      request.current?.abort();
    };
  }, [load]);

  const currentLoad = useRef(load);
  useEffect(() => {
    currentLoad.current = load;
  }, [load]);

  async function syncFromMeta() {
    if (syncLock.current) return;
    syncLock.current = true;
    setSyncing(true);
    try {
      const result = await api<{
        summary: { comments_saved: number; errors: Array<{ error_th: string }> };
      }>('/api/comments/sync', {
        method: 'POST',
        body: JSON.stringify(selectedPageId === 'all' ? {} : { page_id: selectedPageId }),
      });
      if (!result) return;
      await currentLoad.current();
      notifySidebarCountsRefresh();
      if (result.summary.errors.length) {
        toast.error('ดึงคอมเมนต์ได้ไม่ครบ', {
          description: result.summary.errors.map((e) => e.error_th).join(' · '),
        });
      } else {
        toast.success(
          result.summary.comments_saved > 0
            ? `ดึงคอมเมนต์ใหม่เพิ่ม ${result.summary.comments_saved} รายการ`
            : 'ข้อมูลคอมเมนต์เป็นปัจจุบันแล้ว (ไม่มีรายการใหม่)',
        );
      }
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }

  const replaceComment = useCallback((c: CommentRow) => {
    setSelected(c);
    setFeed((prev) => ({
      ...prev,
      comments: prev.comments.map((x) => (x.id === c.id ? c : x)),
    }));
    void currentLoad.current();
    notifySidebarCountsRefresh();
  }, []);

  /**
   * เมื่อคลิกเปิดดูคอมเมนต์:
   * ถ้าคอมเมนต์ยังเป็น "ยังไม่อ่าน / รอตอบ" หรือ "ส่งไม่สำเร็จ (มีแจ้งเตือนค้าง)"
   * ให้เคลียร์สถานะแจ้งเตือนเป็น "อ่านแล้ว" ทันทีเหมือนหน้าแชท Inbox
   */
  const handleSelectComment = useCallback(
    async (comment: CommentRow) => {
      setDirty(false);
      setBusy(false);
      setLastViewedError(comment.last_error_th);

      const needsAutoRead = !comment.is_handled || comment.last_error_th !== null;
      if (!needsAutoRead) {
        setSelected(comment);
        return;
      }

      const wasPending = !comment.is_handled && comment.last_error_th === null;
      const wasReview = comment.last_error_th !== null;
      const optimistic: CommentRow = {
        ...comment,
        is_handled: true,
        last_error_th: null,
      };

      setSelected(optimistic);
      setFeed((prev) => ({
        ...prev,
        unhandled_count: wasPending ? Math.max(0, prev.unhandled_count - 1) : prev.unhandled_count,
        review_count: wasReview ? Math.max(0, prev.review_count - 1) : prev.review_count,
        comments: prev.comments.map((x) => (x.id === comment.id ? optimistic : x)),
      }));

      try {
        const res = await fetch(`/api/comments/${comment.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'handled', handled: true }),
        });
        const json = await res.json();
        if (res.ok && json.ok && json.data?.comment) {
          const updated = json.data.comment as CommentRow;
          setSelected((curr) => (curr?.id === updated.id ? updated : curr));
          setFeed((prev) => ({
            ...prev,
            comments: prev.comments.map((x) => (x.id === updated.id ? updated : x)),
          }));
        }
      } catch {
        // หากบันทึกเบื้องหลังไม่สำเร็จ รอบถัดไปจะซิงก์สถานะจริงกลับมาเอง
      } finally {
        notifySidebarCountsRefresh();
        void currentLoad.current();
      }
    },
    [],
  );

  /** ปุ่มกดเคลียร์แจ้งเตือนที่ค้างทั้งหมดในคลิกเดียว */
  async function markAllVisibleAsRead() {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      const params = new URLSearchParams({ status: 'all', q: '' });
      if (selectedPageId !== 'all') params.set('page_id', selectedPageId);
      const res = await fetch(`/api/comments?${params}`);
      const json = await res.json();
      const allLoaded: CommentRow[] =
        res.ok && json.ok && Array.isArray(json.data?.comments)
          ? (json.data.comments as CommentRow[])
          : feed.comments;

      const targets = allLoaded.filter((c) => !c.is_deleted && (!c.is_handled || c.last_error_th !== null));
      await Promise.all(
        targets.map((c) =>
          fetch(`/api/comments/${c.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'handled', handled: true }),
          }),
        ),
      );
      await currentLoad.current();
      notifySidebarCountsRefresh();
      toast.success('เคลียร์แจ้งเตือนคอมเมนต์ทั้งหมดเป็นอ่านแล้ว');
    } catch {
      toast.error('เคลียร์แจ้งเตือนไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setMarkingAll(false);
    }
  }

  function closeDetail() {
    if (busy) {
      toast.info('กำลังทำรายการ กรุณารอให้เสร็จก่อน');
      return;
    }
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    setSelected(null);
    setLastViewedError(null);
  }

  const totalAlerts = feed.unhandled_count + feed.review_count;

  const tabs: Array<{ value: typeof status; label: string; count?: number }> = [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'pending', label: 'ยังไม่อ่าน / รอตอบ', count: feed.unhandled_count },
    { value: 'review', label: 'ส่งไม่สำเร็จ', count: feed.review_count },
    { value: 'handled', label: 'อ่าน/ตอบแล้ว' },
    { value: 'deleted', label: 'ลบแล้ว' },
  ];

  const botOn = Boolean(botSettings && (botSettings.auto_reply_public || botSettings.auto_reply_private));
  const selectedIndex = selected ? feed.comments.findIndex((c) => c.id === selected.id) : -1;

  function moveDetail(offset: number) {
    if (busy || dirty) return;
    const next = feed.comments[selectedIndex + offset];
    if (next) void handleSelectComment(next);
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-12">
      {/* ส่วนหัวหน้า + ปุ่มคู่มือวิธีการทำงาน + ปุ่มซิงก์จากเพจ */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">คอมเมนต์ใต้โพสต์</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            คลิกที่คอมเมนต์เพื่อเปิดอ่านและเคลียร์แจ้งเตือนทันที · ตอบใต้โพสต์หรือดึงลูกค้าเข้าแชทได้ในที่เดียว
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={openGuideDialog}
            className="gap-1.5 font-medium"
            {...({ commandfor: 'comment-how-it-works-dialog', command: 'show-modal' } as Record<string, unknown>)}
          >
            <HelpCircle className="size-4 text-primary" />
            ดูวิธีการทำงาน
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void syncFromMeta()}
            disabled={syncing}
            className="gap-2"
          >
            <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
            {syncing ? 'กำลังดึงจากเพจ…' : 'ดึงคอมเมนต์เก่าจากเพจ'}
          </Button>
        </div>
      </div>

      {/* แถบสถานะบอทคอมเมนต์ — อธิบายสั้น กระชับ เข้าใจง่าย */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg',
              botOn
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <Bot className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">
                บอทตอบคอมเมนต์อัตโนมัติ:{' '}
                <span className={cn(botOn ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                  {botError ? 'ตรวจสถานะไม่ได้' : !botSettings ? 'กำลังโหลด…' : botOn ? 'เปิดทำงานอยู่' : 'ปิดอยู่'}
                </span>
              </p>
              {botSettings && (
                <span className="text-xs text-muted-foreground">
                  (ตอบใต้โพสต์: {botSettings.auto_reply_public ? 'เปิด' : 'ปิด'} · ทักแชทส่วนตัว:{' '}
                  {botSettings.auto_reply_private ? 'เปิด' : 'ปิด'} · ไลก์อัตโนมัติ:{' '}
                  {botSettings.auto_like ? 'เปิด' : 'ปิด'})
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              เมื่อมีลูกค้าเมนต์ใหม่เข้ามา บอทจะทำงานให้อัตโนมัติและเปลี่ยนสถานะเป็น{' '}
              <span className="font-medium text-foreground">“อ่าน/ตอบแล้ว”</span> ทันทีโดยไม่ค้างแจ้งเตือน
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={openGuideDialog} className="text-xs">
            ขั้นตอนการทำงาน
          </Button>
          {canManageBot && (
            <Button variant="outline" size="sm" asChild className="h-8 text-xs">
              <Link href="/settings/autoreply?tab=comments">
                ตั้งค่าบอท <ChevronRight className="ml-1 size-3.5" />
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* แถบแจ้งเตือนเมื่อมีรายการยังไม่อ่านหรือส่งไม่สำเร็จ — กดเคลียร์ทั้งหมดได้ในคลิกเดียว */}
      {totalAlerts > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center gap-2.5 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              มีแจ้งเตือนคอมเมนต์ค้างอยู่ <strong>{totalAlerts} รายการ</strong>
              {feed.unhandled_count > 0 && ` (ยังไม่อ่าน/รอตอบ ${feed.unhandled_count})`}
              {feed.review_count > 0 && ` (ส่งคำตอบไม่สำเร็จ ${feed.review_count})`}
              {' · '}คลิกที่รายการเพื่อเปิดอ่าน หรือกดเคลียร์แจ้งเตือนทั้งหมด
            </span>
          </div>
          <div className="flex items-center gap-2">
            {feed.review_count > 0 && status !== 'review' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setStatus('review')}
                className="h-8 text-xs"
              >
                ดูรายการที่ส่งไม่สำเร็จ ({feed.review_count})
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={markingAll}
              onClick={() => void markAllVisibleAsRead()}
              className="h-8 gap-1.5 text-xs"
            >
              {markingAll ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
              เคลียร์แจ้งเตือน (อ่านแล้วทั้งหมด)
            </Button>
          </div>
        </div>
      )}

      {/* ตารางรายการคอมเมนต์ */}
      <section className="overflow-hidden rounded-2xl border bg-card" aria-label="รายการคอมเมนต์">
        {/* แท็บกรองสถานะ */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3" role="group" aria-label="กรองสถานะ">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={status === tab.value}
                onClick={() => setStatus(tab.value)}
                className={cn(
                  'flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs sm:text-sm font-medium transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary',
                  status === tab.value ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-muted-foreground',
                )}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.2 text-xs font-semibold tabular-nums',
                      status === tab.value
                        ? 'bg-primary-foreground/20 text-primary-foreground'
                        : tab.value === 'review'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'bg-primary/15 text-primary',
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {historyLoaded ? 'กลับไปรายการล่าสุด' : 'รีเฟรชรายการ'}
            {updatedAt && ` · ${updatedAt}`}
          </button>
        </div>

        {/* ช่องค้นหาและตัวกรองเพจ */}
        <div className="flex flex-col gap-3 border-b bg-muted/10 p-3.5 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
            <input
              aria-label="ค้นหาคอมเมนต์"
              maxLength={200}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อลูกค้า หรือข้อความในคอมเมนต์…"
              className="h-10 w-full rounded-lg border bg-background pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
            {search && (
              <button
                aria-label="ล้างคำค้นหา"
                onClick={() => setSearch('')}
                className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <select
            aria-label="เลือกเพจ"
            value={selectedPageId}
            onChange={(e) => setSelectedPageId(e.target.value)}
            className="h-10 min-w-0 rounded-lg border bg-background px-3 text-sm sm:max-w-64"
          >
            <option value="all">ทุกเพจ ({pages.length})</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.display_name || page.page_name} ·{' '}
                {page.platform === 'instagram' ? 'Instagram' : 'Facebook'}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div
            role="alert"
            className="m-4 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <AlertTriangle className="size-4" />
            {error} · ข้อมูลที่เห็นอาจไม่ใช่รายการล่าสุด
            <Button variant="outline" size="sm" onClick={() => void load()}>
              ลองใหม่
            </Button>
          </div>
        )}

        {!error && !loading && !feed.comments.length && (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <MessageCircle className="mb-1 size-8 text-muted-foreground/60" />
            <h2 className="font-semibold">
              {query
                ? 'ไม่พบคอมเมนต์ที่ตรงกับคำค้นหา'
                : status === 'pending'
                  ? 'ไม่มีคอมเมนต์ค้างรอตอบ — ทุกคอมเมนต์ถูกอ่านหรือตอบเรียบร้อยแล้ว'
                  : status === 'review'
                    ? 'ไม่มีคอมเมนต์ที่ส่งผิดพลาด'
                    : 'ยังไม่มีรายการคอมเมนต์ในหมวดนี้'}
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              {status !== 'all'
                ? 'กดดูที่แท็บ “ทั้งหมด” เพื่อดูประวัติคอมเมนต์ที่บอทหรือแอดมินตอบไปแล้ว'
                : 'เมื่อลูกค้าคอมเมนต์ใต้โพสต์ รายการจะไหลเข้ามาที่นี่อัตโนมัติ'}
            </p>
            {status !== 'all' && (
              <Button variant="outline" size="sm" onClick={() => setStatus('all')} className="mt-2">
                ดูคอมเมนต์ทั้งหมด
              </Button>
            )}
          </div>
        )}

        {/* รายการคอมเมนต์แต่ละแถว */}
        <div className={cn('divide-y', loading && 'opacity-60')} aria-busy={loading}>
          {feed.comments.map((comment) => {
            const page = pages.find((p) => p.id === comment.page_id);
            const state = commentStatus(comment);
            const isUnreadOrAlert = state === 'pending' || state === 'review';

            return (
              <button
                key={comment.id}
                type="button"
                disabled={loading}
                onClick={() => void handleSelectComment(comment)}
                className={cn(
                  'group flex w-full items-start gap-3.5 p-4 text-left transition hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-5 sm:py-4',
                  isUnreadOrAlert && 'bg-primary/[0.03]',
                )}
              >
                <div className="relative mt-0.5 shrink-0">
                  <CustomerAvatar
                    name={comment.from_name || comment.from_username || 'ลูกค้า'}
                    src={comment.from_pic_url}
                    platform={page?.platform}
                    size="sm"
                  />
                  {isUnreadOrAlert && (
                    <span
                      className={cn(
                        'absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-background',
                        state === 'review' ? 'bg-amber-500' : 'bg-primary',
                      )}
                      title="ยังไม่อ่าน — คลิกเพื่อเปิดดูและเคลียร์แจ้งเตือน"
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  {/* บรรทัดบน: ชื่อลูกค้า + เพจ + เวลา + ป้ายสถานะ */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className={cn('truncate text-sm', isUnreadOrAlert ? 'font-bold text-foreground' : 'font-semibold text-foreground/90')}>
                        {comment.from_name || comment.from_username || 'ลูกค้า (Meta ไม่ส่งชื่อ)'}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        <PlatformIcon platform={page?.platform ?? 'facebook'} size="xs" />
                        <span className="max-w-[120px] truncate">{page?.display_name || page?.page_name || 'เพจ'}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · {timeAgo(comment.commented_at ?? comment.created_at)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {comment.replied_public && (
                        <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
                          ตอบใต้โพสต์แล้ว
                        </span>
                      )}
                      {comment.replied_private && (
                        <span className="rounded-md bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-700 dark:text-purple-300">
                          ทักแชทแล้ว
                        </span>
                      )}
                      <span
                        className={cn(
                          'rounded-md px-2 py-0.5 text-xs font-medium',
                          state === 'review'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            : state === 'pending'
                              ? 'bg-primary/15 text-primary font-semibold'
                              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                        )}
                      >
                        {state === 'review'
                          ? 'ส่งไม่สำเร็จ (คลิกเพื่อดู)'
                          : state === 'pending'
                            ? 'ยังไม่อ่าน / รอตอบ'
                            : state === 'deleted'
                              ? 'ลบแล้ว'
                              : 'อ่าน/จัดการแล้ว'}
                      </span>
                    </div>
                  </div>

                  {/* ข้อความคอมเมนต์ของลูกค้า */}
                  <p className="line-clamp-2 break-words text-sm text-foreground leading-relaxed">
                    {comment.message || (comment.attachment_url ? '📷 คอมเมนต์รูปภาพ' : '(สติกเกอร์ / ไม่มีข้อความ)')}
                  </p>

                  {/* แสดงคำตอบที่บอท/แอดมินตอบไปแล้วให้เห็นทันทีโดยไม่ต้องคลิกเข้าไปดูทีละอัน */}
                  {(comment.public_reply_text || comment.private_reply_text) && (
                    <div className="mt-1 flex flex-col gap-1 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      {comment.public_reply_text && (
                        <p className="line-clamp-1">
                          <span className="font-semibold text-sky-600 dark:text-sky-400">💬 ตอบใต้โพสต์: </span>
                          {comment.public_reply_text}
                        </p>
                      )}
                      {comment.private_reply_text && (
                        <p className="line-clamp-1">
                          <span className="font-semibold text-purple-600 dark:text-purple-400">✉️ ทักส่วนตัว: </span>
                          {comment.private_reply_text}
                        </p>
                      )}
                    </div>
                  )}

                  {comment.last_error_th && (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      ⚠️ {comment.last_error_th} (คลิกเปิดดูเพื่อรับทราบและเคลียร์แจ้งเตือน)
                    </p>
                  )}
                </div>

                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
              </button>
            );
          })}
        </div>

        {feed.has_more && feed.next_cursor && (
          <div className="border-t p-4 text-center">
            <Button variant="outline" disabled={loading} onClick={() => void load(feed.next_cursor!)}>
              {loading ? 'กำลังโหลด…' : 'โหลดคอมเมนต์เพิ่มเติม'}
            </Button>
          </div>
        )}
      </section>

      {/* หน้าต่างรายละเอียดและจัดการคอมเมนต์ */}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>จัดการคอมเมนต์ลูกค้า</DialogTitle>
            <DialogDescription>
              เมื่อเปิดดูรายการนี้ ระบบได้เคลียร์สถานะแจ้งเตือนให้เรียบร้อยแล้ว · คุณสามารถตอบเพิ่มหรือเปิดห้องแชทต่อได้ทันที
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 p-2">
            <span className="px-2 text-xs text-muted-foreground">
              {selectedIndex >= 0
                ? `รายการที่ ${selectedIndex + 1} จาก ${feed.comments.length}`
                : 'รายการที่เลือก'}
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || dirty || selectedIndex <= 0}
                onClick={() => moveDetail(-1)}
              >
                ก่อนหน้า
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || dirty || selectedIndex < 0 || selectedIndex >= feed.comments.length - 1}
                onClick={() => moveDetail(1)}
              >
                ถัดไป <ChevronRight className="size-4" />
              </Button>
            </div>
            {dirty && (
              <p className="w-full px-2 text-xs text-amber-600">
                มีข้อความที่กำลังพิมพ์ค้างอยู่ · กดส่งหรือยกเลิกก่อนเปลี่ยนรายการ
              </p>
            )}
          </div>
          {selected && (
            <CommentCard
              key={selected.id}
              comment={selected}
              previousErrorNote={lastViewedError}
              page={pages.find((p) => p.id === selected.page_id)}
              onChanged={replaceComment}
              setBusy={setBusy}
              onDirtyChange={setDirty}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ยืนยันการทิ้งข้อความร่าง */}
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยังมีข้อความที่ยังไม่ได้ส่ง</DialogTitle>
            <DialogDescription>ต้องการปิดหน้าต่างนี้และทิ้งข้อความที่พิมพ์ไว้หรือไม่?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>
              กลับไปพิมพ์ต่อ
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDiscardOpen(false);
                setDirty(false);
                setSelected(null);
                setLastViewedError(null);
              }}
            >
              ทิ้งข้อความ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* คู่มืออธิบายลำดับการทำงานของระบบคอมเมนต์ (<dialog closedby="any">)   */}
      {/* ================================================================== */}
      <dialog
        ref={guideDialogRef}
        id="comment-how-it-works-dialog"
        {...({ closedby: 'any' } as Record<string, unknown>)}
        aria-labelledby="comment-guide-title"
        className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-2xl border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-xs"
      >
        <div className="flex max-h-[85dvh] flex-col overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
            <div>
              <h2 id="comment-guide-title" className="text-lg font-bold">
                คู่มือการทำงาน: ระบบคอมเมนต์และบอทตอบคอมเมนต์
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                สรุปลำดับการทำงานตั้งแต่ลูกค้าคอมเมนต์ จนถึงการดึงเข้าห้องแชทและการเคลียร์แจ้งเตือน
              </p>
            </div>
            <form method="dialog">
              <button
                type="submit"
                aria-label="ปิดหน้าต่างคู่มือ"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </form>
          </div>

          <div className="space-y-4 overflow-y-auto p-5 text-sm leading-relaxed">
            <div className="rounded-xl border bg-muted/20 p-4">
              <h3 className="font-semibold text-primary">
                ขั้นที่ 1: คอมเมนต์เข้ามาในระบบได้อย่างไร? (2 ช่องทาง)
              </h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs sm:text-sm text-foreground/90">
                <li>
                  <strong>เข้าอัตโนมัติทันที (Webhook):</strong> เมื่อลูกค้าคอมเมนต์ใต้โพสต์เพจ Facebook หรือ Instagram ระบบจะรับเข้ามาแสดงในหน้านี้ภายใน 1–3 วินาที
                </li>
                <li>
                  <strong>กดปุ่ม “ดึงคอมเมนต์เก่าจากเพจ”:</strong> ใช้สำหรับดึงคอมเมนต์เก่าๆ บนโพสต์ที่เกิดก่อนเชื่อมเพจ (การดึงย้อนหลังจะนำเข้าข้อความมาให้อ่านอย่างเดียว บอทจะไม่ไปไล่ตอบคอมเมนต์เก่าซ้ำ)
                </li>
              </ul>
            </div>

            <div className="rounded-xl border bg-muted/20 p-4">
              <h3 className="font-semibold text-emerald-600 dark:text-emerald-400">
                ขั้นที่ 2: บอทตอบคอมเมนต์อัตโนมัติทำงานอย่างไร?
              </h3>
              <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                เมื่อมีคอมเมนต์ใหม่เข้ามา ระบบจะเช็กการตั้งค่าในหน้า <strong>ตั้งค่าบอท</strong> และทำงานตามลำดับนี้:
              </p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs sm:text-sm text-foreground/90">
                <li>
                  <strong>ตรวจคำกรอง (คีย์เวิร์ด):</strong> หากตั้งเป็น <em>“ตอบทุกคอมเมนต์”</em> บอทจะตอบทุกข้อความ แต่หากตั้งเป็น <em>“เฉพาะคีย์เวิร์ด”</em> (เช่น สนใจ, ราคา, CF) บอทจะตอบเฉพาะเมนต์ที่มีคำนั้น
                </li>
                <li>
                  <strong>กดถูกใจ (Like) อัตโนมัติ:</strong> กดไลก์ให้คอมเมนต์ลูกค้าทันที (รองรับ Facebook)
                </li>
                <li>
                  <strong>ตอบกลับใต้โพสต์ (Public Reply):</strong> ถ้าตรงกฎคีย์เวิร์ดจะใช้คำตอบตามกฎนั้น ถ้าไม่ตรงจะให้ <strong>AI (Gemini)</strong> ช่วยคิดคำตอบตามข้อมูลสินค้า หรือใช้ข้อความมาตรฐานที่ตั้งไว้
                </li>
                <li>
                  <strong>ทักแชทส่วนตัว (Private Reply / DM):</strong> ส่งข้อความทักเข้าอินบ็อกซ์ของลูกค้าอัตโนมัติ (Meta กำหนดให้ทักได้ <strong>1 ครั้งต่อ 1 คอมเมนต์</strong> ภายใน 7 วัน) เมื่อลูกค้าตอบกลับมา ห้องแชทจะเด้งเข้าหน้า <strong>อินบ็อกซ์</strong> ทันที
                </li>
              </ol>
            </div>

            <div className="rounded-xl border bg-muted/20 p-4">
              <h3 className="font-semibold text-amber-600 dark:text-amber-400">
                ขั้นที่ 3: สถานะแจ้งเตือนสีแดงทำงานอย่างไร?
              </h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs sm:text-sm text-foreground/90">
                <li>
                  คอมเมนต์ที่ <strong>บอทตอบให้สำเร็จแล้ว</strong> จะถูกทำเครื่องหมายเป็น <strong>“อ่าน/จัดการแล้ว”</strong> อัตโนมัติ ไม่ขึ้นเลขแจ้งเตือนค้างกวนใจ
                </li>
                <li>
                  ตัวเลขแจ้งเตือนจะขึ้นเฉพาะ <strong>คอมเมนต์ที่บอทยังไม่ได้ตอบ</strong> หรือ <strong>ส่งคำตอบไม่สำเร็จ</strong> (เช่น ลูกค้าลบเมนต์ไปแล้ว)
                </li>
                <li>
                  <strong>คลิกเปิดอ่าน = หายแจ้งเตือนทันที:</strong> เพียงแอดมินคลิกเปิดดูคอมเมนต์ หรือกดปุ่ม <strong>“เคลียร์แจ้งเตือน (อ่านแล้วทั้งหมด)”</strong> ตัวเลขแจ้งเตือนจะหายไปทันที
                </li>
              </ul>
            </div>

            <div className="rounded-xl border bg-muted/20 p-4">
              <h3 className="font-semibold text-sky-600 dark:text-sky-400">
                ขั้นที่ 4: ความหมายของปุ่มกดในแต่ละคอมเมนต์
              </h3>
              <div className="mt-2 grid gap-2 text-xs sm:text-sm sm:grid-cols-2">
                <div className="rounded-lg border bg-background p-2.5">
                  <strong>💬 ตอบใต้โพสต์:</strong> พิมพ์ตอบกลับสาธารณะใต้คอมเมนต์ (มีปุ่ม <em>ให้ AI ช่วยคิด</em> ช่วยร่างคำตอบให้)
                </div>
                <div className="rounded-lg border bg-background p-2.5">
                  <strong>✉️ ทักแชทส่วนตัว:</strong> ส่งข้อความเข้าแชท Messenger / IG ของลูกค้าเพื่อดึงเข้า Inbox
                </div>
                <div className="rounded-lg border bg-background p-2.5">
                  <strong>👁️ ซ่อนคอมเมนต์:</strong> ซ่อนไม่ให้คนอื่นเห็นใต้โพสต์ (เช่น เมนต์ที่มีเบอร์โทร/เลขบัญชี หรือสแปม)
                </div>
                <div className="rounded-lg border bg-background p-2.5">
                  <strong>🗑️ ลบคอมเมนต์:</strong> ลบคอมเมนต์นั้นออกจากโพสต์บน Facebook / Instagram ถาวร
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t bg-muted/20 px-5 py-3">
            {canManageBot ? (
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings/autoreply?tab=comments">ไปหน้าตั้งค่าบอทคอมเมนต์</Link>
              </Button>
            ) : (
              <span />
            )}
            <form method="dialog">
              <Button type="submit" size="sm">
                เข้าใจแล้ว ปิดหน้าต่าง
              </Button>
            </form>
          </div>
        </div>
      </dialog>
    </div>
  );
}

/* ================================================================== */
/* คอมโพเนนต์แสดงและตอบคอมเมนต์รายรายการ                               */
/* ================================================================== */

function CommentCard({
  comment: c,
  previousErrorNote,
  page,
  onChanged,
  setBusy,
  onDirtyChange,
}: {
  comment: CommentRow;
  previousErrorNote?: string | null;
  page?: SafePage;
  onChanged: (c: CommentRow) => void;
  setBusy: (v: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [mode, setMode] = useState<'none' | 'public' | 'private'>('none');
  const [text, setText] = useState('');
  const [selectedImage, setSelectedImage] = useState<{
    url: string;
    preview_url: string;
    id?: string;
  } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const actionLock = useRef(false);
  useEffect(() => {
    onDirtyChange(Boolean(text.trim() || selectedImage));
  }, [text, selectedImage, onDirtyChange]);
  useEffect(() => {
    setBusy(sending || aiLoading || uploadingImage);
  }, [sending, aiLoading, uploadingImage, setBusy]);

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
        toast.success('AI ร่างคำตอบให้เรียบร้อยแล้ว');
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
      const d = await api<{
        ok: boolean;
        message_th: string;
        outcome_unknown: boolean;
        comment: CommentRow;
      }>(`/api/comments/${c.id}`, { method: 'POST', body: JSON.stringify(payload) });
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

  const errorMessage = c.last_error_th || previousErrorNote;
  const hasReplied = Boolean(
    c.replied_public || c.replied_private || c.public_reply_text || c.private_reply_text,
  );

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-4 break-words rounded-xl border bg-card p-4 sm:p-5',
        c.is_deleted && 'opacity-60',
      )}
    >
      {/* ส่วนหัว: ข้อมูลผู้คอมเมนต์ + ลิงก์ไปดูโพสต์จริง */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <CustomerAvatar
            name={c.from_name || c.from_username || 'ลูกค้า'}
            src={c.from_pic_url}
            platform={page?.platform}
            size="sm"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-bold text-foreground truncate">
                {c.from_name || c.from_username || 'ไม่ทราบชื่อผู้คอมเมนต์'}
              </span>
              {c.from_username && c.from_username !== c.from_name && (
                <span className="text-xs text-muted-foreground font-mono">@{c.from_username}</span>
              )}
              {page && (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                  <span
                    className="size-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: page.tag_color }}
                  />
                  <span>{page.display_name || page.page_name}</span>
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              คอมเมนต์เมื่อ {timeAgo(c.commented_at ?? c.created_at)}
            </p>
          </div>
        </div>

        {c.post_permalink && (
          <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs">
            <a href={c.post_permalink} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              เปิดดูโพสต์ต้นทาง
            </a>
          </Button>
        )}
      </div>

      {/* ป้ายสถานะปัจจุบันของคอมเมนต์ */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="secondary"
          className={cn(
            'text-xs h-6 font-medium gap-1',
            c.is_handled
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
              : 'bg-primary/10 text-primary border border-primary/20',
          )}
        >
          <Check className="size-3" />
          {c.is_handled ? 'อ่านแล้ว / เคลียร์แจ้งเตือนแล้ว' : 'ยังไม่อ่าน'}
        </Badge>
        {c.replied_public && (
          <Badge
            variant="outline"
            className="text-xs border-sky-500/30 text-sky-700 dark:text-sky-300 bg-sky-500/10 gap-1 h-6 font-normal"
          >
            <MessageSquare className="size-3" /> ตอบใต้โพสต์แล้ว
          </Badge>
        )}
        {c.replied_private && (
          <Badge
            variant="outline"
            className="text-xs border-purple-500/30 text-purple-700 dark:text-purple-300 bg-purple-500/10 gap-1 h-6 font-normal"
          >
            <Send className="size-3" /> ทักส่วนตัวแล้ว
          </Badge>
        )}
        {c.is_liked && (
          <Badge variant="secondary" className="text-xs gap-1 h-6 font-normal">
            <ThumbsUp className="size-3 fill-current text-primary" /> กดถูกใจแล้ว
          </Badge>
        )}
        {c.is_hidden && <Badge variant="secondary" className="text-xs h-6 font-normal">ซ่อนจากหน้าเพจอยู่</Badge>}
        {c.is_deleted && <Badge variant="destructive" className="text-xs h-6 font-normal">ลบแล้ว</Badge>}
        {c.matched_keyword && (
          <Badge className="bg-amber-500 text-xs text-white hover:bg-amber-500 h-6 font-normal">
            ตรงคีย์เวิร์ด: {c.matched_keyword}
          </Badge>
        )}
      </div>

      {/* กล่องข้อความคอมเมนต์ของลูกค้า */}
      <div className="rounded-xl border bg-muted/20 p-3.5">
        <p className="text-xs font-medium text-muted-foreground mb-1">ข้อความที่ลูกค้าคอมเมนต์:</p>
        <p
          className={cn(
            'text-base text-foreground break-words whitespace-pre-wrap leading-relaxed font-medium',
            c.is_deleted && 'line-through text-muted-foreground',
          )}
        >
          {c.message || (c.attachment_url ? '📷 รูปภาพจากลูกค้า' : '(สติกเกอร์ / ไม่มีข้อความ)')}
        </p>
        {c.attachment_url && (
          <a href={c.attachment_url} target="_blank" rel="noreferrer" className="mt-2 block w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={c.attachment_url}
              alt="รูปภาพในคอมเมนต์ของลูกค้า"
              className="max-h-64 max-w-full rounded-lg border object-contain"
            />
          </a>
        )}
      </div>

      {/* แสดงข้อความที่บอทหรือแอดมินตอบกลับไปแล้วให้เห็นชัดเจนทันที */}
      {hasReplied && (
        <div className="rounded-xl border border-border/70 bg-muted/15 p-3.5 space-y-2.5 text-xs">
          <p className="font-semibold text-foreground">ประวัติการตอบกลับของคอมเมนต์นี้:</p>
          {c.public_reply_text && (
            <div className="space-y-1">
              <span className="font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                <MessageSquare className="size-3.5" /> ข้อความที่ตอบใต้โพสต์ (สาธารณะ):
              </span>
              <div className="rounded-lg bg-background p-2.5 border text-foreground whitespace-pre-wrap leading-relaxed text-sm">
                {c.public_reply_text}
              </div>
            </div>
          )}

          {c.private_reply_text && (
            <div className="space-y-1">
              <span className="font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                <Send className="size-3.5" /> ข้อความที่ทักแชทส่วนตัว (Messenger / IG DM):
              </span>
              <div className="rounded-lg bg-background p-2.5 border text-foreground whitespace-pre-wrap leading-relaxed text-sm">
                {c.private_reply_text}
              </div>
            </div>
          )}

          {!c.public_reply_text && !c.private_reply_text && (
            <p className="text-muted-foreground italic">
              ระบบบันทึกว่าตอบกลับแล้ว
            </p>
          )}
        </div>
      )}

      {/* แจ้งเตือนประวัติข้อผิดพลาด (ถ้าเคยมี) */}
      {errorMessage && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-600" />
          <div className="space-y-0.5">
            <p className="font-semibold">หมายเหตุการส่งคำตอบก่อนหน้า:</p>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Dialog ยืนยันการลบ */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันการลบคอมเมนต์</DialogTitle>
            <DialogDescription>
              คุณต้องการลบคอมเมนต์นี้ออกจาก{' '}
              {page?.platform === 'instagram' ? 'Instagram' : 'Facebook'} ใช่หรือไม่? การกระทำนี้ไม่สามารถเรียกคืนได้
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
              ลบคอมเมนต์ถาวร
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
          const fullUrl = item.public_url
            ? toAbsoluteUrl(item.public_url)
            : toAbsoluteUrl(item.preview_url);
          setSelectedImage({
            url: fullUrl,
            preview_url: item.preview_url,
            id: item.id,
          });
          toast.success('เลือกภาพจากคลังสื่อแล้ว');
        }}
      />

      {/* แผงปุ่มกด — แยกหมวดหมู่ชัดเจน ไม่ปนกัน */}
      {mode === 'none' && (
        <div className="space-y-3 border-t pt-3">
          {/* กลุ่มที่ 1: ปุ่มตอบกลับลูกค้า */}
          {!c.is_deleted && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">1. ตอบกลับลูกค้า</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  className="h-9 gap-1.5 text-xs font-medium"
                  onClick={() => {
                    setMode('public');
                    setTimeout(() => textareaRef.current?.focus(), 50);
                  }}
                >
                  <MessageSquare className="size-3.5" />
                  {c.replied_public ? 'ตอบใต้โพสต์เพิ่มอีกครั้ง' : 'ตอบกลับใต้โพสต์ (สาธารณะ)'}
                </Button>

                {!c.replied_private && !oldForPrivate && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5 text-xs font-medium border-purple-500/40 text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-950/30"
                    onClick={() => {
                      setMode('private');
                      setTimeout(() => textareaRef.current?.focus(), 50);
                    }}
                  >
                    <Send className="size-3.5" />
                    ทักแชทส่วนตัว (ดึงเข้า Inbox)
                  </Button>
                )}

                {c.replied_private && (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-purple-500/10 px-2.5 py-1.5 text-xs font-medium text-purple-700 dark:text-purple-300">
                    <Check className="size-3.5" /> ทักแชทส่วนตัวแล้ว (Meta จำกัด 1 ครั้ง/คอมเมนต์)
                  </span>
                )}

                {!c.replied_private && oldForPrivate && (
                  <span className="text-xs text-muted-foreground px-2.5 py-1.5 bg-muted rounded-lg">
                    คอมเมนต์เกิน 7 วัน · ทักส่วนตัวไม่ได้ตามกฎ Meta
                  </span>
                )}

                {c.conversation_id && (
                  <Button size="sm" variant="secondary" asChild className="h-9 gap-1.5 text-xs font-medium">
                    <Link href={`/inbox?c=${c.conversation_id}`}>
                      <MessageCircle className="size-3.5 text-primary" />
                      เปิดห้องแชทใน Inbox
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* กลุ่มที่ 2: จัดการคอมเมนต์บนเพจและสถานะการอ่าน */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">2. จัดการคอมเมนต์บนเพจ</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {!c.is_deleted && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sending || (c.is_liked && page?.platform !== 'instagram')}
                    title={
                      c.is_liked && page?.platform !== 'instagram'
                        ? 'Facebook ไม่รองรับการยกเลิกไลก์ผ่านระบบนี้'
                        : undefined
                    }
                    onClick={() => void act({ action: c.is_liked ? 'unlike' : 'like' })}
                    className={cn('h-8 gap-1.5 text-xs', c.is_liked && 'border-primary/40 text-primary')}
                  >
                    <ThumbsUp className={cn('size-3.5', c.is_liked && 'fill-current')} />
                    {c.is_liked
                      ? page?.platform === 'instagram'
                        ? 'เลิกถูกใจ'
                        : 'ถูกใจแล้ว'
                      : 'กดถูกใจ'}
                  </Button>
                )}

                {!c.is_deleted && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sending}
                    onClick={() => void act({ action: 'hide', hidden: !c.is_hidden })}
                    className="h-8 gap-1.5 text-xs"
                  >
                    {c.is_hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                    {c.is_hidden ? 'เลิกซ่อนจากหน้าเพจ' : 'ซ่อนคอมเมนต์จากเพจ'}
                  </Button>
                )}

                {!c.is_deleted && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sending}
                    onClick={() => setConfirmDelete(true)}
                    className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    ลบคอมเมนต์
                  </Button>
                )}
              </div>

              <Button
                size="sm"
                variant="ghost"
                disabled={sending}
                onClick={() => void act({ action: 'handled', handled: !c.is_handled })}
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Check className={cn('size-3.5', c.is_handled && 'text-emerald-600')} />
                {c.is_handled ? 'ทำเครื่องหมายว่ายังไม่อ่าน' : 'ทำเครื่องหมายว่าอ่านแล้ว'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ฟอร์มตอบกลับ (Public หรือ Private) */}
      {mode !== 'none' && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/[0.02] p-3.5">
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
                  ? '· ทุกคนที่ดูโพสต์จะเห็นข้อความนี้'
                  : '· ส่งเข้าอินบ็อกซ์ลูกค้า (ได้ 1 ครั้งต่อคอมเมนต์)'}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={aiLoading || sending}
                onClick={() => void askAi()}
                className="h-8 gap-1 px-2.5 text-xs text-primary border-primary/30 hover:bg-primary/10 rounded-lg"
              >
                {aiLoading ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Sparkles className="size-3 text-amber-500" />
                )}
                <span>{aiLoading ? 'AI กำลังคิด...' : 'ให้ AI ช่วยคิดคำตอบ'}</span>
              </Button>

              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={sending || uploadingImage || !supportsImage}
                onClick={() => setPickerOpen(true)}
                className="h-8 gap-1 px-2.5 text-xs rounded-lg"
              >
                <ImageIcon className="size-3" />
                <span>คลังสื่อ</span>
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
                className="h-8 gap-1 px-2.5 text-xs rounded-lg"
              >
                {uploadingImage ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Paperclip className="size-3" />
                )}
                <span>แนบรูป</span>
              </Button>
            </div>
          </div>

          {selectedImage && (
            <div className="flex items-center gap-2.5 rounded-lg border bg-background p-2 w-fit">
              <div className="relative size-12 rounded-md overflow-hidden bg-muted border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selectedImage.preview_url} alt="แนบรูป" className="size-full object-cover" />
              </div>
              <div className="flex flex-col gap-0.5 text-xs pr-2">
                <span className="font-medium text-foreground">แนบรูปภาพแล้ว</span>
                <span className="text-xs text-muted-foreground">จะส่งไปพร้อมกับข้อความตอบกลับ</span>
              </div>
              <button
                type="button"
                aria-label="เอารูปแนบออก"
                disabled={sending || aiLoading}
                onClick={() => setSelectedImage(null)}
                className="size-5 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            aria-label={mode === 'public' ? 'ข้อความตอบใต้โพสต์' : 'ข้อความทักส่วนตัว'}
            value={text}
            onChange={handleTextChange}
            placeholder={
              mode === 'public'
                ? 'พิมพ์ข้อความตอบกลับใต้คอมเมนต์... (หรือกดปุ่ม "ให้ AI ช่วยคิดคำตอบ" ด้านบน)'
                : 'พิมพ์ข้อความทักส่วนตัวเข้า Messenger / IG... (เมื่อลูกค้าตอบกลับ แชทจะเด้งเข้าเมนูอินบ็อกซ์)'
            }
            disabled={sending || aiLoading || uploadingImage}
            rows={3}
            maxLength={1000}
            className="w-full min-h-[84px] max-h-[260px] resize-y rounded-xl border bg-background p-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!sending && !aiLoading && !uploadingImage && text.trim()) {
                  void act({
                    action: mode === 'public' ? 'reply_public' : 'reply_private',
                    text: text.trim(),
                  });
                }
              }
            }}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {text.length}/1,000 ตัวอักษร · กด <kbd className="px-1 py-0.5 bg-muted rounded border">Ctrl</kbd>+
              <kbd className="px-1 py-0.5 bg-muted rounded border">Enter</kbd> เพื่อส่ง
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
                className="gap-1.5 font-semibold"
              >
                {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                <span>
                  {sending
                    ? 'กำลังส่ง...'
                    : mode === 'public'
                      ? 'ส่งตอบใต้โพสต์'
                      : 'ส่งทักแชทส่วนตัว'}
                </span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
