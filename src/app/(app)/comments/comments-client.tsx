'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Eye, EyeOff, Loader2, MessageCircle, MessageSquare, Send, Check, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CommentRow } from '@/server/comments/service';

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
  canManageWords,
}: {
  initial: Feed;
  initialWords: string[];
  canManageWords: boolean;
}) {
  const [feed, setFeed] = useState(initial);
  const [words, setWords] = useState(initialWords);
  const [unhandledOnly, setUnhandledOnly] = useState(false);
  const [keywordOnly, setKeywordOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [wordsOpen, setWordsOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const params = new URLSearchParams();
    if (unhandledOnly) params.set('unhandled', '1');
    if (keywordOnly) params.set('keyword', '1');
    const d = await api<Feed & { filter_words: string[] }>(`/api/comments?${params.toString()}`);
    if (d) {
      setFeed({ comments: d.comments, has_more: d.has_more, unhandled_count: d.unhandled_count });
      setWords(d.filter_words);
    }
  }, [unhandledOnly, keywordOnly]);

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
          {canManageWords && (
            <Button variant="outline" size="sm" onClick={() => setWordsOpen(true)}>
              คำกรอง ({words.length})
            </Button>
          )}
        </div>
      </div>

      <Alert>
        <AlertTriangle className="size-4" />
        <AlertTitle>ระบบไม่ตอบคอมเมนต์อัตโนมัติ</AlertTitle>
        <AlertDescription>
          ทุกการตอบต้องกดเองเสมอ · <strong>&quot;ทักส่วนตัว&quot; ทำได้ครั้งเดียวต่อคอมเมนต์</strong>
          {' '}และต้องภายใน 7 วัน — เป็นกฎของ Meta ที่แก้ไม่ได้
        </AlertDescription>
      </Alert>

      {/* ---- ตัวกรอง ---- */}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant={!unhandledOnly && !keywordOnly ? 'default' : 'outline'}
          onClick={() => { setUnhandledOnly(false); setKeywordOnly(false); }}
        >
          ทั้งหมด
        </Button>
        <Button
          size="sm"
          variant={unhandledOnly ? 'default' : 'outline'}
          onClick={() => { setUnhandledOnly(true); setKeywordOnly(false); }}
        >
          ยังไม่จัดการ ({feed.unhandled_count})
        </Button>
        <Button
          size="sm"
          variant={keywordOnly ? 'default' : 'outline'}
          onClick={() => { setKeywordOnly(true); setUnhandledOnly(false); }}
        >
          เข้าคำกรอง
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
            <CommentCard key={c.id} comment={c} onChanged={replaceComment} setBusy={setLoading} />
          ))}
        </div>
      )}

      {feed.has_more && (
        <p className="text-center text-[11px] text-muted-foreground">
          แสดง {visible.length} รายการล่าสุด — ใช้ตัวกรองด้านบนเพื่อดูเฉพาะที่ต้องการ
        </p>
      )}

      <FilterWordsDialog
        open={wordsOpen}
        onOpenChange={setWordsOpen}
        words={words}
        onSaved={(w) => { setWords(w); void load(); }}
      />
    </div>
  );
}

/* ================================================================== */

function CommentCard({
  comment: c,
  onChanged,
  setBusy,
}: {
  comment: CommentRow;
  onChanged: (c: CommentRow) => void;
  setBusy: (v: boolean) => void;
}) {
  const [mode, setMode] = useState<'none' | 'public' | 'private'>('none');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const oldForPrivate = tooOldForPrivate(c.commented_at);

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
    <div className={cn('flex flex-col gap-1.5 rounded-md border p-3', c.is_handled && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{c.from_name || 'ไม่ทราบชื่อ'}</span>
        <span className="text-[11px] text-muted-foreground">{timeAgo(c.commented_at ?? c.created_at)}</span>
        {c.matched_keyword && (
          <Badge className="bg-amber-500 text-[10px] text-white hover:bg-amber-500">
            {c.matched_keyword}
          </Badge>
        )}
        {c.is_handled && <Badge variant="secondary" className="text-[10px]">จัดการแล้ว</Badge>}
        {c.is_hidden && <Badge variant="secondary" className="text-[10px]">ซ่อนอยู่</Badge>}
        {c.replied_public && <Badge variant="outline" className="text-[10px]">ตอบใต้โพสต์แล้ว</Badge>}
        {c.replied_private && <Badge variant="outline" className="text-[10px]">ทักส่วนตัวแล้ว</Badge>}
      </div>

      <p className="whitespace-pre-wrap text-sm">{c.message || '(ไม่มีข้อความ)'}</p>

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

      {/* ---- ปุ่ม ---- */}
      {mode === 'none' && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => { setMode('public'); setTimeout(() => inputRef.current?.focus(), 0); }}>
            <MessageSquare />
            ตอบใต้โพสต์
          </Button>

          {/* ⭐ ทักส่วนตัวได้ครั้งเดียวเท่านั้น — หายไปเลยเมื่อใช้แล้ว */}
          {!c.replied_private && !oldForPrivate && (
            <Button size="sm" variant="outline" onClick={() => { setMode('private'); setTimeout(() => inputRef.current?.focus(), 0); }}>
              <Send />
              ทักส่วนตัว
            </Button>
          )}
          {!c.replied_private && oldForPrivate && (
            <span className="self-center text-[11px] text-muted-foreground">
              เกิน 7 วัน — ทักส่วนตัวไม่ได้แล้ว
            </span>
          )}

          <Button size="sm" variant="ghost" disabled={sending} onClick={() => void act({ action: 'hide', hidden: !c.is_hidden })}>
            {c.is_hidden ? <Eye /> : <EyeOff />}
            {c.is_hidden ? 'เลิกซ่อน' : 'ซ่อน'}
          </Button>

          <Button size="sm" variant="ghost" disabled={sending} onClick={() => void act({ action: 'handled', handled: !c.is_handled })}>
            <Check />
            {c.is_handled ? 'ยังไม่จัดการ' : 'จัดการแล้ว'}
          </Button>

          {c.conversation_id && (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/inbox?c=${c.conversation_id}`}>ไปที่แชท</Link>
            </Button>
          )}
        </div>
      )}

      {mode !== 'none' && (
        <div className="mt-1 flex flex-col gap-1.5 border-t pt-2">
          <p className="text-[11px] text-muted-foreground">
            {mode === 'public'
              ? '⚠️ ตอบใต้โพสต์ = ทุกคนเห็น อย่าพิมพ์ข้อมูลส่วนตัวของลูกค้าลงไป'
              : '⚠️ ทักส่วนตัวได้ครั้งเดียวต่อคอมเมนต์ ตรวจข้อความให้ดีก่อนส่ง'}
          </p>
          <div className="flex items-end gap-2">
            <Input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={mode === 'public' ? 'ตอบใต้โพสต์…' : 'ข้อความส่วนตัว…'}
              disabled={sending}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
                  e.preventDefault();
                  void act({ action: mode === 'public' ? 'reply_public' : 'reply_private', text: text.trim() });
                }
              }}
            />
            <Button
              size="sm"
              disabled={sending || text.trim() === ''}
              onClick={() => void act({ action: mode === 'public' ? 'reply_public' : 'reply_private', text: text.trim() })}
            >
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              ส่ง
            </Button>
            <Button size="sm" variant="ghost" disabled={sending} onClick={() => { setMode('none'); setText(''); }}>
              ยกเลิก
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */

function FilterWordsDialog({
  open, onOpenChange, words, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  words: string[];
  onSaved: (w: string[]) => void;
}) {
  const [draft, setDraft] = useState(words.join(', '));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const list = draft.split(',').map((w) => w.trim()).filter(Boolean);
      const d = await api<{ words: string[] }>('/api/comments/settings', {
        method: 'PUT',
        body: JSON.stringify({ words: list }),
      });
      if (d) {
        toast.success('บันทึกคำกรองแล้ว');
        onSaved(d.words);
        onOpenChange(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>คำกรองคอมเมนต์</DialogTitle>
          <DialogDescription>
            คอมเมนต์ที่มีคำเหล่านี้จะถูกไฮไลต์ให้เห็นก่อน — คั่นด้วยจุลภาค
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="ราคา, สนใจ, cf" />
          <p className="text-[11px] text-muted-foreground">
            ⚠️ คำกรองเป็นแค่ตัวชูขึ้นมาให้เห็น — คอมเมนต์ที่ไม่เข้าคำกรองยังอยู่ในฟีดครบ
            และ<strong>ไม่มีการตอบอัตโนมัติไม่ว่ากรณีใด</strong>
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
