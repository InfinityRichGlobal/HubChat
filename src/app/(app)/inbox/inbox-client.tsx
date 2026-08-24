'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ClipboardCopy, Copy, Loader2, Lock, MapPin, MessageSquareOff,
  Megaphone, Paperclip, Quote, Search, Send, ShoppingCart, Tag as TagIcon, X,
} from 'lucide-react';
import OrderDialog from './order-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ConversationRow, InboxPage, MessageRow } from '@/server/inbox/service';
import type { CannedResponse, Tag } from '@/server/content/service';
import type { ExtractedAddress } from '@/server/extract/address';

/**
 * หน้าอินบ็อกซ์ (ฝั่งหน้าเว็บ) — สเปกหัวข้อ 5.1 + 5.2
 * ===========================================================================
 * มือถือ   : 2 ชั้น — ลิสต์แชท → แตะเข้าห้องแชท
 * เดสก์ท็อป : 2 คอลัมน์ — ลิสต์ซ้าย ห้องแชทขวา
 *
 * ⭐ กฎที่ห้ามลืม (สเปกหัวข้อ 6.1) :
 *    หน้านี้มี "ปุ่มส่งปุ่มเดียว" เท่านั้น
 *    ไม่มีที่ไหนให้แอดมินเลือก transport หรือ message tag ได้เลย
 *
 * ⭐ กฎของรอบ 4 (สเปกหัวข้อ 5.2) :
 *    ตัวดึงที่อยู่เป็นแค่ "ตัวช่วยกรอก" — แอดมินต้องตรวจและกดบันทึกเองเสมอ
 *    ระบบไม่เขียนทับข้อมูลลูกค้าเองเด็ดขาด
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
  const sameDay = d.toDateString() === new Date().toDateString();
  if (sameDay) return clockTh(iso);
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

/**
 * นาฬิกานับถอยหลังกรอบ 24 ชม. (สเปก 5.1)
 * ⚠️ เป็น "การแสดงผลคร่าว ๆ" เท่านั้น การตัดสินว่าส่งได้จริงไหม
 *    เป็นของ Policy Engine ฝั่งเซิร์ฟเวอร์เสมอ (หัวห้องแชทโชว์คำตอบจริง)
 */
function windowHint(lastCustomerMessageAt: string | null): { text: string; tone: 'ok' | 'warn' | 'over' } | null {
  if (!lastCustomerMessageAt) return null;
  const left = 24 - (Date.now() - new Date(lastCustomerMessageAt).getTime()) / 3_600_000;
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
 * ⚠️ ห้ามเรียก crypto.randomUUID() ตรง ๆ — เบราว์เซอร์ให้ใช้เฉพาะ https หรือ localhost
 *    ถ้าเปิดจากมือถือผ่านเลข IP ในวง LAN ตัวนี้จะไม่มี แล้วหน้าจอพังเงียบ ๆ
 */
function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* ตกไปใช้ทางสำรอง */
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** คัดลอกข้อความ — มีทางสำรองสำหรับเบราว์เซอร์ที่ไม่มี clipboard API */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* ตกไปใช้ทางสำรอง */
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/**
 * ข้อจำกัดของไฟล์แนบ
 * ⚠️ ค่าพวกนี้ต้องตรงกับ src/server/messaging/send-image.ts
 *    ที่นี่มีไว้เพื่อบอกผู้ใช้ทันทีโดยไม่ต้องอัปโหลดขึ้นไปก่อน
 *    ตัวที่บังคับจริงอยู่ฝั่งเซิร์ฟเวอร์เสมอ
 */
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type PolicyStatus = {
  can_send: boolean;
  label_th: string;
  hours_left: number | null;
  alternatives_th: string[];
};

/** ตัวช่วยเรียก API ที่ "ไม่ปล่อยให้ error หายเงียบ" */
async function apiCall<T>(url: string, init?: RequestInit): Promise<T | null> {
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
    console.error('[inbox] เรียก API ไม่สำเร็จ:', url, err);
    toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้', {
      description: err instanceof Error ? err.message : undefined,
    });
    return null;
  }
}

/* ================================================================== */

export default function InboxClient({
  me,
  canReply,
  initialConversations,
  initialConversationId,
  pages,
}: {
  me: { id: string; name: string };
  canReply: boolean;
  initialConversations: ConversationRow[];
  /** เปิดห้องนี้ทันที — มาจาก /inbox?c=... ที่หน้าออเดอร์ลิงก์มา */
  initialConversationId?: string | null;
  pages: InboxPage[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  // เปิดห้องที่ลิงก์มาได้ก็ต่อเมื่อห้องนั้นอยู่ในลิสต์จริง
  // (ถ้าไม่เช็ก แล้วส่ง id มั่ว ๆ มา จะได้จอว่างที่กดอะไรไม่ได้)
  const [activeId, setActiveId] = useState<string | null>(
    initialConversationId && initialConversations.some((c) => c.id === initialConversationId)
      ? initialConversationId
      : null,
  );

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  /* ---- โหลดรายชื่อแท็กครั้งเดียวตอนเปิดหน้า ---- */
  useEffect(() => {
    let alive = true;
    void apiCall<{ tags: Tag[] }>('/api/tags').then((d) => {
      if (alive && d) setTags(d.tags);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* ---- ดึงลิสต์แชทซ้ำเป็นระยะ ------------------------------------ *
   * ⚠️ ตัวดึงข้อมูล "คืนค่า" อย่างเดียว ไม่ตั้ง state เอง
   *    ผู้เรียกตั้ง state ใน .then() — กันการเรนเดอร์ซ้อนกันเป็นทอด ๆ
   */
  const fetchList = useCallback(async (): Promise<ConversationRow[] | null> => {
    const params = new URLSearchParams();
    if (selectedPages.length > 0) params.set('page_ids', selectedPages.join(','));
    if (selectedTags.length > 0) params.set('tag_ids', selectedTags.join(','));
    if (search.trim()) params.set('search', search.trim());
    if (unreadOnly) params.set('unread', '1');

    try {
      const res = await fetch(`/api/conversations?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      return json.ok ? (json.data.conversations as ConversationRow[]) : null;
    } catch {
      // เน็ตสะดุดชั่วคราว — เดี๋ยวรอบหน้าก็ได้เอง ไม่ต้องรบกวนแอดมิน
      return null;
    }
  }, [selectedPages, selectedTags, search, unreadOnly]);

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

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const unreadCount = conversations.filter((c) => !c.is_read).length;

  return (
    <div className="flex h-[calc(100dvh-9rem)] w-full gap-3 md:h-[calc(100dvh-6rem)]">
      {/* ---------------- ลิสต์แชท ---------------- */}
      <div className={cn('flex min-w-0 flex-1 flex-col gap-2 md:max-w-sm', activeId && 'hidden md:flex')}>
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
            <FilterChip active={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>
              ยังไม่ตอบ{unreadCount > 0 ? ` (${unreadCount})` : ''}
            </FilterChip>

            {pages.map((p) => (
              <FilterChip
                key={p.id}
                active={selectedPages.includes(p.id)}
                onClick={() => toggle(setSelectedPages)(p.id)}
                dotColor={p.tag_color}
              >
                {p.name}
              </FilterChip>
            ))}

            {tags.map((t) => (
              <FilterChip
                key={t.id}
                active={selectedTags.includes(t.id)}
                onClick={() => toggle(setSelectedTags)(t.id)}
                dotColor={t.color}
              >
                {t.name}
              </FilterChip>
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
                  tagById={tagById}
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
            tags={tags}
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

function FilterChip({
  active,
  onClick,
  dotColor,
  children,
}: {
  active: boolean;
  onClick: () => void;
  dotColor?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
        active ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
      )}
    >
      {dotColor && <span className="size-2 rounded-full" style={{ backgroundColor: dotColor }} />}
      {children}
    </button>
  );
}

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
  tagById,
  onSelect,
}: {
  conversation: ConversationRow;
  isActive: boolean;
  meId: string;
  tagById: Map<string, Tag>;
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
          className={cn('mt-2 size-2 shrink-0 rounded-full', c.is_read ? 'bg-transparent' : 'bg-[var(--destructive)]')}
          aria-label={c.is_read ? undefined : 'ยังไม่ตอบ'}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cn('truncate text-sm', !c.is_read && 'font-semibold')}>
              {c.customer_name || `ลูกค้า ${c.psid.slice(-6)}`}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{dayTh(c.last_message_at)}</span>
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

          <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.last_message_preview ?? '—'}</p>

          {c.tag_ids.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {c.tag_ids.map((id) => {
                const t = tagById.get(id);
                if (!t) return null;
                return (
                  <span
                    key={id}
                    className="rounded-full border px-1.5 py-0.5 text-[10px]"
                    style={{ borderColor: t.color, color: t.color }}
                  >
                    {t.name}
                  </span>
                );
              })}
            </div>
          )}

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
  tags,
  onBack,
  onChanged,
}: {
  conversation: ConversationRow;
  canReply: boolean;
  meId: string;
  tags: Tag[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [policy, setPolicy] = useState<PolicyStatus | null>(null);
  const [lockedBy, setLockedBy] = useState<{ name: string; id: string } | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [menuFor, setMenuFor] = useState<MessageRow | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [contactSource, setContactSource] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  /** รูปที่เลือกไว้แต่ยังไม่ได้ส่ง — ต้องกดส่งเองเสมอ */
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  /** กด Escape เพื่อซ่อนรายการชุดคำตอบชั่วคราวโดยไม่ต้องลบข้อความที่พิมพ์ไว้ */
  const [dismissedCanned, setDismissedCanned] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idempotencyKey = useRef<string>(newIdempotencyKey());

  /* ---- ตัวดึงข้อมูล : คืนค่าอย่างเดียว ไม่ตั้ง state เอง ---- */
  const fetchMessages = useCallback(async (): Promise<MessageRow[] | null> => {
    try {
      const res = await fetch(`/api/conversations/${c.id}/messages`, { cache: 'no-store' });
      const json = await res.json();
      return json.ok ? (json.data.messages as MessageRow[]) : null;
    } catch {
      return null;
    }
  }, [c.id]);

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
    // ต่ออายุล็อกทุก 45 วินาที — สั้นกว่าอายุล็อก 3 นาทีพอสมควร เผื่อเน็ตสะดุดหนึ่งรอบ
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

  /* ---- ชุดคำตอบ : พิมพ์ / แล้วค้นทันที (สเปก 5.1) ---- */
  const slashQuery = text.startsWith('/') ? text.slice(1).trim() : null;

  useEffect(() => {
    if (slashQuery === null) return;
    let alive = true;
    const timer = setTimeout(() => {
      void apiCall<{ items: CannedResponse[] }>(
        `/api/canned?q=${encodeURIComponent(slashQuery)}`,
      ).then((d) => {
        if (alive && d) setCanned(d.items.slice(0, 8));
      });
    }, 150); // หน่วงนิดหน่อย ไม่ให้ยิงทุกตัวอักษร
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [slashQuery]);

  // ⚠️ คำนวณจาก state แทนการล้าง state ในตัว effect
  //    (ล้างใน effect จะทำให้ React เรนเดอร์ซ้อนกันเป็นทอด ๆ)
  const cannedVisible = slashQuery === null || dismissedCanned ? [] : canned;

  /** หยิบชุดคำตอบมาวางในช่องพิมพ์ — ⚠️ ไม่ได้ส่งออกไป แอดมินต้องกดส่งเอง */
  function applyCanned(item: CannedResponse) {
    setText(item.text ?? '');
    setDismissedCanned(false);
    void apiCall(`/api/canned/${item.id}`, { method: 'POST' });
    inputRef.current?.focus();
  }

  /** ยกข้อความมาอ้างอิงในช่องพิมพ์ (สเปก 5.1 : ปัดขวา / เมนูแตะ) */
  function quote(m: MessageRow) {
    const body = (m.text ?? '[ไฟล์แนบ]').split('\n').map((l) => `> ${l}`).join('\n');
    setText((prev) => `${body}\n${prev}`);
    setMenuFor(null);
    inputRef.current?.focus();
  }

  /** เลือกรูป — ตรวจตั้งแต่บนจอ เพื่อบอกปัญหาทันทีโดยไม่ต้องรอเซิร์ฟเวอร์ */
  function pickImage(file: File | null) {
    if (!file) return;
    if (!ALLOWED_IMAGE_MIMES.includes(file.type)) {
      toast.error('รองรับเฉพาะรูปภาพ (JPG / PNG / GIF / WEBP)');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(`ไฟล์ใหญ่เกินไป (สูงสุด ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} MB)`);
      return;
    }
    // ⚠️ เก็บ object URL ไว้เพื่อคืนหน่วยความจำตอนลบ/ส่งเสร็จ
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview);
      return { file, preview: URL.createObjectURL(file) };
    });
  }

  function clearImage() {
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview);
      return null;
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  /**
   * ส่งรูป — เดินเส้นทางเดียวกับข้อความทุกประการ
   * 🔴 ไม่มีการยิง Meta ตรงจากหน้านี้ ทุกอย่างผ่าน API route → Policy Engine
   */
  async function sendImage() {
    const pending = pendingImage;
    if (!pending || uploading) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', pending.file);
      body.append('idempotency_key', idempotencyKey.current);

      const res = await fetch(`/api/conversations/${c.id}/reply-image`, { method: 'POST', body });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message_th ?? 'ส่งรูปไม่สำเร็จ');
        return;
      }

      const d = json.data as { sent: boolean; outcome_unknown: boolean; reason_th: string; alternatives_th: string[] };

      if (d.sent) {
        clearImage();
        idempotencyKey.current = newIdempotencyKey();
        await loadMessages();
        onChanged();
      } else if (d.outcome_unknown) {
        // ⚠️ เหมือนข้อความ : ยิงไปแล้วไม่รู้ผล ห้ามบอกให้กดซ้ำ
        toast.warning('ไม่ทราบผลการส่ง', {
          description: 'รูปอาจถึงลูกค้าแล้ว ให้เปิดดูในแอป Messenger ก่อนตัดสินใจส่งใหม่',
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
      console.error('[inbox] ส่งรูปไม่สำเร็จ:', err);
      toast.error('ส่งรูปไม่สำเร็จ', {
        description: err instanceof Error ? err.message : 'ติดต่อเซิร์ฟเวอร์ไม่ได้',
      });
    } finally {
      setUploading(false);
    }
  }

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
        idempotencyKey.current = newIdempotencyKey(); // กุญแจใหม่สำหรับข้อความถัดไป
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
      // ⚠️ ต้องมีตัวรับ error เสมอ ไม่งั้นกดส่งแล้วเหมือนไม่มีอะไรเกิดขึ้น
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
          <div className="truncate text-sm font-medium">{c.customer_name || `ลูกค้า ${c.psid.slice(-6)}`}</div>
          <div className="truncate text-[11px] text-muted-foreground">{c.page.name}</div>
        </div>

        {canReply && (
          <>
            {/* ⭐ สร้างออเดอร์จากในห้องแชท (สเปก 5.3) — ไม่ส่งข้อความหาลูกค้าเอง */}
            <Button variant="ghost" size="icon" aria-label="สร้างออเดอร์" onClick={() => setOrderOpen(true)}>
              <ShoppingCart />
            </Button>
            <Button variant="ghost" size="icon" aria-label="แท็ก" onClick={() => setTagsOpen(true)}>
              <TagIcon />
            </Button>
          </>
        )}
        {policy && (
          <Badge variant={policy.can_send ? 'outline' : 'destructive'} className="shrink-0">
            {policy.label_th}
          </Badge>
        )}
      </div>

      {/* แท็กที่ติดอยู่ */}
      {c.tag_ids.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b px-3 py-1.5">
          {c.tag_ids.map((id) => {
            const t = tags.find((x) => x.id === id);
            if (!t) return null;
            return (
              <span
                key={id}
                className="rounded-full border px-2 py-0.5 text-[11px]"
                style={{ borderColor: t.color, color: t.color }}
              >
                {t.name}
              </span>
            );
          })}
        </div>
      )}

      {/* ---------- เตือนว่ามีคนอื่นเปิดอยู่ ---------- */}
      {lockedBy && (
        <Alert variant="warning" className="rounded-none border-x-0 border-t-0 py-2">
          <Lock className="size-4" />
          <AlertTitle className="text-xs">{lockedBy.name} กำลังดูแลแชทนี้อยู่</AlertTitle>
          <AlertDescription className="text-xs">ตอบได้ แต่ระวังตอบซ้ำกัน — คุยกันก่อนดีกว่า</AlertDescription>
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
              <MessageBubble key={m.id} message={m} onTap={() => setMenuFor(m)} onSwipeRight={() => quote(m)} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ---------- ช่องพิมพ์ ---------- */}
      <div className="relative border-t p-2">
        {/* รายการชุดคำตอบที่ลอยขึ้นมาเมื่อพิมพ์ / */}
        {cannedVisible.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 z-10 mb-1 max-h-64 overflow-y-auto rounded-lg border bg-popover shadow-lg">
            {cannedVisible.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => applyCanned(item)}
                className="flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent"
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {item.title}
                  {item.shortcut && (
                    <Badge variant="secondary" className="font-mono text-[10px]">/{item.shortcut}</Badge>
                  )}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{item.text}</span>
              </button>
            ))}
          </div>
        )}

        {/* ---------- รูปที่เลือกไว้ (ยังไม่ส่ง) ---------- */}
        {canReply && pendingImage && (
          <div className="mb-2 flex items-center gap-2 rounded-md border p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pendingImage.preview}
              alt="รูปที่จะส่ง"
              className="size-14 shrink-0 rounded object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{pendingImage.file.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {(pendingImage.file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <Button size="sm" onClick={() => void sendImage()} disabled={uploading}>
              {uploading ? <Loader2 className="animate-spin" /> : <Send />}
              ส่งรูป
            </Button>
            <Button size="icon" variant="ghost" aria-label="เอารูปออก" onClick={clearImage} disabled={uploading}>
              <X />
            </Button>
          </div>
        )}

        {!canReply ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            บัญชีของคุณดูได้อย่างเดียว ตอบแชทไม่ได้
          </p>
        ) : (
          <div className="flex items-end gap-2">
            {/* ⭐ แนบรูป — เลือกแล้วยังไม่ส่ง ต้องกดส่งเองเสมอ */}
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED_IMAGE_MIMES.join(',')}
              className="hidden"
              onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="แนบรูป"
              disabled={sending || uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip />
            </Button>
            <Input
              ref={inputRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setDismissedCanned(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  // กำลังเลือกชุดคำตอบอยู่ → Enter หมายถึง "เลือกอันแรก" ไม่ใช่ "ส่ง"
                  if (cannedVisible.length > 0) {
                    applyCanned(cannedVisible[0]);
                    return;
                  }
                  void send();
                }
                if (e.key === 'Escape') setDismissedCanned(true);
              }}
              placeholder="พิมพ์ข้อความ… (พิมพ์ / เพื่อค้นชุดคำตอบ)"
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

      {/* ---------- เมนูแตะข้อความ ---------- */}
      <MessageMenu
        message={menuFor}
        onClose={() => setMenuFor(null)}
        onCopyToInput={(m) => {
          setText(m.text ?? '');
          setMenuFor(null);
          inputRef.current?.focus();
        }}
        onQuote={quote}
        onExtract={(m) => {
          setContactSource(m.text ?? '');
          setMenuFor(null);
        }}
      />

      {/* ---------- กล่องแท็ก ---------- */}
      <TagPicker
        open={tagsOpen}
        onClose={() => setTagsOpen(false)}
        tags={tags}
        attached={c.tag_ids}
        conversationId={c.id}
        onChanged={onChanged}
      />

      {/* ---------- กล่องสร้างออเดอร์ ---------- */}
      {/* key = เปิดใหม่ทุกครั้ง เพื่อไม่ให้ค้างของที่เลือกไว้จากลูกค้าคนก่อน */}
      <OrderDialog
        key={orderOpen ? `order-${c.id}` : 'order-closed'}
        conversationId={orderOpen ? c.id : null}
        onClose={() => setOrderOpen(false)}
        onCreated={onChanged}
      />

      {/* ---------- ฟอร์มที่อยู่ ---------- */}
      <ContactDialog
        key={contactSource ?? 'no-contact'}
        conversationId={c.id}
        source={contactSource}
        onClose={() => setContactSource(null)}
        onSaved={onChanged}
      />
    </div>
  );
}

/* ================================================================== */

function MessageBubble({
  message: m,
  onTap,
  onSwipeRight,
}: {
  message: MessageRow;
  onTap: () => void;
  onSwipeRight: () => void;
}) {
  const outgoing = m.direction === 'out';
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  /** ปัดขวา → ยกมาอ้างอิงทันที (สเปก 5.1) */
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = Math.abs(t.clientY - start.y);
    // ต้องปัดขวาชัดเจน และไม่ใช่การเลื่อนขึ้นลง
    if (dx > 60 && dy < 40) onSwipeRight();
  }

  return (
    <div className={cn('flex flex-col gap-0.5', outgoing ? 'items-end' : 'items-start')}>
      <button
        type="button"
        onClick={onTap}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-left text-sm break-words',
          outgoing ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}

        {m.attachments.map((a, i) => {
          const isImage = a.type === 'image' && Boolean(a.url);
          if (isImage) {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={a.url!}
                alt="รูปที่แนบมา"
                loading="lazy"
                className="mt-1 max-h-56 w-full rounded-lg object-cover"
                /**
                 * ⚠️ ลิงก์รูปจาก Meta เป็นลิงก์ชั่วคราว พอหมดอายุจะโหลดไม่ขึ้น
                 *    ต้องบอกตรง ๆ ว่าเปิดไม่ได้ ดีกว่าโชว์กรอบว่าง ๆ ให้แอดมินงง
                 *    ทางแก้จริงคือเก็บสำเนาไว้เอง (D-17 / Cloudflare R2)
                 */
                onError={(e) => {
                  const el = e.currentTarget;
                  el.style.display = 'none';
                  const note = el.nextElementSibling as HTMLElement | null;
                  if (note) note.style.display = 'block';
                }}
              />
            );
          }
          return (
            <span key={i} className="mt-1 block text-xs opacity-80">
              [ไฟล์แนบ {a.type}]
            </span>
          );
        })}

        {m.attachments.some((a) => a.type === 'image' && a.url) && (
          <span style={{ display: 'none' }} className="mt-1 text-xs opacity-80">
            🖼️ รูปหมดอายุแล้ว (ลิงก์จาก Meta อยู่ได้ไม่นาน) — เปิดดูใน Messenger แทน
          </span>
        )}
      </button>

      <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
        <span>{clockTh(m.created_at)}</span>
        {outgoing && m.admin_name && <span>· {m.admin_name}</span>}
        {outgoing && m.sender_type === 'bot' && <span>· ตอบอัตโนมัติ</span>}
        {/* ป้ายบอกช่องทางที่ใช้ส่ง — อ่านอย่างเดียว ไม่ใช่ตัวเลือก */}
        {m.sent_with_human_agent_tag && (
          <Badge variant="secondary" className="h-4 px-1 text-[9px]">ตอบนอกกรอบ 24 ชม.</Badge>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */

function MessageMenu({
  message,
  onClose,
  onCopyToInput,
  onQuote,
  onExtract,
}: {
  message: MessageRow | null;
  onClose: () => void;
  onCopyToInput: (m: MessageRow) => void;
  onQuote: (m: MessageRow) => void;
  onExtract: (m: MessageRow) => void;
}) {
  const items = message
    ? [
        { icon: ClipboardCopy, label: 'คัดลอกไปช่องพิมพ์', run: () => onCopyToInput(message) },
        { icon: Quote, label: 'ยกมาอ้างอิง', run: () => onQuote(message) },
        { icon: MapPin, label: 'ดึงที่อยู่ + เบอร์', run: () => onExtract(message) },
        {
          icon: Copy,
          label: 'คัดลอกข้อความ',
          run: async () => {
            const ok = await copyText(message.text ?? '');
            toast[ok ? 'success' : 'error'](ok ? 'คัดลอกแล้ว' : 'คัดลอกไม่สำเร็จ');
            onClose();
          },
        },
      ]
    : [];

  return (
    <Dialog open={message !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ข้อความนี้</DialogTitle>
          <DialogDescription className="line-clamp-3 whitespace-pre-wrap">
            {message?.text ?? '(ไฟล์แนบ)'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => void item.run()}
              className="flex items-center gap-3 rounded-md px-2 py-3 text-left text-sm hover:bg-accent"
            >
              <item.icon className="size-4 shrink-0 text-muted-foreground" />
              {item.label}
            </button>
          ))}
        </div>

        {/* สร้างออเดอร์จากข้อความนี้ = รอบถัดไป จงใจยังไม่ใส่ปุ่มหลอก */}
        <p className="text-xs text-muted-foreground">&quot;สร้างออเดอร์จากข้อความนี้&quot; จะมาพร้อมระบบออเดอร์</p>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */

function TagPicker({
  open,
  onClose,
  tags,
  attached,
  conversationId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  tags: Tag[];
  attached: string[];
  conversationId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(tag: Tag) {
    setBusy(tag.id);
    try {
      const result = await apiCall(`/api/conversations/${conversationId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tag_id: tag.id, attached: !attached.includes(tag.id) }),
      });
      if (result) onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>แท็กของแชทนี้</DialogTitle>
          <DialogDescription>ใช้จัดกลุ่มแล้วกรองในลิสต์แชทได้</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5 py-2">
          {tags.length === 0 && (
            <p className="text-sm text-muted-foreground">
              ยังไม่มีแท็ก — สร้างได้ที่ ตั้งค่า → ชุดคำตอบ + แท็ก
            </p>
          )}
          {tags.map((t) => {
            const on = attached.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                disabled={busy === t.id}
                onClick={() => void toggle(t)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm',
                  on ? 'text-primary-foreground' : 'text-muted-foreground',
                )}
                style={on ? { backgroundColor: t.color, borderColor: t.color } : { borderColor: t.color }}
              >
                {busy === t.id ? <Loader2 className="size-3 animate-spin" /> : null}
                {t.name}
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ปิด</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */

/**
 * ฟอร์มที่อยู่ (สเปกหัวข้อ 5.2)
 * 🔴 ระบบดึงค่ามาให้ "กรอกล่วงหน้า" เท่านั้น แอดมินต้องตรวจแล้วกดบันทึกเอง
 *    ไม่มีเส้นทางไหนที่ระบบเขียนทับข้อมูลลูกค้าเองโดยไม่ผ่านปุ่มนี้
 */
function ContactDialog({
  conversationId,
  source,
  onClose,
  onSaved,
}: {
  conversationId: string;
  source: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // เริ่มที่ "กำลังโหลด" ตั้งแต่ตอนสร้างคอมโพเนนต์
  // (ผู้เรียกใส่ key ไว้ ทำให้สร้างใหม่ทุกครั้งที่เปิดข้อความคนละอัน)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ recipient_name: '', phone: '', postcode: '', address: '' });
  const [confidence, setConfidence] = useState<ExtractedAddress['confidence'] | null>(null);

  useEffect(() => {
    if (source === null) return;
    let alive = true;

    void apiCall<{
      current: { recipient_name?: string | null; phone?: string | null; postcode?: string | null; address?: string | null };
      extracted: ExtractedAddress | null;
    }>(`/api/conversations/${conversationId}/contact?from=${encodeURIComponent(source)}`)
      .then((d) => {
        if (!alive) return;
        const ex = d?.extracted;
        const cur = d?.current ?? {};
        // ค่าที่ดึงได้มาก่อน แต่ถ้าดึงไม่ได้ให้ใช้ของเดิมที่มีอยู่
        setForm({
          recipient_name: ex?.recipient_name ?? cur.recipient_name ?? '',
          phone: ex?.phone ?? cur.phone ?? '',
          postcode: ex?.postcode ?? cur.postcode ?? '',
          address: ex?.address ?? cur.address ?? '',
        });
        setConfidence(ex?.confidence ?? null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [conversationId, source]);

  async function save() {
    setSaving(true);
    try {
      const result = await apiCall(`/api/conversations/${conversationId}/contact`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      if (result) {
        toast.success('บันทึกข้อมูลลูกค้าแล้ว');
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof typeof form, label: string, placeholder: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <Dialog open={source !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ที่อยู่ผู้รับ</DialogTitle>
          <DialogDescription>
            ระบบดึงมาให้จากข้อความ — <strong>ตรวจให้ครบก่อนกดบันทึกทุกครั้ง</strong>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col gap-3 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-2">
            {confidence === 'low' && (
              <Alert variant="warning" className="py-2">
                <AlertDescription className="text-xs">
                  ดึงข้อมูลได้น้อยมาก — น่าจะต้องพิมพ์เองเกือบทั้งหมด
                </AlertDescription>
              </Alert>
            )}

            {field('recipient_name', 'ชื่อผู้รับ', 'คุณสมหญิง ใจดี')}
            {field('phone', 'เบอร์โทร', '0812345678')}
            {field('postcode', 'รหัสไปรษณีย์', '10240')}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address">ที่อยู่</Label>
              <textarea
                id="address"
                rows={4}
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                placeholder="123/45 หมู่ 6 ต.บางรัก อ.เมือง จ.สมุทรปราการ"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button onClick={() => void save()} disabled={saving || loading}>
            {saving && <Loader2 className="animate-spin" />}
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
