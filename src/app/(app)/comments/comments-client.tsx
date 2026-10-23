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
import CustomerAvatar from '@/components/customer-avatar';
import CommentNavigation from '@/components/comment-navigation';
import { MediaLibraryPicker, type LibraryItem } from '@/components/media-library-picker';
import { commentStatus, mergeCommentPage, type CommentStatus } from '@/lib/comment-feed';
import type { CommentFeed, CommentRow } from '@/server/comments/service';
import type { SafePage } from '@/server/pages/service';
import type { CommentBotSettings } from '@/types/comment-bot';

function ReplyIdentity({ comment, channel }: { comment: CommentRow; channel: 'public' | 'private' }) {
  const actor = comment[`${channel}_responder`];
  const at = comment[`${channel}_reply_at`];
  return <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
    {actor?.kind === 'bot' ? <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><Bot className="size-3" aria-hidden="true" /></span>
      : <CustomerAvatar name={actor?.name ?? '?'} src={actor?.avatar_url} mode="real_profile" showBadge={false} size="sm" className="size-5 text-[9px]" />}
    <span>{actor?.name ?? 'ไม่ทราบผู้ตอบ'} · {channel === 'public' ? 'ตอบใต้โพสต์' : 'ทักส่วนตัว'}</span>
    {at && <time dateTime={at} title={new Date(at).toLocaleString('th-TH')}>{timeAgo(at)}</time>}
  </span>;
}

type Feed = CommentFeed;

const POLL_MS = 20_000;

function timeAgo(iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return 'ไม่ทราบเวลา';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `${min} นาที`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.`;
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
  const [status, setStatus] = useState<CommentStatus | 'all' | 'unanswered' | 'replied'>('all');
  const [groupPosts, setGroupPosts] = useState(false);
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

  // Fallback สำหรับเบราว์เซอร์ที่ยังไม่รองรับ <dialog closedby="any">
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
            : 'ข้อมูลคอมเมนต์เป็นปัจจุบันแล้ว',
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

  /** คลิกเปิดดู = เคลียร์แจ้งเตือนเป็นอ่านแล้วทันที */
  const handleSelectComment = useCallback(async (comment: CommentRow) => {
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
      // รอบถัดไปจะซิงก์สถานะจริงกลับมาเอง
    } finally {
      notifySidebarCountsRefresh();
      void currentLoad.current();
    }
  }, []);

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

      const targets = allLoaded.filter(
        (c) => !c.is_deleted && (!c.is_handled || c.last_error_th !== null),
      );
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
      toast.success('เคลียร์แจ้งเตือนคอมเมนต์ทั้งหมดแล้ว');
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
  const botOn = Boolean(
    botSettings && (botSettings.auto_reply_public || botSettings.auto_reply_private),
  );
  const selectedIndex = selected ? feed.comments.findIndex((c) => c.id === selected.id) : -1;

  function moveDetail(offset: number) {
    if (busy || dirty) return;
    const next = feed.comments[selectedIndex + offset];
    if (next) void handleSelectComment(next);
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col p-2 md:p-3 pb-12">
      {/* การ์ดหลักใบเดียวทรงเดียวกับหน้า กล่องข้อความ (Inbox) กระชับ ไม่กินพื้นที่บนมือถือ */}
      <section
        className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xs"
        aria-label="รายการคอมเมนต์"
      >
        {/* ส่วนควบคุมด้านบนแบบกระชับ 2 บรรทัด (เหมือนหน้า กล่องข้อความ) */}
        <div className="flex flex-col gap-1.5 px-2.5 py-2">
          {/* บรรทัดที่ 1: ชื่อหน้า + ช่องค้นหา + ปุ่มวิธีทำงาน/ซิงก์/รีเฟรช อยู่บรรทัดเดียวกัน */}
          <div className="flex items-center gap-1.5">
            <h1 className="text-sm font-semibold tracking-tight shrink-0">คอมเมนต์</h1>

            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="ค้นหาคอมเมนต์"
                maxLength={200}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อ หรือข้อความ…"
                className="h-7.5 w-full rounded-full border bg-muted/40 pl-7 pr-7 text-xs outline-none focus:ring-2 focus:ring-primary/30"
              />
              {search && (
                <button
                  type="button"
                  aria-label="ล้างคำค้นหา"
                  onClick={() => setSearch('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-muted"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={openGuideDialog}
                className="inline-flex h-7 items-center gap-1 rounded-full border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted transition"
                title="ดูวิธีการทำงานของระบบคอมเมนต์"
                {...({
                  commandfor: 'comment-how-it-works-dialog',
                  command: 'show-modal',
                } as Record<string, unknown>)}
              >
                <HelpCircle className="size-3 text-primary" />
                <span>วิธีทำงาน</span>
              </button>

              <button
                type="button"
                disabled={syncing}
                onClick={() => void syncFromMeta()}
                className="inline-flex h-7 items-center gap-1 rounded-full border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50 transition"
                title="ดึงคอมเมนต์เก่าจากเพจ Facebook / IG"
              >
                <RefreshCw className={cn('size-3', syncing && 'animate-spin')} />
                <span>{syncing ? 'ดึง…' : 'ซิงก์เพจ'}</span>
              </button>

              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={loading}
                aria-label="อัปเดตรายการคอมเมนต์"
                onClick={() => void load()}
              >
                <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>

          {/* บรรทัดที่ 2: แท็บสถานะ + ตัวเลือกเพจ + สถานะบอท/ตั้งค่าบอท รวมอยู่บรรทัดเดียวกัน */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            <div
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted/60 p-0.5"
              role="group"
              aria-label="กรองสถานะ"
            >
              {(
                [
                  { value: 'all', label: 'ทั้งหมด' },
                  { value: 'unanswered', label: 'รอตอบ' },
                  { value: 'replied', label: 'ตอบแล้ว' },
                  { value: 'pending', label: 'ยังไม่อ่าน', count: feed.unhandled_count },
                  { value: 'review', label: 'ต้องตรวจสอบ', count: feed.review_count },
                  { value: 'handled', label: 'อ่านแล้ว' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  aria-pressed={status === tab.value}
                  onClick={() => setStatus(tab.value)}
                  className={cn(
                    'inline-flex h-6.5 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-primary',
                    status === tab.value
                      ? 'bg-background text-primary shadow-xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span>{tab.label}</span>
                  {'count' in tab && tab.count !== undefined && tab.count > 0 && (
                    <span
                      className={cn(
                        'rounded-full px-1 text-[10px] font-bold tabular-nums',
                        tab.value === 'review'
                          ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                          : 'bg-primary/15 text-primary',
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {/* ตัวเลือกเพจแบบ Pill กระชับ */}
            <select
              aria-label="เลือกเพจ"
              value={selectedPageId}
              onChange={(e) => setSelectedPageId(e.target.value)}
              className={cn(
                'h-7 shrink-0 rounded-full border px-2.5 text-xs outline-none transition-colors cursor-pointer',
                selectedPageId !== 'all'
                  ? 'border-primary bg-primary text-primary-foreground font-medium'
                  : 'bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              <option value="all">ทุกเพจ ({pages.length})</option>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.display_name || page.page_name} (
                  {page.platform === 'instagram' ? 'IG' : 'FB'})
                </option>
              ))}
            </select>

            {/* ชิปสถานะบอท (คลิกเพื่อดูวิธีทำงาน) */}
            <button
              type="button"
              onClick={openGuideDialog}
              className={cn(
                'inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs whitespace-nowrap transition-colors',
                botOn
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'bg-background text-muted-foreground hover:text-foreground',
              )}
              title="คลิกเพื่อดูขั้นตอนการทำงานของบอทคอมเมนต์"
            >
              <Bot className="size-3.5 shrink-0" />
              <span>
                บอท:{' '}
                {botError
                  ? 'ตรวจไม่ได้'
                  : !botSettings
                    ? '…'
                    : botOn
                      ? `เปิด (${[
                          botSettings.auto_reply_public && 'โพสต์',
                          botSettings.auto_reply_private && 'แชท',
                          botSettings.auto_like && 'ไลก์',
                        ]
                          .filter(Boolean)
                          .join('·')})`
                      : 'ปิดอยู่'}
              </span>
            </button>

            {/* ปุ่มลัดไปตั้งค่าบอท */}
            {canManageBot && (
              <Link
                href="/settings/autoreply?tab=comments"
                className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-full border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 whitespace-nowrap transition-colors"
              >
                <span>ตั้งค่าบอท</span>
                <ChevronRight className="size-3" />
              </Link>
            )}

            {/* ชิปดูรายการที่ลบแล้ว */}
            <button
              type="button"
              onClick={() => setStatus(status === 'deleted' ? 'all' : 'deleted')}
              className={cn(
                'inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs whitespace-nowrap transition-colors',
                status === 'deleted'
                  ? 'border-primary bg-primary text-primary-foreground font-medium'
                  : 'bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              <span>ลบแล้ว</span>
            </button>

            {/* ปุ่มเคลียร์แจ้งเตือนทั้งหมด (แสดงเฉพาะเมื่อมีแจ้งเตือนค้าง) */}
            {totalAlerts > 0 && (
              <button
                type="button"
                disabled={markingAll}
                onClick={() => void markAllVisibleAsRead()}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 text-xs font-medium text-primary hover:bg-primary/15 whitespace-nowrap transition-colors disabled:opacity-50"
              >
                {markingAll ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <CheckCheck className="size-3" />
                )}
                <span>อ่านแล้วทั้งหมด ({totalAlerts})</span>
              </button>
            )}
          </div>
        </div>

        {/* แถบสรุปจำนวนรายการแบบบาง (ทรงเดียวกับ Inbox) */}
        <div
          className="flex items-center justify-between border-y bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground"
          aria-live="polite"
        >
          <span>
            {loading
              ? 'กำลังอัปเดตรายการ…'
              : `${feed.comments.length} คอมเมนต์ที่แสดง${query ? ` · ค้นหา “${query}”` : ''}`}
          </span>
          <span>
            {historyLoaded ? (
              <button
                type="button"
                onClick={() => void load()}
                className="font-medium text-primary hover:underline"
              >
                กลับไปรายการล่าสุด
              </button>
            ) : updatedAt ? (
              `อัปเดตล่าสุด ${updatedAt}`
            ) : (
              'โหลดรายการครบแล้ว'
            )}
          </span>
        </div>

        {error && (
          <div
            role="alert"
            className="m-3 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive"
          >
            <AlertTriangle className="size-3.5" />
            <span>{error}</span>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void load()}>
              ลองใหม่
            </Button>
          </div>
        )}

        {!error && !loading && !feed.comments.length && (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <MessageCircle className="size-7 text-muted-foreground/60" />
            <p className="text-sm font-medium">
              {query
                ? 'ไม่พบคอมเมนต์ที่ตรงกับคำค้นหา'
                : status === 'pending'
                  ? 'ไม่มีคอมเมนต์ค้างรอตอบ'
                  : status === 'review'
                    ? 'ไม่มีคอมเมนต์ที่ส่งผิดพลาด'
                    : 'ยังไม่มีรายการคอมเมนต์ในหมวดนี้'}
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {status !== 'all'
                ? 'สลับไปที่แท็บ “ทั้งหมด” เพื่อดูประวัติคอมเมนต์ที่บอทหรือแอดมินตอบแล้ว'
                : 'เมื่อลูกค้าคอมเมนต์ใต้โพสต์ รายการจะแสดงที่นี่อัตโนมัติ'}
            </p>
            {status !== 'all' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatus('all')}
                className="mt-1 h-8 text-xs"
              >
                ดูคอมเมนต์ทั้งหมด
              </Button>
            )}
          </div>
        )}

        <label className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={groupPosts} onChange={e => setGroupPosts(e.target.checked)} className="accent-primary" />
          รวมตามโพสต์ <span className="ml-auto">เฉพาะรายการที่โหลดแล้ว</span>
        </label>
        {/* รายการคอมเมนต์แต่ละแถว — กระชับเป็นระเบียบทรงเดียวกับรายการแชทใน Inbox */}
        <ul className={cn('divide-y', loading && 'opacity-60')} aria-busy={loading}>
          {(groupPosts ? [...feed.comments].sort((a, b) => `${a.page_id}:${a.post_id ?? a.id}`.localeCompare(`${b.page_id}:${b.post_id ?? b.id}`)) : feed.comments).map((comment, index, visible) => {
            const page = pages.find((p) => p.id === comment.page_id);
            const state = commentStatus(comment);
            const isUnreadOrAlert = state === 'pending' || state === 'review';

            return (
              <li key={comment.id}>
                {groupPosts && (index === 0 || visible[index - 1].page_id !== comment.page_id || visible[index - 1].post_id !== comment.post_id || !comment.post_id) && (
                  <div className="flex items-center justify-between gap-2 border-y bg-muted/60 px-3 py-2 text-xs">
                    <span className="truncate font-medium">{page?.page_name ?? 'เพจ'} · {comment.post_id ? `โพสต์ …${comment.post_id.slice(-8)}` : 'ไม่ทราบโพสต์'}</span>
                    {comment.post_permalink && <a href={comment.post_permalink} target="_blank" rel="noreferrer" className="shrink-0 text-primary underline">เปิดโพสต์</a>}
                  </div>
                )}
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void handleSelectComment(comment)}
                  className={cn(
                    'group relative flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
                    isUnreadOrAlert && 'bg-primary/[0.03]',
                  )}
                >
                  {/* รูปโปรไฟล์ + จุดแจ้งเตือน */}
                  <div className="relative shrink-0">
                    <CustomerAvatar
                      name={comment.from_name || comment.from_username || 'ลูกค้า'}
                      src={comment.from_pic_url}
                      platform={page?.platform}
                      size="md"
                    />
                    {isUnreadOrAlert && (
                      <span
                        className={cn(
                          'absolute -top-0.5 -right-0.5 z-10 size-3 rounded-full ring-2 ring-background',
                          state === 'review' ? 'bg-amber-500' : 'bg-red-600',
                        )}
                        title="ยังไม่อ่าน — คลิกเพื่อเปิดดูและเคลียร์แจ้งเตือน"
                      />
                    )}
                  </div>

                  {/* เนื้อหา 3 บรรทัดกระชับเหมือน Inbox */}
                  <div className="min-w-0 flex-1">
                    {/* บรรทัด 1: ชื่อลูกค้า + เวลา */}
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-sm leading-5',
                          isUnreadOrAlert ? 'font-semibold text-foreground' : 'font-medium text-foreground',
                        )}
                      >
                        {comment.from_name || comment.from_username || 'ลูกค้า (Meta ไม่ส่งชื่อ)'}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                        {timeAgo(comment.commented_at ?? comment.created_at)}
                      </span>
                    </div>

                    {/* บรรทัด 2: ข้อความคอมเมนต์ของลูกค้า */}
                    <p
                      className={cn(
                        'mt-0.5 truncate text-xs leading-5',
                        isUnreadOrAlert ? 'font-medium text-foreground' : 'text-foreground/90',
                      )}
                    >
                      {comment.message ||
                        (comment.attachment_url ? '📷 คอมเมนต์รูปภาพ' : '(สติกเกอร์ / ไม่มีข้อความ)')}
                    </p>

                    {/* บรรทัด 2.5 (ถ้าบอท/แอดมินตอบแล้ว): พรีวิวคำตอบบรรทัดเดียวแบบบาง */}
                    {(comment.public_reply_text || comment.private_reply_text) && (
                      <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
                        <span className="font-medium text-sky-600 dark:text-sky-400">↳ </span>
                        {comment.public_reply_text || comment.private_reply_text}
                      </p>
                    )}

                    {comment.public_reply_text && <ReplyIdentity comment={comment} channel="public" />}
                    {comment.private_reply_text && <ReplyIdentity comment={comment} channel="private" />}
                    {comment.last_error_th && (
                      <p className="mt-0.5 truncate text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        ⚠️ {comment.last_error_th}
                      </p>
                    )}

                    {/* บรรทัด 3: ป้ายชิปขนาดเล็ก (เพจ · สถานะตอบ · สถานะอ่าน) ทรงเดียวกับ Inbox */}
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5">
                        <span
                          className="size-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: page?.tag_color ?? '#3b82f6' }}
                        />
                        <span className="max-w-[110px] truncate">
                          {page?.display_name || page?.page_name || 'เพจ'}
                        </span>
                      </span>

                      {comment.replied_public && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-sky-700 dark:text-sky-300">
                          ตอบโพสต์แล้ว
                        </span>
                      )}

                      {comment.replied_private && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-purple-500/10 px-1.5 py-0.5 text-purple-700 dark:text-purple-300">
                          ทักแชทแล้ว
                        </span>
                      )}

                      {state === 'pending' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
                          <span className="size-1.5 rounded-full bg-destructive" /> ยังไม่อ่าน
                        </span>
                      )}

                      {state === 'review' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                          ต้องตรวจ
                        </span>
                      )}

                      {state === 'handled' && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          ✓ เรียบร้อย
                        </span>
                      )}

                      {state === 'deleted' && (
                        <span className="inline-flex items-center rounded-full bg-destructive/10 px-1.5 py-0.5 text-destructive">
                          ลบแล้ว
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        {feed.has_more && feed.next_cursor && (
          <div className="flex justify-center border-t p-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void load(feed.next_cursor!)}
            >
              {loading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              โหลดคอมเมนต์เพิ่ม
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
              เปิดอ่านแล้วระบบเคลียร์แจ้งเตือนให้อัตโนมัติ · ตอบเพิ่มหรือเปิดห้องแชทต่อได้ทันที
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
              <h2 id="comment-guide-title" className="text-base sm:text-lg font-bold">
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

          <div className="space-y-3.5 overflow-y-auto p-4 sm:p-5 text-xs sm:text-sm leading-relaxed">
            <div className="rounded-xl border bg-muted/20 p-3.5">
              <h3 className="font-semibold text-primary">
                ขั้นที่ 1: คอมเมนต์เข้ามาในระบบได้อย่างไร? (2 ช่องทาง)
              </h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-foreground/90">
                <li>
                  <strong>เข้าอัตโนมัติทันที (Webhook):</strong> เมื่อลูกค้าคอมเมนต์ใต้โพสต์เพจ Facebook หรือ Instagram ระบบจะรับเข้ามาแสดงในหน้านี้ภายใน 1–3 วินาที
                </li>
                <li>
                  <strong>กดปุ่ม “ดึงจากเพจ (ซิงก์)”:</strong> ใช้ดึงคอมเมนต์เก่าๆ บนโพสต์ที่เกิดก่อนเชื่อมเพจ (การดึงย้อนหลังจะนำเข้าข้อความมาให้อ่านอย่างเดียว บอทจะไม่ไปไล่ตอบคอมเมนต์เก่าซ้ำ)
                </li>
              </ul>
            </div>

            <div className="rounded-xl border bg-muted/20 p-3.5">
              <h3 className="font-semibold text-emerald-600 dark:text-emerald-400">
                ขั้นที่ 2: บอทตอบคอมเมนต์อัตโนมัติทำงานอย่างไร?
              </h3>
              <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-foreground/90">
                <li>
                  <strong>ตรวจคำกรอง (คีย์เวิร์ด):</strong> หากตั้งเป็น <em>“ตอบทุกคอมเมนต์”</em> บอทจะตอบทุกข้อความ แต่หากตั้งเป็น <em>“เฉพาะคีย์เวิร์ด”</em> (เช่น สนใจ, ราคา, CF) บอทจะตอบเฉพาะเมนต์ที่มีคำนั้น
                </li>
                <li>
                  <strong>กดถูกใจ (Like) อัตโนมัติ:</strong> กดไลก์ให้คอมเมนต์ลูกค้าทันที (รองรับ Facebook)
                </li>
                <li>
                  <strong>ตอบกลับใต้โพสต์ (Public Reply):</strong> ถ้าตรงกฎคีย์เวิร์ดจะใช้คำตอบตามกฎนั้น ถ้าไม่ตรงจะให้ <strong>AI (Gemini)</strong> ช่วยคิดคำตอบตามข้อมูลสินค้า หรือใช้ข้อความมาตรฐาน
                </li>
                <li>
                  <strong>ทักแชทส่วนตัว (Private Reply / DM):</strong> ส่งข้อความทักเข้าอินบ็อกซ์ของลูกค้าอัตโนมัติ (Meta กำหนดให้ทักได้ <strong>1 ครั้งต่อ 1 คอมเมนต์</strong> ภายใน 7 วัน) เมื่อลูกค้าตอบกลับมา ห้องแชทจะเด้งเข้าหน้า <strong>อินบ็อกซ์</strong> ทันที
                </li>
              </ol>
            </div>

            <div className="rounded-xl border bg-muted/20 p-3.5">
              <h3 className="font-semibold text-amber-600 dark:text-amber-400">
                ขั้นที่ 3: สถานะแจ้งเตือนสีแดงทำงานอย่างไร?
              </h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-foreground/90">
                <li>
                  คอมเมนต์ที่ <strong>บอทตอบให้สำเร็จแล้ว</strong> จะเป็นสถานะ <strong>“✓ เรียบร้อย”</strong> อัตโนมัติ ไม่ขึ้นเลขแจ้งเตือนค้างกวนใจ
                </li>
                <li>
                  ตัวเลขแจ้งเตือนจะขึ้นเฉพาะ <strong>คอมเมนต์ที่บอทยังไม่ได้ตอบ</strong> หรือ <strong>ส่งคำตอบไม่สำเร็จ</strong>
                </li>
                <li>
                  <strong>คลิกเปิดอ่าน = หายแจ้งเตือนทันที:</strong> เพียงแอดมินคลิกเปิดดูคอมเมนต์ หรือกดชิป <strong>“อ่านแล้วทั้งหมด”</strong> ตัวเลขแจ้งเตือนจะหายไปทันที
                </li>
              </ul>
            </div>

            <div className="rounded-xl border bg-muted/20 p-3.5">
              <h3 className="font-semibold text-sky-600 dark:text-sky-400">
                ขั้นที่ 4: ความหมายของปุ่มกดในแต่ละคอมเมนต์
              </h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border bg-background p-2">
                  <strong>💬 ตอบใต้โพสต์:</strong> พิมพ์ตอบกลับสาธารณะใต้คอมเมนต์ (มีปุ่ม <em>ให้ AI ช่วยคิด</em>)
                </div>
                <div className="rounded-lg border bg-background p-2">
                  <strong>✉️ ทักแชทส่วนตัว:</strong> ส่งข้อความเข้าแชท Messenger / IG ของลูกค้าเพื่อดึงเข้า Inbox
                </div>
                <div className="rounded-lg border bg-background p-2">
                  <strong>👁️ ซ่อนคอมเมนต์:</strong> ซ่อนไม่ให้คนอื่นเห็นใต้โพสต์ (เช่น เมนต์ที่มีเบอร์โทร/สแปม)
                </div>
                <div className="rounded-lg border bg-background p-2">
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
                เข้าใจแล้ว
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
        'flex min-w-0 flex-col gap-3 break-words rounded-xl border bg-card p-3.5 sm:p-4',
        c.is_deleted && 'opacity-60',
      )}
    >
      {/* ส่วนหัว: ข้อมูลผู้คอมเมนต์ + ลิงก์ไปดูโพสต์จริง */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
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
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                  <span
                    className="size-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: page.tag_color }}
                  />
                  <span>{page.display_name || page.page_name}</span>
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              คอมเมนต์เมื่อ {timeAgo(c.commented_at ?? c.created_at)}
            </p>
          </div>
        </div>


      </div>

      <CommentNavigation id={c.id} platform={page?.platform} />

      {/* ป้ายสถานะปัจจุบันของคอมเมนต์ */}
      <div className="flex flex-wrap items-center gap-1">
        <Badge
          variant="secondary"
          className={cn(
            'text-[11px] h-5.5 font-medium gap-1 px-2',
            c.is_handled
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
              : 'bg-primary/10 text-primary border border-primary/20',
          )}
        >
          <Check className="size-3" />
          {c.is_handled ? 'อ่านแล้ว' : 'ยังไม่อ่าน'}
        </Badge>
        {c.replied_public && (
          <Badge
            variant="outline"
            className="text-[11px] border-sky-500/30 text-sky-700 dark:text-sky-300 bg-sky-500/10 gap-1 h-5.5 font-normal px-2"
          >
            <MessageSquare className="size-2.5" /> ตอบใต้โพสต์แล้ว
          </Badge>
        )}
        {c.replied_private && (
          <Badge
            variant="outline"
            className="text-[11px] border-purple-500/30 text-purple-700 dark:text-purple-300 bg-purple-500/10 gap-1 h-5.5 font-normal px-2"
          >
            <Send className="size-2.5" /> ทักส่วนตัวแล้ว
          </Badge>
        )}
        {c.is_liked && (
          <Badge variant="secondary" className="text-[11px] gap-1 h-5.5 font-normal px-2">
            <ThumbsUp className="size-2.5 fill-current text-primary" /> ถูกใจแล้ว
          </Badge>
        )}
        {c.is_hidden && (
          <Badge variant="secondary" className="text-[11px] h-5.5 font-normal px-2">
            ซ่อนจากเพจอยู่
          </Badge>
        )}
        {c.is_deleted && (
          <Badge variant="destructive" className="text-[11px] h-5.5 font-normal px-2">
            ลบแล้ว
          </Badge>
        )}
        {c.matched_keyword && (
          <Badge className="bg-amber-500 text-[11px] text-white hover:bg-amber-500 h-5.5 font-normal px-2">
            คีย์เวิร์ด: {c.matched_keyword}
          </Badge>
        )}
      </div>

      {/* กล่องข้อความคอมเมนต์ของลูกค้า */}
      <div className="rounded-xl border bg-muted/20 p-3">
        <p className="text-[11px] font-medium text-muted-foreground mb-0.5">คอมเมนต์ลูกค้า:</p>
        <p
          className={cn(
            'text-sm sm:text-base text-foreground break-words whitespace-pre-wrap leading-relaxed font-medium',
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
              className="max-h-56 max-w-full rounded-lg border object-contain"
            />
          </a>
        )}
      </div>

      {/* แสดงข้อความที่บอทหรือแอดมินตอบกลับไปแล้ว */}
      {hasReplied && (
        <div className="rounded-xl border border-border/70 bg-muted/15 p-3 space-y-2 text-xs">
          {c.public_reply_text && (
            <div className="space-y-1">
              <span className="font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                <ReplyIdentity comment={c} channel="public" />
              </span>
              <div className="rounded-lg bg-background p-2 border text-foreground whitespace-pre-wrap leading-relaxed text-xs sm:text-sm">
                {c.public_reply_text}
              </div>
            </div>
          )}

          {c.private_reply_text && (
            <div className="space-y-1">
              <span className="font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                <ReplyIdentity comment={c} channel="private" />
              </span>
              <div className="rounded-lg bg-background p-2 border text-foreground whitespace-pre-wrap leading-relaxed text-xs sm:text-sm">
                {c.private_reply_text}
              </div>
            </div>
          )}
        </div>
      )}

      {errorMessage && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-600" />
          <div>
            <span className="font-semibold">หมายเหตุก่อนหน้า: </span>
            <span>{errorMessage}</span>
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

      {/* แผงปุ่มกดแบบกระชับ แบ่งซ้าย-ขวาชัดเจน */}
      {mode === 'none' && (
        <div className="space-y-2.5 border-t pt-2.5">
          {!c.is_deleted && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="default"
                className="h-8 gap-1.5 text-xs font-medium"
                onClick={() => {
                  setMode('public');
                  setTimeout(() => textareaRef.current?.focus(), 50);
                }}
              >
                <MessageSquare className="size-3.5" />
                {c.replied_public ? 'ตอบใต้โพสต์เพิ่ม' : 'ตอบใต้โพสต์'}
              </Button>

              {!c.replied_private && !oldForPrivate && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs font-medium border-purple-500/40 text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-950/30"
                  onClick={() => {
                    setMode('private');
                    setTimeout(() => textareaRef.current?.focus(), 50);
                  }}
                >
                  <Send className="size-3.5" />
                  ทักแชทส่วนตัว
                </Button>
              )}

              {c.conversation_id && (
                <Button size="sm" variant="secondary" asChild className="h-8 gap-1.5 text-xs font-medium">
                  <Link href={`/inbox?c=${c.conversation_id}`}>
                    <MessageCircle className="size-3.5 text-primary" />
                    เปิดใน Inbox
                  </Link>
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1">
              {!c.is_deleted && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={sending || (c.is_liked && page?.platform !== 'instagram')}
                  onClick={() => void act({ action: c.is_liked ? 'unlike' : 'like' })}
                  className={cn('h-7 gap-1 px-2 text-xs', c.is_liked && 'text-primary font-medium')}
                >
                  <ThumbsUp className={cn('size-3', c.is_liked && 'fill-current')} />
                  {c.is_liked ? (page?.platform === 'instagram' ? 'เลิกถูกใจ' : 'ถูกใจแล้ว') : 'ถูกใจ'}
                </Button>
              )}

              {!c.is_deleted && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={sending}
                  onClick={() => void act({ action: 'hide', hidden: !c.is_hidden })}
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {c.is_hidden ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                  {c.is_hidden ? 'เลิกซ่อน' : 'ซ่อนจากเพจ'}
                </Button>
              )}

              {!c.is_deleted && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={sending}
                  onClick={() => setConfirmDelete(true)}
                  className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                  ลบ
                </Button>
              )}
            </div>

            <Button
              size="sm"
              variant="ghost"
              disabled={sending}
              onClick={() => void act({ action: 'handled', handled: !c.is_handled })}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Check className={cn('size-3', c.is_handled && 'text-emerald-600')} />
              {c.is_handled ? 'ทำเครื่องหมายยังไม่อ่าน' : 'ทำเครื่องหมายอ่านแล้ว'}
            </Button>
          </div>
        </div>
      )}

      {/* ฟอร์มตอบกลับ */}
      {mode !== 'none' && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.02] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              {mode === 'public' ? (
                <>
                  <MessageSquare className="size-3.5 text-sky-500" />
                  ตอบกลับใต้โพสต์ (สาธารณะ)
                </>
              ) : (
                <>
                  <Send className="size-3.5 text-purple-600" />
                  ทักแชทส่วนตัว (1 ครั้ง/คอมเมนต์)
                </>
              )}
            </span>

            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={aiLoading || sending}
                onClick={() => void askAi()}
                className="h-7 gap-1 px-2 text-xs text-primary border-primary/30 hover:bg-primary/10 rounded-lg"
              >
                {aiLoading ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Sparkles className="size-3 text-amber-500" />
                )}
                <span>{aiLoading ? 'กำลังคิด...' : 'AI ช่วยคิด'}</span>
              </Button>

              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={sending || uploadingImage || !supportsImage}
                onClick={() => setPickerOpen(true)}
                className="h-7 gap-1 px-2 text-xs rounded-lg"
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
                className="h-7 gap-1 px-2 text-xs rounded-lg"
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
            <div className="flex items-center gap-2 rounded-lg border bg-background p-1.5 w-fit">
              <div className="relative size-10 rounded overflow-hidden bg-muted border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selectedImage.preview_url} alt="แนบรูป" className="size-full object-cover" />
              </div>
              <span className="text-xs font-medium pr-1">แนบรูปแล้ว</span>
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
                ? 'พิมพ์ข้อความตอบกลับใต้คอมเมนต์...'
                : 'พิมพ์ข้อความทักส่วนตัวเข้า Messenger / IG...'
            }
            disabled={sending || aiLoading || uploadingImage}
            rows={3}
            maxLength={1000}
            className="w-full min-h-[76px] max-h-[240px] resize-y rounded-xl border bg-background p-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20"
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

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{text.length}/1,000 ตัวอักษร</span>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
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
                className="h-8 gap-1.5 text-xs font-semibold"
                disabled={sending || aiLoading || uploadingImage || c.is_deleted || !text.trim()}
                onClick={() =>
                  void act({
                    action: mode === 'public' ? 'reply_public' : 'reply_private',
                    text: text.trim(),
                  })
                }
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
