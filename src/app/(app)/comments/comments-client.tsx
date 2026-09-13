'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Bot, Eye, EyeOff, Loader2, MessageCircle, MessageSquare, Send, Check, RefreshCw, Sparkles,
  ChevronDown, Layers, ThumbsUp, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import PlatformIcon from '@/components/platform-icon';
import CustomerAvatar from '@/components/customer-avatar';
import type { CommentRow } from '@/server/comments/service';
import type { SafePage } from '@/server/pages/service';
import type { CommentBotSettings } from '@/types/comment-bot';

/**
 * ฟีดคอมเมนต์ (ฝั่งหน้าเว็บ) — สเปกหัวข้อ 5.5
 * ===========================================================================
 * 🔴 กฎที่หน้านี้ต้องเคารพ :
 *
 *   1. **ไม่ตอบอัตโนมัติ** — ทุกอย่างแอดมินกดเอง ไม่มีปุ่มไหนทำงานเองทั้งสิ้น
 *
 *   2. ⭐ "ทักส่วนตัว" ทำได้ครั้งเดียวต่อคอมเมนต์ตลอดกาล (กฎของ Meta)
 *      ปุ่มจึงหายไปทันทีที่ใช้แล้ว และเซิร์ฟเวอร์ก็ปฏิเสธซ้ำอีกชั้น
 *
 *   3. ⚠️ "ตอบใต้โพสต์" ทุกคนเห็น — เตือนไม่ให้พิมพ์ข้อมูลส่วนตัวของลูกค้าลงไป
 */

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
  const [botSettings, setBotSettings] = useState<CommentBotSettings | null>(null);

  useEffect(() => {
    void api<CommentBotSettings>('/api/comments/bot').then((d) => {
      if (d) setBotSettings(d);
    });
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const params = new URLSearchParams();
    if (unhandledOnly) params.set('unhandled', '1');
    if (selectedPageId !== 'all') params.set('page_id', selectedPageId);
    const d = await api<Feed & { filter_words: string[] }>(`/api/comments?${params.toString()}`);
    if (d) {
      setFeed({ comments: d.comments, has_more: d.has_more, unhandled_count: d.unhandled_count });
      setWords(d.filter_words);
    }
  }, [unhandledOnly, selectedPageId]);

  /* ---- ดึงซ้ำเป็นระยะ ---- */
  useEffect(() => {
    let alive = true;
    const apply = () => {
      if (alive) void load();
    };
    const first = setTimeout(apply, 0);
    const timer = setInterval(apply, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const replaceComment = useCallback((c: CommentRow) => {
    setFeed((prev) => ({
      ...prev,
      comments: prev.comments.map((x) => (x.id === c.id ? c : x)),
    }));
  }, []);

  const visible = useMemo(() => feed.comments, [feed.comments]);

  const selectedPage = useMemo(() => pages.find((p) => p.id === selectedPageId), [pages, selectedPageId]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">คอมเมนต์</h1>
          <p className="text-sm text-muted-foreground">
            ยังไม่จัดการ {feed.unhandled_count} รายการ
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            รีเฟรช
          </Button>
        </div>
      </div>

      {/* สถานะบอทคอมเมนต์ & ทางลัดตั้งค่า */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 rounded-xl border bg-card p-3 shadow-xs text-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400 font-semibold text-base">
            {botSettings?.auto_reply_public || botSettings?.auto_reply_private ? '🤖' : '💬'}
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1.5 font-medium">
              <span className="font-semibold text-foreground">บอทคอมเมนต์อัตโนมัติ:</span>
              {botSettings?.auto_reply_public || botSettings?.auto_reply_private ? (
                <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-[10px] h-4">
                  เปิดทำงาน ({botSettings.reply_mode === 'ai' ? 'สมอง AI Gemini' : 'Template'})
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] h-4">ปิดอยู่</Badge>
              )}
              {botSettings?.auto_like && (
                <span className="text-[11px] text-muted-foreground hidden sm:inline">· 👍 ไลก์อัตโนมัติ</span>
              )}
              {botSettings?.auto_send_catalog && (
                <span className="text-[11px] text-muted-foreground hidden sm:inline">· 🛍️ ส่งเมนูสินค้า</span>
              )}
            </div>
            <p className="text-muted-foreground text-[11px]">
              {botSettings?.auto_reply_public || botSettings?.auto_reply_private
                ? 'ระบบจะตอบคอมเมนต์และดึงเข้าแชทให้อัตโนมัติตามกฎที่ตั้งไว้'
                : 'คุณสามารถเปิดให้ AI หรือบอทตอบคำถามลูกค้าใต้คอมเมนต์และทักแชทให้อัตโนมัติ'}
              {' · '}
              <strong>ทักส่วนตัวทำได้ 1 ครั้งต่อคอมเมนต์ (กฎ Meta 7 วัน)</strong>
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          asChild
          className="h-7 text-xs shrink-0 gap-1 text-orange-600 border-orange-300 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400"
        >
          <Link href="/settings/autoreply?tab=comments">
            <Bot className="size-3.5" />
            ตั้งค่าบอท
          </Link>
        </Button>
      </div>

      {/* ---- ตัวกรอง ---- */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* ดรอปดาวน์เลือกเพจ */}
        {pages.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={selectedPageId !== 'all' ? 'default' : 'outline'}
                size="sm"
                className="h-8 gap-1.5 text-xs font-medium shrink-0"
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

        <Button
          size="sm"
          variant={!unhandledOnly ? 'default' : 'outline'}
          onClick={() => setUnhandledOnly(false)}
        >
          ทั้งหมด
        </Button>
        <Button
          size="sm"
          variant={unhandledOnly ? 'default' : 'outline'}
          onClick={() => setUnhandledOnly(true)}
        >
          ยังไม่จัดการ ({feed.unhandled_count})
        </Button>
      </div>

      {/* ---- ฟีด ---- */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border py-12 text-center">
          <MessageCircle className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">ยังไม่มีคอมเมนต์</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            คอมเมนต์จะไหลเข้ามาเองเมื่อมีคนคอมเมนต์ใต้โพสต์ของเพจ —
            ต้องเปิด webhook field &quot;feed&quot; ในหน้าตั้งค่าแอปของ Meta ก่อน
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
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
        <p className="text-center text-[11px] text-muted-foreground">
          แสดง {visible.length} รายการล่าสุด — ใช้ตัวกรองด้านบนเพื่อดูเฉพาะที่ต้องการ
        </p>
      )}
    </div>
  );
}

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
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const oldForPrivate = tooOldForPrivate(c.commented_at);

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
        toast.success('AI เสนอคำตอบแล้ว — สามารถปรับแต่งก่อนกดส่งได้ค่ะ');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เรียก AI ไม่สำเร็จ');
    } finally {
      setAiLoading(false);
    }
  }

  async function act(body: Record<string, unknown>) {
    setSending(true);
    setBusy(true);
    try {
      const d = await api<{ ok: boolean; message_th: string; outcome_unknown: boolean; comment: CommentRow }>(
        `/api/comments/${c.id}`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (!d) return;
      onChanged(d.comment);

      if (d.ok) {
        toast.success(d.message_th);
        setMode('none');
        setText('');
      } else if (d.outcome_unknown) {
        // ⚠️ ยิงไปแล้วไม่รู้ผล — ห้ามบอกให้กดซ้ำเด็ดขาด
        toast.warning('ไม่ทราบผล', { description: d.message_th, duration: 12_000 });
      } else {
        toast.error(d.message_th, { duration: 8_000 });
      }
    } finally {
      setSending(false);
      setBusy(false);
    }
  }

  return (
    <div className={cn('flex flex-col gap-2 rounded-md border p-3', (c.is_handled || c.is_deleted) && 'opacity-60')}>
      <div className="flex items-start gap-2.5">
        <CustomerAvatar
          name={c.from_name || c.from_username || 'ลูกค้า'}
          src={c.from_pic_url}
          size="sm"
        />
        <div className="flex flex-1 flex-col gap-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {page && (
              <span className="inline-flex items-center gap-1 rounded bg-muted/80 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                <PlatformIcon platform={page.platform} size="xs" />
                <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: page.tag_color }} />
                <span className="max-w-[120px] truncate">{page.display_name || page.page_name}</span>
              </span>
            )}
            <span className="text-sm font-semibold">{c.from_name || c.from_username || 'ไม่ทราบชื่อ'}</span>
            {c.from_username && c.from_username !== c.from_name && (
              <span className="text-xs text-muted-foreground font-mono">@{c.from_username}</span>
            )}
            <span className="text-[11px] text-muted-foreground">{timeAgo(c.commented_at ?? c.created_at)}</span>
            {c.matched_keyword && (
              <Badge className="bg-amber-500 text-[10px] text-white hover:bg-amber-500">
                {c.matched_keyword}
              </Badge>
            )}
            {c.is_liked && (
              <Badge variant="secondary" className="text-[10px] text-primary border-primary/20 bg-primary/10 gap-0.5">
                <ThumbsUp className="size-2.5 fill-current" /> ไลก์แล้ว
              </Badge>
            )}
            {c.is_deleted && <Badge variant="destructive" className="text-[10px]">ลบแล้ว</Badge>}
            {c.is_handled && <Badge variant="secondary" className="text-[10px]">จัดการแล้ว</Badge>}
            {c.is_hidden && <Badge variant="secondary" className="text-[10px]">ซ่อนอยู่</Badge>}
            {c.replied_public && <Badge variant="outline" className="text-[10px]">ตอบใต้โพสต์แล้ว</Badge>}
            {c.replied_private && <Badge variant="outline" className="text-[10px]">ทักส่วนตัวแล้ว</Badge>}
          </div>

          <p className={cn('whitespace-pre-wrap text-sm', c.is_deleted && 'line-through text-muted-foreground')}>
            {c.message || '(ไม่มีข้อความ)'}
          </p>

          {c.post_permalink && (
            <a
              href={c.post_permalink}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-muted-foreground underline"
            >
              เปิดโพสต์ต้นทาง
            </a>
          )}

          {c.last_error_th && (
            <p className="text-[11px] text-destructive">{c.last_error_th}</p>
          )}
        </div>
      </div>

      {/* ---- Dialog ยืนยันการลบ ---- */}
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

      {/* ---- ปุ่ม ---- */}
      {mode === 'none' && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {!c.is_deleted && (
            <Button size="sm" variant="outline" onClick={() => { setMode('public'); setTimeout(() => inputRef.current?.focus(), 0); }}>
              <MessageSquare className="size-3.5" />
              ตอบใต้โพสต์
            </Button>
          )}

          {/* ⭐ ทักส่วนตัวได้ครั้งเดียวเท่านั้น — หายไปเลยเมื่อใช้แล้ว */}
          {!c.replied_private && !oldForPrivate && !c.is_deleted && (
            <Button size="sm" variant="outline" onClick={() => { setMode('private'); setTimeout(() => inputRef.current?.focus(), 0); }}>
              <Send className="size-3.5" />
              ทักส่วนตัว
            </Button>
          )}
          {!c.replied_private && oldForPrivate && !c.is_deleted && (
            <span className="self-center text-[11px] text-muted-foreground">
              เกิน 7 วัน — ทักส่วนตัวไม่ได้แล้ว
            </span>
          )}

          {/* ไลก์ / ยกเลิกไลก์ */}
          {!c.is_deleted && (
            <Button
              size="sm"
              variant="ghost"
              disabled={sending}
              onClick={() => void act({ action: c.is_liked ? 'unlike' : 'like' })}
              className={c.is_liked ? 'text-primary hover:text-primary font-medium' : ''}
            >
              <ThumbsUp className={cn('size-3.5', c.is_liked && 'fill-current')} />
              {c.is_liked ? 'เลิกถูกใจ' : 'ถูกใจ'}
            </Button>
          )}

          {!c.is_deleted && (
            <Button size="sm" variant="ghost" disabled={sending} onClick={() => void act({ action: 'hide', hidden: !c.is_hidden })}>
              {c.is_hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              {c.is_hidden ? 'เลิกซ่อน' : 'ซ่อน'}
            </Button>
          )}

          <Button size="sm" variant="ghost" disabled={sending} onClick={() => void act({ action: 'handled', handled: !c.is_handled })}>
            <Check className="size-3.5" />
            {c.is_handled ? 'ยังไม่จัดการ' : 'จัดการแล้ว'}
          </Button>

          {!c.is_deleted && (
            <Button
              size="sm"
              variant="ghost"
              disabled={sending}
              onClick={() => setConfirmDelete(true)}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5" />
              ลบ
            </Button>
          )}

          {c.conversation_id && (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/inbox?c=${c.conversation_id}`}>ไปที่แชท</Link>
            </Button>
          )}
        </div>
      )}

      {mode !== 'none' && (
        <div className="mt-1 flex flex-col gap-1.5 border-t pt-2">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <p className="text-[11px] text-muted-foreground">
              {mode === 'public'
                ? '⚠️ ตอบใต้โพสต์ = ทุกคนเห็น อย่าพิมพ์ข้อมูลส่วนตัวของลูกค้าลงไป'
                : '⚠️ ทักส่วนตัวได้ครั้งเดียวต่อคอมเมนต์ ตรวจข้อความให้ดีก่อนส่ง'}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={aiLoading || sending}
              onClick={() => void askAi()}
              className="h-6 gap-1 px-2 text-[11px] text-primary border-primary/30 hover:bg-primary/5"
            >
              {aiLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3 text-amber-500" />}
              <span>{aiLoading ? 'กำลังคิดคำตอบ...' : 'ให้ AI ช่วยคิด'}</span>
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <Input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={mode === 'public' ? 'ตอบใต้โพสต์…' : 'ข้อความส่วนตัว…'}
              disabled={sending || aiLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
                  e.preventDefault();
                  void act({ action: mode === 'public' ? 'reply_public' : 'reply_private', text: text.trim() });
                }
              }}
            />
            <Button
              size="sm"
              disabled={sending || aiLoading || text.trim() === ''}
              onClick={() => void act({ action: mode === 'public' ? 'reply_public' : 'reply_private', text: text.trim() })}
            >
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              ส่ง
            </Button>
            <Button size="sm" variant="ghost" disabled={sending || aiLoading} onClick={() => { setMode('none'); setText(''); }}>
              ยกเลิก
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
