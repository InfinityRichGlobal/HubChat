'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Loader2, Lock, MessageSquareOff, Megaphone, Search, Send, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ConversationRow, InboxPage, MessageRow } from '@/server/inbox/service';

/**
 * หน้าอินบ็อกซ์ (ฝั่งหน้าเว็บ) — สเปกหัวข้อ 5.1
 * ===========================================================================
 * มือถือ   : 2 ชั้น — ลิสต์แชท → แตะเข้าห้องแชท
 * เดสก์ท็อป : 2 คอลัมน์ — ลิสต์ซ้าย ห้องแชทขวา
 *            (คอลัมน์ที่ 3 "ข้อมูลลูกค้า" มาพร้อมออเดอร์ในรอบ 5)
 *
 * ⭐ กฎที่ห้ามลืม (สเปกหัวข้อ 6.1) :
 *    หน้านี้มี "ปุ่มส่งปุ่มเดียว" เท่านั้น
 *    ไม่มีที่ไหนให้แอดมินเลือก transport หรือ message tag ได้เลย
 *    ฝั่งเซิร์ฟเวอร์เป็นคนตัดสินทั้งหมด หน้านี้แค่แสดงผลว่าส่งด้วยช่องทางไหน
 */

/* ---------------------------------------------------------------- */
/* ตัวช่วยแสดงผล                                                     */
/* ---------------------------------------------------------------- */

/** นาฬิกา 24 ชม. ตามสเปก */
function clockTh(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function dayTh(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return clockTh(iso);
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

/**
 * นาฬิกานับถอยหลังกรอบ 24 ชม. (สเปก 5.1 : ไอคอนนาฬิกาในลิสต์แชท)
 * ⚠️ ตัวเลข 24 ที่นี่เป็น "การแสดงผลคร่าว ๆ" ให้แอดมินรู้สึกถึงเวลาเท่านั้น
 *    การตัดสินว่าส่งได้จริงไหม เป็นของ Policy Engine ฝั่งเซิร์ฟเวอร์เสมอ
 *    (หัวห้องแชทโชว์คำตอบจริงจาก engine อีกที)
 */
function windowHint(lastCustomerMessageAt: string | null): { text: string; tone: 'ok' | 'warn' | 'over' } | null {
  if (!lastCustomerMessageAt) return null;
  const hours = (Date.now() - new Date(lastCustomerMessageAt).getTime()) / 3_600_000;
  const left = 24 - hours;
  if (left <= 0) return { text: 'พ้นกรอบ', tone: 'over' };
  if (left < 3) return { text: `เหลือ ${Math.max(1, Math.round(left * 60))} นาที`, tone: 'warn' };
  return { text: `เหลือ ${Math.floor(left)} ชม.`, tone: 'ok' };
}

const REFERRAL_LABEL: Record<string, string> = {
  ADS: 'จากแอด',
  SHORTLINK: 'จากลิงก์',
  POST: 'จากโพสต์',
  ORGANIC: 'ทักเอง',
};

/**
 * สร้างกุญแจกันส่งซ้ำ
 * ⚠️ ห้ามเรียก crypto.randomUUID() ตรง ๆ
 *    เบราว์เซอร์จะให้ใช้เฉพาะตอนเปิดผ่าน https หรือ localhost เท่านั้น
 *    ถ้าแอดมินเปิดจากมือถือผ่านเลข IP ในวง LAN (http://192.168.x.x:3000)
 *    ตัวนี้จะไม่มีอยู่ แล้วหน้าจอจะพังเงียบ ๆ ตั้งแต่ตอนเรนเดอร์
 */
function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ตกไปใช้ทางสำรองด้านล่าง */
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

type PolicyStatus = {
  can_send: boolean;
  label_th: string;
  hours_left: number | null;
  alternatives_th: string[];
};

/* ================================================================== */

export default function InboxClient({
  me,
  canReply,
  initialConversations,
  pages,
}: {
  me: { id: string; name: string };
  canReply: boolean;
  initialConversations: ConversationRow[];
  pages: InboxPage[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  /* ---- ดึงลิสต์แชทซ้ำเป็นระยะ ------------------------------------ *
   * ⚠️ ตัวดึงข้อมูล "คืนค่า" อย่างเดียว ไม่ตั้ง state เอง
   *    ผู้เรียกเป็นคนตั้ง state ใน .then() — ทำให้ไม่มีการตั้ง state
   *    ทันทีในตัว effect ซึ่งทำให้ React เรนเดอร์ซ้อนกันเป็นทอด ๆ ได้
   */
  const fetchList = useCallback(async (): Promise<ConversationRow[] | null> => {
    const params = new URLSearchParams();
    if (selectedPages.length > 0) params.set('page_ids', selectedPages.join(','));
    if (search.trim()) params.set('search', search.trim());
    if (unreadOnly) params.set('unread', '1');

    try {
      const res = await fetch(`/api/conversations?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      return json.ok ? (json.data.conversations as ConversationRow[]) : null;
    } catch {
      // เน็ตสะดุดชั่วคราว — ไม่ต้องรบกวนแอดมิน เดี๋ยวรอบหน้าก็ได้เอง
      return null;
    }
  }, [selectedPages, search, unreadOnly]);

  const loadList = useCallback(async () => {
    const rows = await fetchList();
    if (rows) setConversations(rows);
  }, [fetchList]);

  useEffect(() => {
    let alive = true;
    const apply = () => {
      void fetchList().then((rows) => {
        if (alive && rows) setConversations(rows);
      });
    };
    apply();
    // ดึงซ้ำทุก 8 วินาที (ดู DEFERRED_REVIEW D-21 เรื่อง Realtime)
    const timer = setInterval(apply, 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [fetchList]);

  function togglePage(id: string) {
    setSelectedPages((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  const unreadCount = conversations.filter((c) => !c.is_read).length;

  return (
    <div className="flex h-[calc(100dvh-9rem)] w-full gap-3 md:h-[calc(100dvh-6rem)]">
      {/* ---------------- ลิสต์แชท ---------------- */}
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-2 md:max-w-sm',
          activeId && 'hidden md:flex',
        )}
      >
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อลูกค้า หรือเบอร์โทร"
              className="pl-8"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setUnreadOnly((v) => !v)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs',
                unreadOnly ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              ยังไม่ตอบ{unreadCount > 0 ? ` (${unreadCount})` : ''}
            </button>
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePage(p.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                  selectedPages.includes(p.id)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'text-muted-foreground',
                )}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: p.tag_color }} />
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          {conversations.length === 0 ? (
            <EmptyList hasPages={pages.length > 0} />
          ) : (
            <ul className="divide-y">
              {conversations.map((c) => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  isActive={c.id === activeId}
                  meId={me.id}
                  onSelect={() => setActiveId(c.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---------------- ห้องแชท ---------------- */}
      <div className={cn('min-w-0 flex-1', !activeId && 'hidden md:block')}>
        {active ? (
          <ChatRoom
            key={active.id}
            conversation={active}
            canReply={canReply}
            meId={me.id}
            onBack={() => setActiveId(null)}
            onChanged={loadList}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border text-sm text-muted-foreground">
            เลือกแชทจากรายการทางซ้าย
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */

function EmptyList({ hasPages }: { hasPages: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <MessageSquareOff className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">ยังไม่มีแชท</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {hasPages
          ? 'เมื่อลูกค้าทักเข้าเพจ ข้อความจะขึ้นที่นี่อัตโนมัติ — ถ้าทักแล้วยังไม่ขึ้น ให้ดูหัวข้อแก้ปัญหาในคู่มือ docs/META_SETUP_TH.md'
          : 'ยังไม่ได้เชื่อมเพจไหนเลย — ไปที่ ตั้งค่า → จัดการเพจ'}
      </p>
    </div>
  );
}

function ConversationItem({
  conversation: c,
  isActive,
  meId,
  onSelect,
}: {
  conversation: ConversationRow;
  isActive: boolean;
  meId: string;
  onSelect: () => void;
}) {
  const hint = windowHint(c.last_customer_message_at);
  const lockedByOther = c.locked_by_admin_id !== null && c.locked_by_admin_id !== meId;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50',
          isActive && 'bg-accent',
        )}
      >
        {/* จุดแดง = ยังไม่ตอบ */}
        <span
          className={cn(
            'mt-2 size-2 shrink-0 rounded-full',
            c.is_read ? 'bg-transparent' : 'bg-[var(--destructive)]',
          )}
          aria-label={c.is_read ? undefined : 'ยังไม่ตอบ'}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cn('truncate text-sm', !c.is_read && 'font-semibold')}>
              {c.customer_name || `ลูกค้า ${c.psid.slice(-6)}`}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {dayTh(c.last_message_at)}
            </span>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: c.page.tag_color }} />
              {c.page.name}
            </span>
            {c.referral_source && (
              <span className="flex items-center gap-0.5">
                <Megaphone className="size-3" />
                {REFERRAL_LABEL[c.referral_source] ?? c.referral_source}
                {c.referral_ref ? ` "${c.referral_ref}"` : ''}
              </span>
            )}
            {hint && (
              <span
                className={cn(
                  hint.tone === 'over' && 'text-[var(--destructive)]',
                  hint.tone === 'warn' && 'text-[var(--warning,#b45309)]',
                )}
              >
                🕐 {hint.text}
              </span>
            )}
          </div>

          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {c.last_message_preview ?? '—'}
          </p>

          {lockedByOther && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--warning,#b45309)]">
              <Lock className="size-3" />
              {c.locked_by_name} กำลังดูอยู่
            </p>
          )}
        </div>
      </button>
    </li>
  );
}

/* ================================================================== */
/* ห้องแชท                                                            */
/* ================================================================== */

function ChatRoom({
  conversation: c,
  canReply,
  meId,
  onBack,
  onChanged,
}: {
  conversation: ConversationRow;
  canReply: boolean;
  meId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [policy, setPolicy] = useState<PolicyStatus | null>(null);
  const [lockedBy, setLockedBy] = useState<{ name: string; id: string } | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** กุญแจกันส่งซ้ำของข้อความที่กำลังพิมพ์อยู่ */
  const idempotencyKey = useRef<string>(newIdempotencyKey());

  /* ---- ตัวดึงข้อมูล : คืนค่าอย่างเดียว ไม่ตั้ง state เอง ---- */
  const fetchMessages = useCallback(async (): Promise<MessageRow[] | null> => {
    try {
      const res = await fetch(`/api/conversations/${c.id}/messages`, { cache: 'no-store' });
      const json = await res.json();
      return json.ok ? (json.data.messages as MessageRow[]) : null;
    } catch {
      return null; /* เงียบไว้ เดี๋ยวรอบหน้าลองใหม่ */
    }
  }, [c.id]);

  /* ---- สถานะช่องทางส่งจาก Policy Engine (สเปก 5.1 หัวห้องแชท) ---- */
  const fetchPolicy = useCallback(async (): Promise<PolicyStatus | null> => {
    if (!canReply) return null;
    try {
      const res = await fetch(`/api/policy/preview?conversation_id=${c.id}`, { cache: 'no-store' });
      const json = await res.json();
      return json.ok ? (json.data as PolicyStatus) : null;
    } catch {
      return null;
    }
  }, [c.id, canReply]);

  /* ---- ล็อกกันแอดมินชน ---- */
  const fetchLock = useCallback(async (): Promise<{ name: string; id: string } | null> => {
    try {
      const res = await fetch(`/api/conversations/${c.id}/lock`, { method: 'POST' });
      const json = await res.json();
      if (!json.ok) return null;
      const d = json.data as { won: boolean; locked_by_admin_id: string | null; locked_by_name: string | null };
      if (!d.won && d.locked_by_admin_id && d.locked_by_admin_id !== meId) {
        return { name: d.locked_by_name ?? 'แอดมินคนอื่น', id: d.locked_by_admin_id };
      }
      return null;
    } catch {
      return null;
    }
  }, [c.id, meId]);

  const loadMessages = useCallback(async () => {
    const rows = await fetchMessages();
    if (rows) setMessages(rows);
  }, [fetchMessages]);

  const loadPolicy = useCallback(async () => {
    const p = await fetchPolicy();
    if (p) setPolicy(p);
  }, [fetchPolicy]);

  /* ---- เปิดห้อง : อ่านแล้ว + โหลดทุกอย่าง + จับล็อก ---- */
  useEffect(() => {
    let alive = true;

    void fetch(`/api/conversations/${c.id}/read`, { method: 'POST' }).then(onChanged).catch(() => {});

    const pullMessages = () => {
      void fetchMessages().then((rows) => {
        if (alive && rows) setMessages(rows);
      });
    };
    const pullLock = () => {
      void fetchLock().then((holder) => {
        if (alive) setLockedBy(holder);
      });
    };

    pullMessages();
    pullLock();
    void fetchPolicy().then((p) => {
      if (alive && p) setPolicy(p);
    });

    const msgTimer = setInterval(pullMessages, 4000);
    // ต่ออายุล็อกทุก 45 วินาที — สั้นกว่าอายุล็อก 3 นาทีพอสมควร
    // เผื่อเน็ตสะดุดหนึ่งรอบแล้วยังไม่หลุดล็อก
    const lockTimer = setInterval(pullLock, 45_000);

    return () => {
      alive = false;
      clearInterval(msgTimer);
      clearInterval(lockTimer);
      // ออกจากห้อง = ปล่อยล็อกทันที ไม่ต้องรอหมดเวลา 3 นาที
      void fetch(`/api/conversations/${c.id}/lock`, { method: 'DELETE' }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${c.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body, idempotency_key: idempotencyKey.current }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message_th ?? 'ส่งไม่สำเร็จ');
        return;
      }

      const d = json.data as {
        sent: boolean;
        outcome_unknown: boolean;
        reason_th: string;
        alternatives_th: string[];
      };

      if (d.sent) {
        setText('');
        // กุญแจใหม่สำหรับข้อความถัดไป
        idempotencyKey.current = newIdempotencyKey();
        await loadMessages();
        onChanged();
      } else if (d.outcome_unknown) {
        // ⚠️ ยิงออกไปแล้วแต่ไม่รู้ผล — ห้ามบอกให้กดส่งซ้ำเด็ดขาด
        toast.warning('ไม่ทราบผลการส่ง', {
          description: 'ข้อความอาจถึงลูกค้าแล้ว ให้เปิดดูในแอป Messenger ก่อนตัดสินใจส่งใหม่',
          duration: 12_000,
        });
      } else {
        toast.error(d.reason_th, {
          description: d.alternatives_th.length > 0 ? d.alternatives_th.join(' · ') : undefined,
          duration: 10_000,
        });
        await loadPolicy();
      }
    } catch (err) {
      // ⚠️ ก่อนหน้านี้ไม่มีตัวรับ error ตรงนี้
      //    ถ้า fetch พัง หรือเซิร์ฟเวอร์ตอบมาไม่ใช่ JSON (เช่นหน้า error ของ Next)
      //    ข้อผิดพลาดจะหายไปเงียบ ๆ แอดมินกดส่งแล้วเหมือนไม่มีอะไรเกิดขึ้นเลย
      //    ซึ่งแย่กว่าการขึ้นข้อความว่าพังมาก
      console.error('[inbox] ส่งข้อความไม่สำเร็จ:', err);
      toast.error('ส่งข้อความไม่สำเร็จ', {
        description: err instanceof Error ? err.message : 'ติดต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง',
        duration: 10_000,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-lg border">
      {/* ---------- หัวห้อง ---------- */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="กลับ">
          <ArrowLeft />
        </Button>
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.page.tag_color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {c.customer_name || `ลูกค้า ${c.psid.slice(-6)}`}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{c.page.name}</div>
        </div>
        {policy && (
          <Badge variant={policy.can_send ? 'outline' : 'destructive'} className="shrink-0">
            {policy.label_th}
          </Badge>
        )}
      </div>

      {/* ---------- เตือนว่ามีคนอื่นเปิดอยู่ ---------- */}
      {lockedBy && (
        <Alert variant="warning" className="rounded-none border-x-0 border-t-0 py-2">
          <Lock className="size-4" />
          <AlertTitle className="text-xs">{lockedBy.name} กำลังดูแลแชทนี้อยู่</AlertTitle>
          <AlertDescription className="text-xs">
            ตอบได้ แต่ระวังตอบซ้ำกัน — คุยกันก่อนดีกว่า
          </AlertDescription>
        </Alert>
      )}

      {/* ---------- ข้อความ ---------- */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages === null ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="ml-auto h-10 w-1/2" />
            <Skeleton className="h-10 w-3/5" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">ยังไม่มีข้อความในห้องนี้</p>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ---------- ช่องพิมพ์ ---------- */}
      <div className="border-t p-2">
        {!canReply ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            บัญชีของคุณดูได้อย่างเดียว ตอบแชทไม่ได้
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="พิมพ์ข้อความ… (Enter เพื่อส่ง)"
              disabled={sending}
            />
            {/* ⭐ ปุ่มส่งปุ่มเดียว — ไม่มีตัวเลือกช่องทางให้แอดมินกดเลย */}
            <Button onClick={() => void send()} disabled={sending || text.trim().length === 0}>
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              ส่ง
            </Button>
          </div>
        )}

        {policy && !policy.can_send && policy.alternatives_th.length > 0 && (
          <p className="mt-1.5 flex items-start gap-1 text-[11px] text-muted-foreground">
            <X className="mt-0.5 size-3 shrink-0" />
            {policy.alternatives_th.join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message: m }: { message: MessageRow }) {
  const outgoing = m.direction === 'out';

  return (
    <div className={cn('flex flex-col gap-0.5', outgoing ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words',
          outgoing ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}

        {m.attachments.map((a, i) => (
          <div key={i} className="mt-1 text-xs opacity-80">
            {a.url ? (
              <a href={a.url} target="_blank" rel="noreferrer" className="underline">
                เปิดไฟล์แนบ ({a.type})
              </a>
            ) : (
              <span>[ไฟล์แนบ {a.type}]</span>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
        <span>{clockTh(m.created_at)}</span>
        {outgoing && m.admin_name && <span>· {m.admin_name}</span>}
        {outgoing && m.sender_type === 'bot' && <span>· ตอบอัตโนมัติ</span>}
        {/* ป้ายบอกช่องทางที่ใช้ส่ง — อ่านอย่างเดียว ไม่ใช่ตัวเลือก */}
        {m.sent_with_human_agent_tag && <Badge variant="secondary" className="h-4 px-1 text-[9px]">ตอบนอกกรอบ 24 ชม.</Badge>}
      </div>
    </div>
  );
}
