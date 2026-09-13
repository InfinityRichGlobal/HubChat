'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import PlatformIcon from '@/components/platform-icon';
import CustomerAvatar from '@/components/customer-avatar';
import { MediaLibraryPicker, type LibraryItem } from '@/components/media-library-picker';
import type { CommentRow } from '@/server/comments/service';
import type { SafePage } from '@/server/pages/service';
import type { CommentBotSettings } from '@/types/comment-bot';

type Feed = { comments: CommentRow[]; has_more: boolean; unhandled_count: number };

const POLL_MS = 20_000;

function timeAgo(iso: string | null): string {
  if (!iso) return '';
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
  if (!iso) return false;
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

export default function CommentsClient({
  initial,
  initialWords,
  pages = [],
  canManageWords,
}: {
  initial: Feed;
  initialWords: string[];
  pages?: SafePage[];
  canManageWords: boolean;
}) {
  const [feed, setFeed] = useState(initial);
  const [words, setWords] = useState(initialWords);
  const [selectedPageId, setSelectedPageId] = useState<string>('all');
  const [unhandledOnly, setUnhandledOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [botSettings, setBotSettings] = useState<CommentBotSettings | null>(null);

  useEffect(() => {
    void api<CommentBotSettings>('/api/comments/bot').then((d) => {
      if (d) setBotSettings(d);
    });
  }, []);

  const load = useCallback(async (sync = false): Promise<void> => {
    const params = new URLSearchParams();
    if (unhandledOnly) params.set('unhandled', '1');
    if (selectedPageId !== 'all') params.set('page_id', selectedPageId);
    if (sync) params.set('sync', '1');
    const d = await api<Feed & { filter_words: string[] }>(`/api/comments?${params.toString()}`);
    if (d) {
      setFeed({ comments: d.comments, has_more: d.has_more, unhandled_count: d.unhandled_count });
      setWords(d.filter_words);
    }
  }, [unhandledOnly, selectedPageId]);

  /* ---- ดึงและซิงค์สดจาก Meta Graph API อัตโนมัติทุก 15 วินาที ---- */
  useEffect(() => {
    let alive = true;
    const apply = () => {
      if (!alive) return;
      void load(true);
    };
    const first = setTimeout(() => void load(true), 0);
    const timer = setInterval(apply, 15_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const handleManualRefresh = async () => {
    setSyncing(true);
    try {
      await load(true);
      toast.success('ดึงและซิงค์คอมเมนต์ล่าสุดจาก Facebook / Instagram แล้ว');
    } catch {
      toast.error('รีเฟรชข้อมูลไม่สำเร็จ');
    } finally {
      setSyncing(false);
    }
  };

  const replaceComment = useCallback((c: CommentRow) => {
    setFeed((prev) => ({
      ...prev,
      comments: prev.comments.map((x) => (x.id === c.id ? c : x)),
    }));
  }, []);

  const visible = useMemo(() => feed.comments, [feed.comments]);
  const selectedPage = useMemo(() => pages.find((p) => p.id === selectedPageId), [pages, selectedPageId]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3.5 pb-12">
      {/* ส่วนหัวหน้า */}
      <div className="flex items-center justify-between gap-2 border-b pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">คอมเมนต์</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            รวบรวมคอมเมนต์จาก Facebook และ Instagram ในที่เดียว · รอจัดการ {feed.unhandled_count} รายการ
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleManualRefresh()}
          disabled={loading || syncing}
          className="gap-1.5 h-8 text-xs font-medium rounded-lg"
          title="กดเพื่อดึงคอมเมนต์ใหม่ล่าสุดจาก Facebook และ Instagram"
        >
          <RefreshCw className={cn('size-3.5', (loading || syncing) && 'animate-spin')} />
          {syncing ? 'กำลังดึง...' : 'รีเฟรช'}
        </Button>
      </div>

      {/* กล่องสถานะบอทคอมเมนต์ & ทางลัดตั้งค่า */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border bg-card/60 backdrop-blur-xs p-3.5 shadow-xs text-xs">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400 font-semibold text-lg">
            {botSettings?.auto_reply_public || botSettings?.auto_reply_private ? '🤖' : '💬'}
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 font-medium">
              <span className="font-semibold text-foreground">บอทคอมเมนต์อัตโนมัติ:</span>
              {botSettings?.auto_reply_public || botSettings?.auto_reply_private ? (
                <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-[10px] h-4.5 px-2">
                  เปิดทำงาน ({botSettings.reply_mode === 'ai' ? 'สมอง AI Gemini' : 'Template'})
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] h-4.5 px-2">ปิดอยู่</Badge>
              )}
              {botSettings?.auto_like && (
                <span className="text-[11px] text-muted-foreground hidden sm:inline">· 👍 ไลก์อัตโนมัติ</span>
              )}
              {botSettings?.auto_send_catalog && (
                <span className="text-[11px] text-muted-foreground hidden sm:inline">· 🛍️ ส่งเมนูสินค้า</span>
              )}
            </div>
            <p className="text-muted-foreground text-[11px] truncate sm:whitespace-normal">
              {botSettings?.auto_reply_public || botSettings?.auto_reply_private
                ? 'ระบบจะตอบคอมเมนต์และดึงเข้าแชทให้อัตโนมัติตามกฎที่ตั้งไว้'
                : 'หากปิดบอทไว้ คอมเมนต์จะรอแอดมินเข้ามาตอบด้วยตนเอง'}
              {' · '}
              <span className="text-foreground/80 font-medium">ทักส่วนตัวได้ 1 ครั้งต่อคอมเมนต์ (กฎ Meta 7 วัน)</span>
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          asChild
          className="h-7.5 text-xs shrink-0 gap-1.5 rounded-lg border-orange-200 text-orange-700 hover:bg-orange-50 dark:border-orange-900/50 dark:text-orange-400 dark:hover:bg-orange-950/30"
        >
          <Link href="/settings/autoreply?tab=comments">
            <Bot className="size-3.5" />
            ตั้งค่าบอท
          </Link>
        </Button>
      </div>

      {/* แถบตัวกรอง */}
      <div className="flex flex-wrap items-center gap-2">
        {pages.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={selectedPageId !== 'all' ? 'default' : 'outline'}
                size="sm"
                className="h-8 gap-1.5 text-xs font-medium shrink-0 rounded-lg"
              >
                {selectedPage ? (
                  <>
                    <PlatformIcon platform={selectedPage.platform} size="xs" />
                    <span className="max-w-[120px] truncate">{selectedPage.display_name || selectedPage.page_name}</span>
                  </>
                ) : (
                  <>
                    <Layers className="size-3.5" />
                    <span>ทุกเพจ ({pages.length})</span>
                  </>
                )}
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
              <DropdownMenuLabel className="text-xs text-muted-foreground">เลือกเพจที่ต้องการดู</DropdownMenuLabel>
              <DropdownMenuItem
                className={cn('cursor-pointer text-xs flex items-center justify-between', selectedPageId === 'all' && 'font-semibold bg-accent')}
                onClick={() => setSelectedPageId('all')}
              >
                <span className="flex items-center gap-2"><Layers className="size-3.5" /> ทุกเพจ</span>
                {selectedPageId === 'all' && <Check className="size-3 text-primary" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {pages.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  className={cn('cursor-pointer text-xs flex items-center justify-between', selectedPageId === p.id && 'font-semibold bg-accent')}
                  onClick={() => setSelectedPageId(p.id)}
                >
                  <span className="flex items-center gap-2 truncate">
                    <PlatformIcon platform={p.platform} size="xs" />
                    <span className="truncate">{p.display_name || p.page_name}</span>
                  </span>
                  {selectedPageId === p.id && <Check className="size-3 text-primary shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 text-xs">
          <button
            type="button"
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition',
              !unhandledOnly ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setUnhandledOnly(false)}
          >
            ทั้งหมด
          </button>
          <button
            type="button"
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition flex items-center gap-1',
              unhandledOnly ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setUnhandledOnly(true)}
          >
            <span>ยังไม่จัดการ</span>
            {feed.unhandled_count > 0 && (
              <span className="rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] px-1.5 py-0.2 font-bold">
                {feed.unhandled_count}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* รายการคอมเมนต์ */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed py-16 text-center bg-card/30">
          <div className="size-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <MessageCircle className="size-5" />
          </div>
          <p className="text-sm font-semibold">ยังไม่มีรายการคอมเมนต์</p>
          <p className="max-w-md text-xs text-muted-foreground">
            เมื่อมีลูกค้าคอมเมนต์ใต้โพสต์ของ Facebook หรือ Instagram ระบบจะดึงเข้ามาที่นี่แบบเรียลไทม์
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              page={pages.find((p) => p.id === c.page_id)}
              onChanged={replaceComment}
              setBusy={setLoading}
            />
          ))}
        </div>
      )}

      {feed.has_more && (
        <p className="text-center text-[11px] text-muted-foreground pt-2">
          แสดง {visible.length} รายการล่าสุด
        </p>
      )}
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
}: {
  comment: CommentRow;
  page?: SafePage;
  onChanged: (c: CommentRow) => void;
  setBusy: (v: boolean) => void;
}) {
  const [mode, setMode] = useState<'none' | 'public' | 'private'>('none');
  const [text, setText] = useState('');
  const [selectedImage, setSelectedImage] = useState<{ url: string; preview_url: string; id?: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        if (json.data?.image_url && !selectedImage) {
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
    setSending(true);
    setBusy(true);
    try {
      const payload = { ...body };
      if (selectedImage?.url) {
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
      setSending(false);
      setBusy(false);
    }
  }

  const hasReplied = Boolean(c.replied_public || c.replied_private || c.public_reply_text || c.private_reply_text);
  const hasBadges = Boolean(c.is_liked || c.replied_public || c.replied_private || c.is_handled || c.is_hidden || c.is_deleted || c.matched_keyword);

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border bg-card px-3 pt-3 pb-2 sm:px-3.5 sm:pt-3 sm:pb-2.5 shadow-2xs transition',
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
              size="sm"
            />
            {page && (
              <span className="absolute -bottom-1 -right-1 pointer-events-none">
                <PlatformIcon platform={page.platform} size="xs" />
              </span>
            )}
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
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground shrink-0">
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
            <Badge variant="outline" className="text-[10px] border-sky-500/30 text-sky-600 bg-sky-50 dark:bg-sky-950/30 gap-1 h-5 font-normal">
              <MessageSquare className="size-2.5" /> ตอบแล้ว
            </Badge>
          )}
          {c.replied_private && (
            <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-600 bg-purple-50 dark:bg-purple-950/30 gap-1 h-5 font-normal">
              <Send className="size-2.5" /> ทักส่วนตัวแล้ว
            </Badge>
          )}
          {c.is_liked && (
            <Badge variant="secondary" className="text-[10px] text-primary border-primary/20 bg-primary/10 gap-0.5 h-5 font-normal">
              <ThumbsUp className="size-2.5 fill-current" /> ไลก์แล้ว
            </Badge>
          )}
          {c.is_handled && (
            <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-500/20 gap-0.5 h-5 font-normal">
              <Check className="size-2.5" /> จัดการแล้ว
            </Badge>
          )}
          {c.is_hidden && <Badge variant="secondary" className="text-[10px] h-5 font-normal">ซ่อนอยู่</Badge>}
          {c.is_deleted && <Badge variant="destructive" className="text-[10px] h-5 font-normal">ลบแล้ว</Badge>}
          {c.matched_keyword && (
            <Badge className="bg-amber-500 text-[10px] text-white hover:bg-amber-500 h-5 font-normal">
              คีย์เวิร์ด: {c.matched_keyword}
            </Badge>
          )}
        </div>
      )}

      {/* เนื้อหาคอมเมนต์ของลูกค้า */}
      <div className="flex flex-col gap-1 px-0.5">
        <p className={cn('text-sm text-foreground whitespace-pre-wrap leading-relaxed', c.is_deleted && 'line-through text-muted-foreground')}>
          {c.message || '(ไม่มีข้อความ)'}
        </p>

        {/* ส่วนแสดงข้อความที่เคยตอบกลับไปแล้ว (ปิดตาไว้ก่อน กดดูถึงจะเปิด) */}
        {hasReplied && (
          <div className="flex flex-col gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => setShowReplies(!showReplies)}
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground font-medium transition w-fit py-0.5"
            >
              {showReplies ? <EyeOff className="size-3 text-primary" /> : <Eye className="size-3" />}
              <span>{showReplies ? 'ซ่อนข้อความที่ตอบกลับ' : 'ดูข้อความที่ตอบกลับไปแล้ว'}</span>
            </button>

            {showReplies && (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 flex flex-col gap-2 text-xs">
                {c.public_reply_text && (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1 text-[11px]">
                      <MessageSquare className="size-3" /> ข้อความที่ตอบใต้โพสต์:
                    </span>
                    <div className="rounded-md bg-background/90 p-2 border border-border/40 text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {c.public_reply_text}
                    </div>
                  </div>
                )}

                {c.private_reply_text && (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1 text-[11px]">
                      <Send className="size-3" /> ข้อความที่ทักแชทส่วนตัว (Messenger / IG DM):
                    </span>
                    <div className="rounded-md bg-background/90 p-2 border border-border/40 text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {c.private_reply_text}
                    </div>
                  </div>
                )}

                {!c.public_reply_text && !c.private_reply_text && (
                  <p className="text-muted-foreground italic text-[11px]">
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
                className="h-7 gap-1 text-xs font-medium rounded-lg hover:border-primary/50"
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
                className="h-7 gap-1 text-xs font-medium rounded-lg text-purple-700 border-purple-200 hover:bg-purple-50 dark:border-purple-900/50 dark:text-purple-400 dark:hover:bg-purple-950/30"
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
              <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted/40 rounded">
                เกิน 7 วัน (ทักส่วนตัวไม่ได้)
              </span>
            )}

            {!c.is_deleted && (
              <Button
                size="sm"
                variant="ghost"
                disabled={sending}
                onClick={() => void act({ action: c.is_liked ? 'unlike' : 'like' })}
                className={cn('h-7 gap-1 text-xs rounded-lg px-2', c.is_liked && 'text-primary font-semibold')}
              >
                <ThumbsUp className={cn('size-3', c.is_liked && 'fill-current text-primary')} />
                {c.is_liked ? 'เลิกถูกใจ' : 'ถูกใจ'}
              </Button>
            )}

            {/* ถ้าตอบครบทั้งสองแบบแล้ว */}
            {c.replied_public && c.replied_private && (
              <span className="text-[11px] text-muted-foreground py-0.5">
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
              className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground rounded-lg px-2"
              title={c.is_handled ? 'กดเพื่อทำเครื่องหมายว่ายังไม่จัดการ' : 'กดเมื่อจัดการเสร็จแล้ว'}
            >
              <Check className={cn('size-3.5', c.is_handled && 'text-emerald-600 font-bold')} />
              <span>{c.is_handled ? 'จัดการแล้ว' : 'ยังไม่จัดการ'}</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7 rounded-lg text-muted-foreground">
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
            <div className="flex items-center gap-2">
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
              <span className="text-[11px] text-muted-foreground hidden sm:inline">
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
                className="h-7 gap-1 px-2.5 text-xs text-primary border-primary/30 hover:bg-primary/10 rounded-lg"
              >
                {aiLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3 text-amber-500" />}
                <span>{aiLoading ? 'AI กำลังจำลอง...' : 'ให้ AI ช่วยคิด'}</span>
              </Button>

              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={sending || uploadingImage}
                onClick={() => setPickerOpen(true)}
                className="h-7 gap-1 px-2.5 text-xs rounded-lg text-muted-foreground hover:text-foreground"
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
                disabled={sending || uploadingImage}
                onClick={() => fileInputRef.current?.click()}
                className="h-7 gap-1 px-2.5 text-xs rounded-lg text-muted-foreground hover:text-foreground"
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
                <span className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                  จะถูกส่งไปพร้อมกับข้อความตอบกลับ
                </span>
              </div>
              <button
                type="button"
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
            value={text}
            onChange={handleTextChange}
            placeholder={
              mode === 'public'
                ? 'พิมพ์ข้อความตอบกลับใต้คอมเมนต์... (เช่น ขอบคุณที่สนใจครับ สินค้าพร้อมส่งนะคะ)'
                : 'พิมพ์ข้อความทักส่วนตัวเข้า Messenger / IG... (เช่น สวัสดีค่ะ แอดมินทักมาให้ข้อมูลโปรโมชั่นเพิ่มเติมนะคะ)'
            }
            disabled={sending || aiLoading}
            rows={3}
            className="w-full min-h-[84px] max-h-[260px] resize-y rounded-xl border bg-background p-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20 transition placeholder:text-muted-foreground/60"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (text.trim() || selectedImage) {
                  void act({ action: mode === 'public' ? 'reply_public' : 'reply_private', text: text.trim() });
                }
              }
            }}
          />

          {/* แถบล่างของกล่องตอบกลับ */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-muted-foreground">
              กด <kbd className="px-1 py-0.5 bg-muted rounded text-[10px] font-mono border">Ctrl</kbd> + <kbd className="px-1 py-0.5 bg-muted rounded text-[10px] font-mono border">Enter</kbd> หรือกดปุ่มส่ง
            </span>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={sending || aiLoading}
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
                disabled={sending || aiLoading || (!text.trim() && !selectedImage)}
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
