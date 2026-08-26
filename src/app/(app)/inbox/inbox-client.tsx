'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ArrowDown, ChevronUp, ClipboardCopy, Copy, ExternalLink, ImageIcon, Images,
  Bot, CheckCircle2, Handshake, Inbox, Loader2, Lock, MapPin, MessageCircle, MessageSquareOff,
  Megaphone, Package, Paperclip, Phone, Reply, RefreshCw, Search, Send, ShieldAlert, ShoppingCart,
  SlidersHorizontal, Sparkles, Star, User, UserCheck, Tag as TagIcon, Video, X,
} from 'lucide-react';
import OrderDialog from './order-dialog';
import CustomerDrawer from './customer-drawer';
import ProductPicker from './product-picker';
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
import CustomerAvatar from '@/components/customer-avatar';
import { displayName, hasRealName } from '@/lib/customer-name';
import { mergeByTime } from '@/lib/inbox/merge';
import { customerProfileUrl } from '@/lib/customer-profile';
import { toast } from 'sonner';
import type { ConversationRow, InboxGroup, InboxPage, MessageRow } from '@/server/inbox/service';
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
 * ป้ายคั่นวันแบบเดียวกับ Business Suite
 * ⚠️ เทียบด้วย toDateString() ไม่ใช่การลบเวลา — ไม่งั้นข้ามเที่ยงคืนแล้วเพี้ยน
 */
function dayLabelTh(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'วันนี้';
  if (d.toDateString() === yesterday.toDateString()) return 'เมื่อวาน';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

function isSameDayIso(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
 * รวมข้อความ / ลิสต์แชท — ตรรกะจริงอยู่ที่ @/lib/inbox/merge (มีชุดทดสอบคุม)
 * ===========================================================================
 * 🔴 ทำไมต้อง "รวม" ไม่ใช่ "ทับทั้งก้อน" :
 *    อินบ็อกซ์ดึงข้อมูลซ้ำทุกไม่กี่วินาที ถ้าทับทั้งก้อน ของเก่าที่เพิ่งกด
 *    "ดูข้อความเก่ากว่านี้" มาจะหายวับไปเอง — ใช้งานจริงไม่ได้เลย
 */
function mergeMessages(prev: MessageRow[], incoming: MessageRow[], replaceWindow: boolean): MessageRow[] {
  return mergeByTime(prev, incoming, {
    timeOf: (m) => m.created_at,
    newestFirst: false,
    replaceWindow,
  });
}

function mergeConversations(
  prev: ConversationRow[],
  incoming: ConversationRow[],
  replaceWindow: boolean,
): ConversationRow[] {
  return mergeByTime(prev, incoming, {
    timeOf: (c) => c.last_message_at,
    newestFirst: true,
    replaceWindow,
  });
}

/**
 * นาฬิกานับถอยหลังกรอบ 24 ชม. (สเปก 5.1)
 * ⚠️ เป็น "การแสดงผลคร่าว ๆ" เท่านั้น การตัดสินว่าส่งได้จริงไหม
 *    เป็นของ Policy Engine ฝั่งเซิร์ฟเวอร์เสมอ (หัวห้องแชทโชว์คำตอบจริง)
 */
function windowHint(lastCustomerMessageAt: string | null): { text: string; tone: 'ok' | 'warn' | 'over' } | null {
  if (!lastCustomerMessageAt) return null;
  const left = 24 - (Date.now() - new Date(lastCustomerMessageAt).getTime()) / 3_600_000;
  if (left <= 0) return { text: 'พ้นกรอบตอบ 24 ชม.', tone: 'over' };
  if (left < 3) return { text: `ตอบได้อีก ${Math.max(1, Math.round(left * 60))} นาที`, tone: 'warn' };
  return { text: `ตอบได้อีก ${Math.floor(left)} ชม.`, tone: 'ok' };
}

const REFERRAL_LABEL: Record<string, string> = {
  ADS: 'จากแอด',
  SHORTLINK: 'จากลิงก์',
  POST: 'จากโพสต์',
  ORGANIC: 'ทักเอง',
};

const GROUP_LABEL: Record<InboxGroup, string> = {
  all: 'ข้อความทั้งหมด',
  facebook: 'Messenger',
  instagram: 'Instagram',
  ai_handoff: 'ส่งต่อโดย AI',
  ai_reply: 'การตอบกลับของ AI',
  important: 'สำคัญ',
  unread: 'ยังไม่ได้อ่าน',
  follow_up: 'ติดตามผล',
  done: 'เรียบร้อย',
  spam: 'สแปม',
  assigned: 'กำหนดแล้ว',
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
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

type PolicyStatus = {
  can_send: boolean;
  label_th: string;
  /** ป้ายสั้นสำหรับหัวห้อง — เหตุผลเต็มอยู่ที่ detail_th */
  badge_th?: string;
  detail_th?: string;
  hours_left: number | null;
  alternatives_th: string[];
};

type LibraryItem = {
  id: string;
  mime: string;
  bytes: number;
  preview_url: string;
  created_at: string;
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
  initialHasMore,
  initialConversationId,
  pages,
}: {
  me: { id: string; name: string };
  canReply: boolean;
  initialConversations: ConversationRow[];
  /** ชุดแรกที่เสิร์ฟเวอร์ส่งมาชนเพดานไหม */
  initialHasMore: boolean;
  /** เปิดห้องนี้ทันที — มาจาก /inbox?c=... ที่หน้าออเดอร์ลิงก์มา */
  initialConversationId?: string | null;
  pages: InboxPage[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  /** ยังมีแชทเก่ากว่าที่โหลดมาอีกไหม (สำคัญมากหลังกดดึงแชทเก่าเข้าระบบ) */
  const [hasMoreList, setHasMoreList] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  /** โหลดชุดแรกของ "ตัวกรองชุดนี้" แล้วหรือยัง */
  const listInitRef = useRef(true);
  const newestConversationAtRef = useRef(initialConversations[0]?.last_message_at ?? null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [inboxGroup, setInboxGroup] = useState<InboxGroup>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  useEffect(() => {
    newestConversationAtRef.current = conversations[0]?.last_message_at ?? null;
  }, [conversations]);

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
  const fetchList = useCallback(
    async (before?: string | null, since?: string | null, signal?: AbortSignal): Promise<{ rows: ConversationRow[]; has_more: boolean; truncated: boolean } | null> => {
      const params = new URLSearchParams();
      if (selectedPages.length > 0) params.set('page_ids', selectedPages.join(','));
      if (selectedTags.length > 0) params.set('tag_ids', selectedTags.join(','));
      if (search.trim()) params.set('search', search.trim());
      params.set('group', inboxGroup);
      if (before) params.set('before', before);
      if (since) params.set('since', since);

      try {
        const res = await fetch(`/api/conversations?${params.toString()}`, { cache: 'no-store', signal });
        const json = await res.json();
        if (!json.ok) return null;
        return {
          rows: json.data.conversations as ConversationRow[],
          has_more: Boolean(json.data.has_more),
          truncated: Boolean(json.data.truncated),
        };
      } catch {
        // เน็ตสะดุดชั่วคราว — เดี๋ยวรอบหน้าก็ได้เอง ไม่ต้องรบกวนแอดมิน
        return null;
      }
    },
    [selectedPages, selectedTags, search, inboxGroup],
  );

  const applyList = useCallback((got: { rows: ConversationRow[]; has_more: boolean; truncated: boolean }) => {
    /**
     * 🔴 ชุดแรกของตัวกรองชุดใหม่ ต้อง "ทับทั้งก้อน" ไม่ใช่รวมกับของเดิม
     *    ถ้ารวม ห้องเก่าที่ไม่เข้าเงื่อนไขจะค้างอยู่บนจอ
     *    เช่น ค้นชื่อลูกค้าแล้วยังเห็นห้องที่ไม่ตรงคำค้นปนอยู่ด้วย
     *    และ cursor ของปุ่ม "โหลดแชทเพิ่ม" จะเพี้ยนตามไปด้วย
     */
    if (!listInitRef.current) {
      listInitRef.current = true;
      setConversations(got.rows);
      setHasMoreList(got.has_more);
      return;
    }
    setConversations((prev) => mergeConversations(prev, got.rows, true));
    if (got.truncated) toast.warning('มีแชทใหม่เกินเพดานหนึ่งรอบ ระบบกำลังดึงต่อและไม่ได้ทิ้งรายการ');
  }, []);

  const loadList = useCallback(async () => {
    const got = await fetchList();
    if (got) applyList(got);
  }, [fetchList, applyList]);

  /** ปุ่ม "โหลดแชทเพิ่ม" */
  const loadMoreList = useCallback(async () => {
    if (loadingMore || conversations.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = conversations[conversations.length - 1].last_message_at;
      const got = await fetchList(oldest);
      if (!got) {
        toast.error('โหลดแชทเพิ่มไม่สำเร็จ');
        return;
      }
      const known = new Set(conversations.map((c) => c.id));
      const fresh = got.rows.filter((c) => !known.has(c.id));
      // ไม่ได้ของใหม่เลย = หมดจริง ต้องปิดปุ่ม ไม่งั้นกดวนไม่รู้จบ
      if (fresh.length === 0) {
        setHasMoreList(false);
        return;
      }
      setConversations((prev) => mergeConversations(prev, got.rows, false));
      setHasMoreList(got.has_more);
    } finally {
      setLoadingMore(false);
    }
  }, [conversations, loadingMore, fetchList]);

  useEffect(() => {
    let alive = true;
    // ตัวกรองเปลี่ยน = เริ่มนับหนึ่งใหม่ ของเก่าที่กดโหลดไว้ใช้ต่อไม่ได้แล้ว
    listInitRef.current = false;
    const apply = () => {
      void fetchList().then((got) => {
        if (alive && got) applyList(got);
      });
    };
    apply();
    // ดึงซ้ำทุก 8 วินาที (ดู DEFERRED_REVIEW D-21 เรื่อง Realtime)
    let controller: AbortController | null = null;
    let running = false;
    const poll = () => {
      if (document.hidden || running) return;
      running = true;
      controller = new AbortController();
      const since = newestConversationAtRef.current;
      void fetchList(undefined, since, controller.signal).then((got) => {
        if (alive && got) applyList(got);
      }).finally(() => { running = false; });
    };
    const onVisibility = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setInterval(poll, 8000);
    return () => {
      alive = false;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchList, applyList]);

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const unreadCount = conversations.filter((c) => !c.is_read).length;
  const filterCount = selectedPages.length + selectedTags.length + Number(inboxGroup !== 'all');

  return (
    <div className="flex h-[calc(100dvh-9rem)] w-full gap-3 md:h-[calc(100dvh-6rem)]">
      {/* ---------------- ลิสต์แชท ---------------- */}
      <div className={cn('flex min-w-0 flex-1 flex-col gap-2 md:max-w-sm', active && 'hidden md:flex')}>
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ชื่อ เบอร์ ออเดอร์ หรือเลขพัสดุ"
              className="pl-8"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <Button
              variant={filterCount > 0 ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal className="size-3.5" />
              ตัวกรอง
              {filterCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                  {filterCount}
                </span>
              )}
            </Button>
            <FilterChip active={inboxGroup === 'follow_up'} onClick={() => setInboxGroup(inboxGroup === 'follow_up' ? 'all' : 'follow_up')}>
              <Star className={cn('size-3.5', inboxGroup === 'follow_up' && 'fill-current')} />
              ติดตามผล
            </FilterChip>
            <FilterChip active={inboxGroup === 'unread'} onClick={() => setInboxGroup(inboxGroup === 'unread' ? 'all' : 'unread')}>
              ยังไม่ได้อ่าน{inboxGroup === 'all' && unreadCount > 0 ? ` (${unreadCount})` : ''}
            </FilterChip>
            {inboxGroup !== 'all' && inboxGroup !== 'follow_up' && inboxGroup !== 'unread' && (
              <FilterChip active onClick={() => setInboxGroup('all')}>{GROUP_LABEL[inboxGroup]}</FilterChip>
            )}
            {selectedPages.map((id) => {
              const page = pages.find((p) => p.id === id);
              return page ? <FilterChip key={id} active onClick={() => toggle(setSelectedPages)(id)} dotColor={page.tag_color}>{page.name}</FilterChip> : null;
            })}
            {selectedTags.map((id) => {
              const tag = tags.find((t) => t.id === id);
              return tag ? <FilterChip key={id} active onClick={() => toggle(setSelectedTags)(id)} dotColor={tag.color}>{tag.name}</FilterChip> : null;
            })}
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

          {/* ⭐ โหลดแชทเพิ่ม — จำเป็นหลังกด "ดึงแชทเก่าเข้าระบบ" เพราะห้องอาจมีเป็นร้อย */}
          {hasMoreList && conversations.length > 0 && (
            <div className="flex justify-center border-t p-2">
              <Button variant="outline" size="sm" onClick={() => void loadMoreList()} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="animate-spin" /> : null}
                โหลดแชทเพิ่ม
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- ห้องแชท ---------------- */}
      <div className={cn('min-w-0 flex-1', !active && 'hidden md:block')}>
        {active ? (
          <ChatRoom
            key={active.id}
            conversation={active}
            canReply={canReply}
            meId={me.id}
            tags={tags}
            onBack={() => setActiveId(null)}
            onChanged={loadList}
            onStateChanged={() => {
              listInitRef.current = false;
              void loadList();
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border text-sm text-muted-foreground">
            เลือกแชทจากรายการทางซ้าย
          </div>
        )}
      </div>

      <InboxFilterDialog
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        pages={pages}
        tags={tags}
        selectedPages={selectedPages}
        selectedTags={selectedTags}
        inboxGroup={inboxGroup}
        onTogglePage={toggle(setSelectedPages)}
        onToggleTag={toggle(setSelectedTags)}
        onSelectGroup={setInboxGroup}
        onClear={() => { setSelectedPages([]); setSelectedTags([]); setInboxGroup('all'); }}
      />
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

function InboxFilterDialog({
  open, onOpenChange, pages, tags, selectedPages, selectedTags, inboxGroup,
  onTogglePage, onToggleTag, onSelectGroup, onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: InboxPage[];
  tags: Tag[];
  selectedPages: string[];
  selectedTags: string[];
  inboxGroup: InboxGroup;
  onTogglePage: (id: string) => void;
  onToggleTag: (id: string) => void;
  onSelectGroup: (group: InboxGroup) => void;
  onClear: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bottom-0 left-0 top-auto max-h-[88dvh] w-full max-w-none translate-x-0 translate-y-0 gap-4 overflow-y-auto rounded-b-none rounded-t-3xl p-4 sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg">
        <DialogHeader className="text-center sm:text-left">
          <DialogTitle>กรองและจัดกลุ่มแชท</DialogTitle>
          <DialogDescription>เลือกกลุ่มงานหนึ่งกลุ่ม แล้วกรองเพจหรือป้ายเพิ่มได้</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FilterGroup title="กลุ่มแชท">
            <FilterChoice active={inboxGroup === 'all'} onClick={() => onSelectGroup('all')} icon={<Inbox className="size-4" />}>ข้อความทั้งหมด</FilterChoice>
            <FilterChoice active={inboxGroup === 'facebook'} onClick={() => onSelectGroup('facebook')} icon={<MessageCircle className="size-4" />}>Messenger</FilterChoice>
            <FilterChoice active={inboxGroup === 'instagram'} onClick={() => onSelectGroup('instagram')} icon={<Send className="size-4" />}>Instagram</FilterChoice>
            <FilterChoice active={inboxGroup === 'ai_handoff'} onClick={() => onSelectGroup('ai_handoff')} icon={<Handshake className="size-4" />}>ส่งต่อโดย AI</FilterChoice>
            <FilterChoice active={inboxGroup === 'ai_reply'} onClick={() => onSelectGroup('ai_reply')} icon={<Sparkles className="size-4" />}>การตอบกลับของ AI</FilterChoice>
            <FilterChoice active={inboxGroup === 'important'} onClick={() => onSelectGroup('important')} icon={<AlertCircle className="size-4" />}>สำคัญ</FilterChoice>
            <FilterChoice active={inboxGroup === 'unread'} onClick={() => onSelectGroup('unread')} icon={<MessageSquareOff className="size-4" />}>ยังไม่ได้อ่าน</FilterChoice>
            <FilterChoice active={inboxGroup === 'follow_up'} onClick={() => onSelectGroup('follow_up')} icon={<Star className={cn('size-4', inboxGroup === 'follow_up' && 'fill-current text-amber-500')} />}>ติดตามผล · มีออเดอร์</FilterChoice>
            <FilterChoice active={inboxGroup === 'done'} onClick={() => onSelectGroup('done')} icon={<CheckCircle2 className="size-4" />}>เรียบร้อย</FilterChoice>
            <FilterChoice active={inboxGroup === 'spam'} onClick={() => onSelectGroup('spam')} icon={<ShieldAlert className="size-4" />}>สแปม · ซิงก์ Meta</FilterChoice>
            <FilterChoice active={inboxGroup === 'assigned'} onClick={() => onSelectGroup('assigned')} icon={<UserCheck className="size-4" />}>กำหนดแล้ว</FilterChoice>
          </FilterGroup>
          <FilterGroup title="ช่องทาง / เพจ">
            {pages.map((page) => (
              <FilterChoice key={page.id} active={selectedPages.includes(page.id)} onClick={() => onTogglePage(page.id)} dotColor={page.tag_color}>
                {page.platform === 'instagram' ? 'Instagram · ' : 'Messenger · '}{page.name}
              </FilterChoice>
            ))}
          </FilterGroup>
          <FilterGroup title="ป้าย / กลุ่มแชท">
            {tags.length === 0 ? <p className="text-xs text-muted-foreground">ยังไม่มีป้าย — เพิ่มได้ที่ ตั้งค่า → เนื้อหา</p> : tags.map((tag) => (
              <FilterChoice key={tag.id} active={selectedTags.includes(tag.id)} onClick={() => onToggleTag(tag.id)} dotColor={tag.color}>{tag.name}</FilterChoice>
            ))}
          </FilterGroup>
        </div>
        <DialogFooter className="grid grid-cols-2">
          <Button variant="outline" onClick={onClear}>ล้างทั้งหมด</Button>
          <Button onClick={() => onOpenChange(false)}>ใช้ตัวกรอง</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-2 text-sm font-semibold">{title}</h3><div className="grid gap-2">{children}</div></section>;
}

function FilterChoice({ active, onClick, dotColor, icon, children }: { active: boolean; onClick: () => void; dotColor?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex min-h-11 items-center gap-3 rounded-xl border px-3 text-left text-sm', active ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent')}>
      {icon ?? <span className="size-3 rounded-full" style={{ backgroundColor: dotColor ?? 'var(--muted-foreground)' }} />}
      <span className="min-w-0 flex-1">{children}</span>
      <span className={cn('size-5 rounded-full border-2', active && 'border-[6px] border-primary')} />
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
          'relative flex w-full items-start gap-2.5 px-2.5 py-2 text-left hover:bg-accent/60',
          isActive && 'bg-accent',
        )}
      >
        <div className="relative shrink-0">
          <CustomerAvatar name={displayName(c)} src={c.profile_pic_url} size="md" />
          <span
            className="absolute -bottom-1 -right-1 rounded-full border-2 border-background bg-background px-1 text-[9px] font-bold uppercase text-muted-foreground"
            aria-label={c.page.platform}
          >
            {c.page.platform === 'instagram' ? 'IG' : 'FB'}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <span className={cn('min-w-0 flex-1 break-words text-sm leading-5', !c.is_read && 'font-semibold')}>
              {displayName(c)}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="text-[11px] text-muted-foreground">{dayTh(c.last_message_at)}</span>
              {(c.order_count > 0 || c.is_important) && (
                <Star className="size-4 fill-amber-500 text-amber-500" aria-label={c.order_count > 0 ? 'ติดตามผล' : 'สำคัญ'} />
              )}
            </span>
          </div>

          {c.username && <p className="truncate text-[11px] text-muted-foreground">@{c.username}</p>}
          <p className={cn('mt-0.5 truncate text-xs leading-5', c.is_read ? 'text-muted-foreground' : 'font-medium')}>
            {c.last_message_preview ?? '—'}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: c.page.tag_color }} /> {c.page.name}
            </span>
            {c.order_count > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <ShoppingCart className="size-2.5" /> {c.order_count}
              </span>
            )}
            {c.inbox_status === 'done' && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><CheckCircle2 className="size-2.5" /> เรียบร้อย</span>}
            {c.inbox_status === 'spam' && <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive"><ShieldAlert className="size-2.5" /> สแปม</span>}
            {c.assigned_admin_name && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5"><UserCheck className="size-2.5" /> {c.assigned_admin_name}</span>}
            {c.has_ai_reply && <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-violet-800 dark:bg-violet-950 dark:text-violet-300"><Bot className="size-2.5" /> AI ตอบ</span>}
            {c.has_ai_handoff && <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-1.5 py-0.5 text-orange-800 dark:bg-orange-950 dark:text-orange-300"><Handshake className="size-2.5" /> AI ส่งต่อ</span>}
            {c.referral_source && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5">
                <Megaphone className="size-3" />
                {REFERRAL_LABEL[c.referral_source] ?? c.referral_source}
              </span>
            )}
            {hint && (
              <span
                className={cn(
                  'rounded-full bg-muted px-1.5 py-0.5',
                  hint.tone === 'over' && 'text-[var(--destructive)]',
                  hint.tone === 'warn' && 'text-[var(--warning,#b45309)]',
                )}
              >
                {hint.text}
              </span>
            )}
            {!c.is_read && <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive"><span className="size-1.5 rounded-full bg-destructive" /> ใหม่</span>}
          </div>

          {c.tag_ids.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {c.tag_ids.slice(0, 1).map((id) => {
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
              {c.tag_ids.length > 1 && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{c.tag_ids.length - 1}</span>}
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
  onStateChanged,
}: {
  conversation: ConversationRow;
  canReply: boolean;
  meId: string;
  tags: Tag[];
  onBack: () => void;
  onChanged: () => void;
  onStateChanged: () => void;
}) {
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  /** ยังมีข้อความเก่ากว่าที่โหลดมาอีกไหม */
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** ผู้ใช้เลื่อนขึ้นไปอ่านของเก่าอยู่ไหม — ใช้ตัดสินว่าจะเด้งลงล่างอัตโนมัติหรือไม่ */
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(false);
  const [policy, setPolicy] = useState<PolicyStatus | null>(null);
  const [lockedBy, setLockedBy] = useState<{ name: string; id: string } | null>(null);
  const [text, setText] = useState('');
  /** ข้อความที่กำลังจะตอบกลับ — null = ส่งข้อความธรรมดา */
  const [replyTarget, setReplyTarget] = useState<MessageRow | null>(null);
  /** แผงข้อมูลลูกค้า (ข้อ 1.6) */
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** ตัวเลือกสินค้า (ข้อ 1.10) */
  const [productOpen, setProductOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [stateBusy, setStateBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<MessageRow | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [contactSource, setContactSource] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderSource, setOrderSource] = useState<MessageRow | null>(null);
  const [mediaOrder, setMediaOrder] = useState<{ mediaId: string } | null>(null);
  /** รูปที่เลือกไว้แต่ยังไม่ได้ส่ง — ต้องกดส่งเองเสมอ */
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null);
  const [pendingVideo, setPendingVideo] = useState<{ file: File; preview: string } | null>(null);
  /** สื่อจากคลังเป็นคนละงานกับ Paperclip ซึ่งแนบไฟล์ใหม่จากเครื่อง */
  const [libraryKind, setLibraryKind] = useState<'image' | 'video' | null>(null);
  const [pendingLibrary, setPendingLibrary] = useState<LibraryItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [browseCanned, setBrowseCanned] = useState(false);
  /** รูปของชุดคำตอบ — กดส่งแล้วระบบส่งรูปให้ครบก่อน จึงค่อยส่งข้อความ */
  const [cannedImages, setCannedImages] = useState<Array<{ url: string; name?: string }>>([]);
  /** กด Escape เพื่อซ่อนรายการชุดคำตอบชั่วคราวโดยไม่ต้องลบข้อความที่พิมพ์ไว้ */
  const [dismissedCanned, setDismissedCanned] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** true = ให้จอเด้งลงล่างเมื่อมีข้อความใหม่ (ใช้ ref เพราะ effect ต้องอ่านค่าล่าสุด) */
  const stickBottomRef = useRef(true);
  /** ความสูงเดิมก่อนแทรกของเก่า — ใช้ดึงจอกลับที่เดิมหลังแทรก */
  const restoreScrollRef = useRef<number | null>(null);
  /** โหลดครั้งแรกแล้วหรือยัง — ใช้ตั้งค่า "ยังมีของเก่าอีกไหม" เพียงครั้งเดียว */
  const initializedRef = useRef(false);
  /** id ของข้อความล่างสุดที่เคยเห็น — ใช้แยก "มีของใหม่จริง" ออกจาก "แค่ดึงข้อมูลรอบใหม่" */
  const lastMessageIdRef = useRef<string | null>(null);
  const newestMessageAtRef = useRef<string | null>(null);
  const idempotencyKey = useRef<string>(newIdempotencyKey());

  /* ---- ตัวดึงข้อมูล : คืนค่าอย่างเดียว ไม่ตั้ง state เอง ---- */
  const fetchMessages = useCallback(
    async (before?: string | null, after?: string | null, signal?: AbortSignal): Promise<{ rows: MessageRow[]; has_more: boolean; truncated: boolean } | null> => {
      try {
        const params = new URLSearchParams();
        if (before) params.set('before', before);
        if (after) params.set('after', after);
        const qs = params.size ? `?${params.toString()}` : '';
        const res = await fetch(`/api/conversations/${c.id}/messages${qs}`, { cache: 'no-store', signal });
        const json = await res.json();
        if (!json.ok) return null;
        return {
          rows: json.data.messages as MessageRow[],
          has_more: Boolean(json.data.has_more),
          truncated: Boolean(json.data.truncated),
        };
      } catch {
        return null;
      }
    },
    [c.id],
  );

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

  /** รับชุดข้อความล่าสุดเข้ามารวมกับที่ถืออยู่ */
  const applyLatest = useCallback((got: { rows: MessageRow[]; has_more: boolean; truncated: boolean }) => {
    const newest = got.rows[got.rows.length - 1]?.created_at;
    if (newest && (!newestMessageAtRef.current || newest > newestMessageAtRef.current)) newestMessageAtRef.current = newest;
    setMessages((prev) => (prev === null ? got.rows : mergeMessages(prev, got.rows, true)));
    // ⚠️ ตั้ง "ยังมีของเก่าอีกไหม" เฉพาะรอบแรก
    //    รอบหลัง ๆ ของเก่าที่กดโหลดมาแล้วยังอยู่ในมือ ค่าจาก API จึงไม่ใช่ความจริงอีกต่อไป
    if (!initializedRef.current) {
      initializedRef.current = true;
      setHasOlder(got.has_more);
    }
    if (got.truncated) toast.warning('มีข้อความใหม่เกินเพดานหนึ่งรอบ ระบบกำลังดึงต่อและไม่ได้ทิ้งข้อความ');
  }, []);

  const loadMessages = useCallback(async () => {
    const got = await fetchMessages();
    if (got) applyLatest(got);
  }, [fetchMessages, applyLatest]);

  /** ปุ่ม "ดูข้อความเก่ากว่านี้" */
  const loadOlder = useCallback(async () => {
    const current = messages;
    if (!current || current.length === 0 || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const got = await fetchMessages(current[0].created_at);
      if (!got) {
        toast.error('โหลดข้อความเก่าไม่สำเร็จ');
        return;
      }
      const known = new Set(current.map((m) => m.id));
      const fresh = got.rows.filter((m) => !known.has(m.id));

      // 🔴 ไม่ได้ของใหม่เลย = ถึงต้นห้องแล้วจริง ๆ ต้องปิดปุ่ม
      //    ไม่งั้นจะกดวนได้ไม่รู้จบ (ขอบเวลาซ้ำกันพอดี)
      if (fresh.length === 0) {
        setHasOlder(false);
        return;
      }

      // จำความสูงไว้ก่อน เพื่อดึงจอกลับจุดเดิมหลังแทรกของเก่าเข้าไปข้างบน
      restoreScrollRef.current = scrollRef.current?.scrollHeight ?? null;
      // ⚠️ ต้องรวมกับ "ค่าล่าสุดจริง ๆ" ไม่ใช่ค่าที่จับภาพไว้ก่อน await
      //    ระหว่างที่รอ Meta ตอบ ตัวดึงอัตโนมัติอาจเพิ่งเอาข้อความใหม่เข้ามา
      setMessages((prev) => mergeMessages(prev ?? current, got.rows, false));
      setHasOlder(got.has_more);
    } finally {
      setLoadingOlder(false);
    }
  }, [messages, loadingOlder, fetchMessages]);

  const loadPolicy = useCallback(async () => {
    const p = await fetchPolicy();
    if (p) setPolicy(p);
  }, [fetchPolicy]);

  /* ---- เปิดห้อง : อ่านแล้ว + โหลดทุกอย่าง + จับล็อก ---- */
  useEffect(() => {
    let alive = true;
    let messageController: AbortController | null = null;
    let messagesRunning = false;
    let lockRunning = false;
    void fetch(`/api/conversations/${c.id}/read`, { method: 'POST' }).then(onChanged).catch(() => {});

    const pullMessages = () => {
      if (document.hidden || messagesRunning) return;
      messagesRunning = true;
      messageController = new AbortController();
      void fetchMessages(undefined, newestMessageAtRef.current, messageController.signal).then((got) => {
        if (alive && got) applyLatest(got);
      }).finally(() => { messagesRunning = false; });
    };
    const pullLock = () => {
      if (document.hidden || lockRunning) return;
      lockRunning = true;
      void fetchLock().then((holder) => {
        if (alive) setLockedBy(holder);
      }).finally(() => { lockRunning = false; });
    };

    pullMessages();
    pullLock();
    void fetchPolicy().then((p) => {
      if (alive && p) setPolicy(p);
    });

    const msgTimer = setInterval(pullMessages, 4000);
    // ต่ออายุล็อกทุก 45 วินาที — สั้นกว่าอายุล็อก 3 นาทีพอสมควร เผื่อเน็ตสะดุดหนึ่งรอบ
    const lockTimer = setInterval(pullLock, 45_000);
    const onVisibility = () => { if (!document.hidden) { pullMessages(); pullLock(); } };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      clearInterval(msgTimer);
      clearInterval(lockTimer);
      messageController?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      // ออกจากห้อง = ปล่อยล็อกทันที ไม่ต้องรอหมดเวลา 3 นาที
      void fetch(`/api/conversations/${c.id}/lock`, { method: 'DELETE' }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  /**
   * จัดตำแหน่งจอหลังรายการข้อความเปลี่ยน
   *
   * 🔴 เดิมเด้งลงล่างทุกครั้งที่ข้อความเปลี่ยน ทำให้อ่านของเก่าไม่ได้เลย
   *    (ทุก 4 วินาทีจะกระชากลงล่างเอง) — นี่คือเหตุผลหลักที่ใช้ยากกว่า Business Suite
   */
  // ⚠️ ใช้ useLayoutEffect เพราะต้องขยับจอ "ก่อน" เบราว์เซอร์วาด
  //    ถ้าใช้ useEffect จะเห็นจอกระโดดวูบหนึ่งครั้งทุกครั้งที่กดโหลดของเก่า
  useLayoutEffect(() => {
    // เพิ่งแทรกของเก่าเข้าไปข้างบน → ดึงจอกลับจุดที่อ่านค้างไว้
    const before = restoreScrollRef.current;
    if (before !== null && scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop += el.scrollHeight - before;
      restoreScrollRef.current = null;
      return;
    }

    /**
     * ⭐ "มีข้อความใหม่" ต้องดูจาก id ของข้อความล่างสุด ไม่ใช่ดูว่า state เปลี่ยน
     *    เพราะตัวดึงข้อมูลทำงานทุก 4 วินาที และคืนอาเรย์ก้อนใหม่ทุกครั้ง
     *    ถ้าดูแค่ว่า state เปลี่ยน ป้าย "มีข้อความใหม่" จะเด้งทุก 4 วินาทีทั้งที่ไม่มีอะไรเข้า
     */
    const lastId = messages && messages.length > 0 ? messages[messages.length - 1].id : null;
    const arrived = lastId !== null && lastId !== lastMessageIdRef.current;
    lastMessageIdRef.current = lastId;

    if (stickBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
      setNewBelow(false);
    } else if (arrived) {
      // อยู่ระหว่างอ่านของเก่า → ไม่กระชากจอ แต่บอกให้รู้ว่ามีของใหม่ข้างล่าง
      setNewBelow(true);
    }
  }, [messages]);

  /** ช่องพิมพ์โตตามข้อความสูงสุด 6 บรรทัด หลังจากนั้นเลื่อนภายในช่อง */
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = Number.parseFloat(window.getComputedStyle(el).lineHeight) || 24;
    const maxHeight = lineHeight * 6 + 16;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${Math.max(44, nextHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [text]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    // เผื่อ 60px เพราะความสูงเศษทศนิยมทำให้ไม่เคยเท่ากันเป๊ะ
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    stickBottomRef.current = near;
    setAtBottom(near);
    if (near) setNewBelow(false);
  }

  function jumpToBottom() {
    stickBottomRef.current = true;
    setNewBelow(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  /* ---- ชุดคำตอบ : พิมพ์ / แล้วค้นทันที (สเปก 5.1) ---- */
  const slashQuery = text.startsWith('/') ? text.slice(1).trim() : null;

  useEffect(() => {
    if (slashQuery === null && !browseCanned) return;
    let alive = true;
    const timer = setTimeout(() => {
      void apiCall<{ items: CannedResponse[] }>(
        `/api/canned?q=${encodeURIComponent(slashQuery ?? '')}`,
      ).then((d) => {
        if (alive && d) setCanned(d.items.slice(0, 8));
      });
    }, 150); // หน่วงนิดหน่อย ไม่ให้ยิงทุกตัวอักษร
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [slashQuery, browseCanned]);

  // ⚠️ คำนวณจาก state แทนการล้าง state ในตัว effect
  //    (ล้างใน effect จะทำให้ React เรนเดอร์ซ้อนกันเป็นทอด ๆ)
  const cannedVisible = (slashQuery === null && !browseCanned) || dismissedCanned ? [] : canned;

  /** หยิบชุดคำตอบมาวางในช่องพิมพ์ — ⚠️ ไม่ได้ส่งออกไป แอดมินต้องกดส่งเอง */
  /**
   * หยิบชุดคำตอบมาวางในช่องพิมพ์ (ข้อ 1.9)
   *
   * ⭐ ถ้ามีตัวแปร {{...}} ต้องให้ **เซิร์ฟเวอร์** แทนค่าให้
   *    เบราว์เซอร์แทนเองไม่ได้เด็ดขาด เพราะยอดเงิน/เลขพัสดุคือความจริงของร้าน
   *    (ถ้าเบราว์เซอร์แทนได้ ก็แก้ยอดแล้วส่งค่าผิดให้ลูกค้าได้)
   *
   * 🔴 ตัวแปรที่ยังไม่มีค่า จะคง {{...}} ไว้ + ขึ้นคำเตือน
   *    ไม่แทนด้วยช่องว่าง เพราะข้อความที่ "ดูปกติพอจะกดส่ง" คือสิ่งที่อันตรายที่สุด
   */
  async function applyCanned(item: CannedResponse) {
    const template = item.text ?? '';
    setDismissedCanned(false);
    setBrowseCanned(false);
    const images = item.images.flatMap((image, index) => image.url
      ? [{ url: image.url, name: image.name ?? `รูป ${index + 1}` }]
      : []);
    setCannedImages(images);
    if (images.length === 0) {
      toast.error('ชุดคำตอบนี้ยังไม่มีรูป จึงยังส่งไม่ได้', { description: 'เพิ่มรูปอย่างน้อย 1 รูปที่หน้าชุดคำตอบก่อน' });
    }
    void apiCall(`/api/canned/${item.id}`, { method: 'POST' });

    if (!template.includes('{{')) {
      setText(template);
      inputRef.current?.focus();
      return;
    }

    const res = await apiCall<{ text: string; ready: boolean; warning_th: string | null }>(
      `/api/conversations/${c.id}/compose`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'canned', template }),
      },
    );

    // เรียกไม่สำเร็จ = วางต้นแบบไว้ให้แอดมินแก้เอง ดีกว่าไม่ได้อะไรเลย
    setText(res?.text ?? template);
    if (res && !res.ready && res.warning_th) {
      toast.warning(res.warning_th, { duration: 8000 });
    }
    inputRef.current?.focus();
  }

  /** ยกข้อความมาอ้างอิงในช่องพิมพ์ (สเปก 5.1 : ปัดขวา / เมนูแตะ) */
  /**
   * ⭐ ตอบกลับข้อความจริง — ไม่ใช่การก๊อปข้อความมาใส่ `>` ในช่องพิมพ์
   *
   * 🔴 ต่างกันตรงไหน :
   *    แบบเดิม ข้อความที่ยกมาจะกลายเป็น "เนื้อข้อความ" ที่ลูกค้าได้รับจริง
   *    ลูกค้าจึงเห็นข้อความตัวเองซ้ำอีกรอบแบบมี > นำหน้า ซึ่งอ่านแล้วงง
   *    แบบใหม่เก็บเป็น "ความสัมพันธ์" แยกจากเนื้อข้อความ
   *    และถ้าช่องทางรองรับ Meta จะผูกเส้นโยงให้เหมือนตอบกลับในแอปจริง
   */
  function replyTo(m: MessageRow) {
    setReplyTarget(m);
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

  function pickVideo(file: File | null) {
    if (!file) return;
    if (!ALLOWED_VIDEO_MIMES.includes(file.type)) {
      toast.error('รองรับวิดีโอ MP4 / MOV / WEBM');
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      toast.error(`ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_VIDEO_BYTES / 1024 / 1024} MB)`);
      return;
    }
    setPendingVideo((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview);
      return { file, preview: URL.createObjectURL(file) };
    });
  }

  function clearVideo() {
    setPendingVideo((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview);
      return null;
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  function pickAttachment(file: File | null) {
    if (!file) return;
    if (file.type.startsWith('video/')) pickVideo(file);
    else pickImage(file);
  }

  async function sendLibraryMedia() {
    const pending = pendingLibrary;
    if (!pending || uploading) return;
    setUploading(true);
    try {
      const res = await fetch(`/api/conversations/${c.id}/reply-library-media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ media_id: pending.id, idempotency_key: idempotencyKey.current }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.data?.sent) {
        toast.error(json?.error?.message_th ?? json?.data?.reason_th ?? 'ส่งไฟล์จากคลังไม่สำเร็จ');
        return;
      }
      setPendingLibrary(null);
      idempotencyKey.current = newIdempotencyKey();
      stickBottomRef.current = true;
      await loadMessages();
      onChanged();
    } catch (err) {
      toast.error('ส่งไฟล์จากคลังไม่สำเร็จ', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setUploading(false);
    }
  }

  async function sendVideo() {
    const pending = pendingVideo;
    if (!pending || uploading) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', pending.file);
      body.append('idempotency_key', idempotencyKey.current);
      const res = await fetch(`/api/conversations/${c.id}/reply-video`, { method: 'POST', body });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.data?.sent) {
        toast.error(json?.error?.message_th ?? json?.data?.reason_th ?? 'ส่งวิดีโอไม่สำเร็จ');
        return;
      }
      clearVideo();
      idempotencyKey.current = newIdempotencyKey();
      stickBottomRef.current = true;
      await loadMessages();
      onChanged();
    } catch (err) {
      toast.error('ส่งวิดีโอไม่สำเร็จ', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setUploading(false);
    }
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
        // ⭐ ส่งเองแล้วต้องเห็นของตัวเองทันที ถึงจะเลื่อนขึ้นไปอ่านของเก่าค้างอยู่ก็ตาม
        stickBottomRef.current = true;
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
    if ((!body && cannedImages.length === 0) || sending) return;
    setSending(true);
    try {
      // ชุดคำตอบต้องมีรูปไปถึงลูกค้าก่อนข้อความเสมอ ถ้ารูปใดส่งไม่สำเร็จจะหยุดทันที
      for (let index = 0; index < cannedImages.length; index += 1) {
        const image = cannedImages[index];
        const mediaRes = await fetch(`/api/conversations/${c.id}/reply-image-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: image.url,
            idempotency_key: `${idempotencyKey.current}-image-${index + 1}`,
          }),
        });
        const mediaJson = await mediaRes.json();
        if (!mediaRes.ok || !mediaJson.ok || !mediaJson.data?.sent) {
          toast.error(mediaJson?.error?.message_th ?? mediaJson?.data?.reason_th ?? 'ส่งรูปของชุดคำตอบไม่สำเร็จ');
          return;
        }
      }

      if (!body) {
        setCannedImages([]);
        idempotencyKey.current = newIdempotencyKey();
        stickBottomRef.current = true;
        await loadMessages();
        onChanged();
        return;
      }

      const res = await fetch(`/api/conversations/${c.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: body,
          idempotency_key: idempotencyKey.current,
          // ⭐ ส่ง id ของข้อความในระบบเรา ไม่ใช่ mid ของ Meta (เซิร์ฟเวอร์แปลงให้เอง)
          reply_to_message_id: replyTarget?.id ?? null,
        }),
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
        setCannedImages([]);
        setReplyTarget(null);
        idempotencyKey.current = newIdempotencyKey(); // กุญแจใหม่สำหรับข้อความถัดไป
        // ⭐ ส่งเองแล้วต้องเห็นของตัวเองทันที ถึงจะเลื่อนขึ้นไปอ่านของเก่าค้างอยู่ก็ตาม
        stickBottomRef.current = true;
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

  async function changeInboxState(
    input:
      | { action: 'important'; value: boolean }
      | { action: 'status'; value: 'active' | 'done' | 'spam' }
      | { action: 'assignment'; value: 'me' | 'none' }
      | { action: 'confirm_spam_restored'; value: true },
    success: string,
  ) {
    setStateBusy(true);
    try {
      const result = await apiCall<Record<string, unknown>>(`/api/conversations/${c.id}/inbox-state`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (!result) return;
      toast.success(success);
      onStateChanged();
    } finally {
      setStateBusy(false);
    }
  }

  const profileUrl = customerProfileUrl(c.page.platform, c.username);
  const replyHint = windowHint(c.last_customer_message_at);

  return (
    <div className="flex h-full flex-col rounded-lg border">
      {/* ---------- หัวห้อง ---------- */}
      <header className="border-b bg-card/60 px-2.5 py-2">
        <div className="flex items-start gap-2.5">
          <Button variant="ghost" size="icon" className="-ml-2 size-9 md:hidden" onClick={onBack} aria-label="กลับ">
            <ArrowLeft />
          </Button>
          {profileUrl ? (
            <a href={profileUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="เปิดโปรไฟล์ลูกค้า">
              <CustomerAvatar name={displayName(c)} src={c.profile_pic_url} size="md" />
            </a>
          ) : <CustomerAvatar name={displayName(c)} src={c.profile_pic_url} size="md" />}

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              {profileUrl ? (
                <a href={profileUrl} target="_blank" rel="noreferrer" className="min-w-0 break-words text-base font-semibold leading-5 hover:underline">
                  {displayName(c)} <ExternalLink className="mb-0.5 inline size-3.5" />
                </a>
              ) : <h2 className="min-w-0 break-words text-base font-semibold leading-5">{displayName(c)}</h2>}
              {c.order_count > 0 && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white"><ShoppingCart className="size-3" />{c.order_count}</span>}
              {c.order_count > 0 && <Star className="mt-0.5 size-4 shrink-0 fill-amber-500 text-amber-500" aria-label="ติดตามผล" />}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ backgroundColor: c.page.tag_color }} />{c.page.platform === 'instagram' ? 'Instagram' : 'Messenger'} · {c.page.name}</span>
              {c.username && <span>@{c.username}</span>}
              {c.phone && <button type="button" className="inline-flex items-center gap-1 underline decoration-dotted" onClick={() => void copyText(c.phone!).then((done) => done ? toast.success('คัดลอกเบอร์แล้ว') : toast.error('คัดลอกไม่สำเร็จ'))}><Phone className="size-3" />{c.phone}</button>}
              {!hasRealName(c) && <RefreshNameButton conversationId={c.id} reason={c.profile_error_th} />}
            </div>
          </div>
        </div>

        {policy && !policy.can_send ? (
          <button
            type="button"
            onClick={() => toast.error(policy.detail_th ?? policy.label_th, {
              description: policy.alternatives_th.length ? `ทำได้: ${policy.alternatives_th.join(' · ')}` : undefined,
              duration: 10_000,
            })}
            className="mt-2 flex w-full items-start gap-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-left text-xs text-destructive hover:bg-destructive/15"
          >
            <MessageSquareOff className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{policy.badge_th ?? 'ส่งไม่ได้ตามนโยบาย Meta'}</span>
              {replyHint && <span className="block text-[11px] opacity-80">{replyHint.text}</span>}
            </span>
          </button>
        ) : replyHint ? (
          <div className={cn(
            'mt-2 flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs',
            replyHint.tone === 'warn' && 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
            replyHint.tone === 'over' && 'bg-destructive/10 text-destructive',
          )}>
            <MessageSquareOff className="size-4 shrink-0" />
            <span>{replyHint.text}</span>
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-0 md:pl-12" aria-label="การทำงานของห้องแชท">
          {canReply && <Button variant={c.is_important ? 'secondary' : 'outline'} size="icon" className="size-9" disabled={stateBusy} aria-label={c.is_important ? 'ยกเลิกสำคัญ' : 'ทำเครื่องหมายว่าสำคัญ'} title={c.is_important ? 'ยกเลิกสำคัญ' : 'สำคัญ'} onClick={() => void changeInboxState({ action: 'important', value: !c.is_important }, c.is_important ? 'นำออกจากกลุ่มสำคัญแล้ว' : 'เพิ่มในกลุ่มสำคัญแล้ว')}><Star className={cn('size-4', c.is_important && 'fill-amber-500 text-amber-500')} /></Button>}
          {canReply && c.inbox_status !== 'spam' && <Button variant={c.inbox_status === 'done' ? 'secondary' : 'outline'} size="icon" className="size-9" disabled={stateBusy} aria-label={c.inbox_status === 'done' ? 'เปิดแชทอีกครั้ง' : 'ทำเครื่องหมายว่าเรียบร้อย'} title={c.inbox_status === 'done' ? 'เปิดแชทอีกครั้ง' : 'เรียบร้อย'} onClick={() => void changeInboxState({ action: 'status', value: c.inbox_status === 'done' ? 'active' : 'done' }, c.inbox_status === 'done' ? 'เปิดแชทอีกครั้งแล้ว' : 'ย้ายไปกลุ่มเรียบร้อยแล้ว')}><CheckCircle2 className="size-4" /></Button>}
          {canReply && c.inbox_status !== 'spam' && <Button variant="outline" size="icon" className="size-9 text-destructive hover:text-destructive" disabled={stateBusy} aria-label="ย้ายไปสแปมและซิงก์ Meta" title="สแปม · ซิงก์ Meta" onClick={() => { if (window.confirm('ย้ายแชทนี้ไปสแปมทั้งใน HubChat และ Meta Business Suite ใช่ไหม?')) void changeInboxState({ action: 'status', value: 'spam' }, 'ย้ายไปสแปมและซิงก์ Meta แล้ว'); }}><ShieldAlert className="size-4" /></Button>}
          {canReply && c.inbox_status === 'spam' && <Button variant="outline" size="icon" className="size-9" disabled={stateBusy} aria-label="ยืนยันว่าคืนจากสแปมใน Business Suite แล้ว" title="คืนจากสแปมแล้ว" onClick={() => { if (window.confirm('คุณคืนแชทนี้ออกจากสแปมใน Meta Business Suite แล้วใช่ไหม?')) void changeInboxState({ action: 'confirm_spam_restored', value: true }, 'คืนแชทเข้าอินบ็อกซ์ HubChat แล้ว'); }}><RefreshCw className="size-4" /></Button>}
          {canReply && <Button variant={c.assigned_admin_id === meId ? 'secondary' : 'outline'} size="icon" className="size-9" disabled={stateBusy} aria-label={c.assigned_admin_id === meId ? 'ยกเลิกการมอบหมาย' : 'มอบหมายให้ฉัน'} title={c.assigned_admin_id === meId ? 'ยกเลิกการมอบหมาย' : 'มอบหมายให้ฉัน'} onClick={() => void changeInboxState({ action: 'assignment', value: c.assigned_admin_id === meId ? 'none' : 'me' }, c.assigned_admin_id === meId ? 'ยกเลิกการมอบหมายแล้ว' : 'มอบหมายให้คุณแล้ว')}><UserCheck className="size-4" /></Button>}
          {profileUrl ? (
            <Button asChild variant="outline" size="icon" className="size-9"><a href={profileUrl} target="_blank" rel="noreferrer" aria-label="เปิดโปรไฟล์ลูกค้า" title="เปิดโปรไฟล์ลูกค้า"><ExternalLink className="size-4" /></a></Button>
          ) : (
            <Button
              variant="outline"
              size="icon"
              className="size-9"
              aria-label="ดึงหรือเปิดโปรไฟล์ลูกค้า"
              title="ดึงหรือเปิดโปรไฟล์ลูกค้า"
              onClick={() => {
                if (c.page.platform === 'facebook') {
                  toast.info('Facebook ไม่คืน public profile link จาก PSID — ระบบจึงไม่เดาลิงก์ผิดคน');
                  return;
                }
                void fetch(`/api/conversations/${c.id}/refresh-profile`, { method: 'POST' })
                  .then((res) => res.json())
                  .then((json) => {
                    if (!json.ok) throw new Error(json?.error?.message_th ?? 'ดึงโปรไฟล์ไม่สำเร็จ');
                    toast.success('ดึง username จาก Instagram แล้ว');
                    onChanged();
                  })
                  .catch((err) => toast.error(err instanceof Error ? err.message : 'ดึงโปรไฟล์ไม่สำเร็จ'));
              }}
            >
              <RefreshCw className="size-4" />
            </Button>
          )}
          <Button variant="outline" size="icon" className="size-9" aria-label="ข้อมูลลูกค้า" title="ข้อมูลลูกค้า" onClick={() => setDrawerOpen(true)}><User className="size-4" /></Button>
          {canReply && <Button variant="outline" size="icon" className="size-9" aria-label="สร้างออเดอร์" title="สร้างออเดอร์" onClick={() => { setOrderSource(null); setOrderOpen(true); }}><ShoppingCart className="size-4" /></Button>}
          {canReply && <Button variant="outline" size="icon" className="size-9" aria-label="ป้ายและกลุ่ม" title="ป้ายและกลุ่ม" onClick={() => setTagsOpen(true)}><TagIcon className="size-4" /></Button>}
        </div>
      </header>

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
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-3">
          {/* ⭐ ปุ่มโหลดของเก่า — เดิมเห็นได้แค่ชุดล่าสุดเท่านั้น เลื่อนขึ้นไปก็ไม่มีอะไรเพิ่ม */}
          {hasOlder && (
            <div className="mb-2 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => void loadOlder()} disabled={loadingOlder}>
                {loadingOlder ? <Loader2 className="animate-spin" /> : <ChevronUp />}
                ดูข้อความเก่ากว่านี้
              </Button>
            </div>
          )}
          {messages !== null && messages.length > 0 && !hasOlder && (
            <p className="mb-2 text-center text-[11px] text-muted-foreground">— ต้นห้องแชท —</p>
          )}

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
              {messages.map((m, i) => {
                // ⭐ ป้ายคั่นวัน — จำเป็นมากเมื่อดึงแชทเก่าเข้ามาเป็นปี ๆ
                const prev = i > 0 ? messages[i - 1] : null;
                const showDay = prev === null || !isSameDayIso(prev.created_at, m.created_at);
                return (
                  <div key={m.id} className="flex flex-col gap-2">
                    {showDay && (
                      <div className="my-1 flex items-center gap-2">
                        <span className="h-px flex-1 bg-border" />
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {dayLabelTh(m.created_at)}
                        </span>
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    )}
                    <MessageBubble
                      message={m}
                      onTap={() => setMenuFor(m)}
                      onSwipeRight={() => replyTo(m)}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* ⭐ ปุ่มลงล่างสุด — โผล่เฉพาะตอนเลื่อนขึ้นไปอ่านของเก่าอยู่ */}
        {!atBottom && messages !== null && messages.length > 0 && (
          <Button
            size="sm"
            variant={newBelow ? 'default' : 'secondary'}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
            onClick={jumpToBottom}
          >
            <ArrowDown />
            {newBelow ? 'มีข้อความใหม่' : 'ลงล่างสุด'}
          </Button>
        )}
      </div>

      {/* ---------- ช่องพิมพ์ ---------- */}
      <div className="relative border-t p-2">
        {canReply && (
          <div className="mb-1.5 flex items-center gap-1" aria-label="เครื่องมือแชท">
            <Button variant={browseCanned ? 'secondary' : 'ghost'} size="icon" className="size-8" aria-label="ชุดคำตอบ" title="ชุดคำตอบ" onClick={() => { setBrowseCanned((open) => !open); setDismissedCanned(false); }} disabled={sending || uploading}>
              <Images className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" aria-label="สินค้าและโปรโมชัน" title="สินค้าและโปรโมชัน" onClick={() => setProductOpen(true)} disabled={sending || uploading}>
              <Package className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" aria-label="คลังรูป" title="คลังรูป" onClick={() => setLibraryKind('image')} disabled={sending || uploading}>
              <ImageIcon className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" aria-label="คลังวิดีโอ" title="คลังวิดีโอ" onClick={() => setLibraryKind('video')} disabled={sending || uploading}>
              <Video className="size-4" />
            </Button>
          </div>
        )}

        {/* รายการชุดคำตอบที่ลอยขึ้นมาเมื่อพิมพ์ / */}
        {cannedVisible.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 z-10 mb-1 max-h-64 overflow-y-auto rounded-lg border bg-popover shadow-lg">
            {cannedVisible.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void applyCanned(item)}
                className="flex w-full gap-2 border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent"
              >
                {item.images[0]?.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.images[0].url} alt="" className="size-12 shrink-0 rounded-md border object-cover" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {item.title}
                    {item.shortcut && <Badge variant="secondary" className="font-mono text-[10px]">/{item.shortcut}</Badge>}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{item.text}</span>
                  <span className="text-[10px] text-muted-foreground">{item.images.length} รูป</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ---------- ⭐ กำลังตอบกลับข้อความไหน ---------- */}
        {canReply && replyTarget && (
          /**
           * ⚠️ ต้องเห็นชัดว่ากำลังตอบกลับอะไรอยู่ และยกเลิกได้ง่าย
           *    ถ้าซ่อนไว้ แอดมินจะเผลอตอบกลับข้อความเก่าโดยไม่รู้ตัว
           *    แล้วลูกค้าจะเห็นเส้นโยงไปข้อความที่ไม่เกี่ยวกัน
           */
          <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-l-primary bg-muted/50 px-2.5 py-1.5">
            <Reply className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-muted-foreground">
                ตอบกลับ{replyTarget.direction === 'in' ? 'ลูกค้า' : 'ข้อความของเรา'}
              </div>
              <div className="truncate text-xs">
                {replyTarget.text || '[ไฟล์แนบ]'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyTarget(null)}
              className="shrink-0 rounded p-0.5 hover:bg-accent"
              aria-label="ยกเลิกการตอบกลับ"
            >
              <X className="size-3.5" />
            </button>
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

        {canReply && cannedImages.length > 0 && (
          <div className="mb-2 rounded-md border p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-xs font-medium">รูปจากชุดคำตอบ ({cannedImages.length})</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCannedImages([])}>เอาออกทั้งหมด</Button>
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {cannedImages.map((image, index) => (
                <div key={`${image.url}-${index}`} className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt={image.name ?? 'รูปชุดคำตอบ'} className="size-20 rounded-md border object-cover" />
                  <button type="button" className="absolute -right-1 -top-1 rounded-full bg-background p-0.5 shadow" aria-label="เอารูปออก" onClick={() => setCannedImages((prev) => prev.filter((_, i) => i !== index))}><X className="size-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {canReply && pendingVideo && (
          <div className="mb-2 flex items-center gap-2 rounded-md border p-2">
            <video src={pendingVideo.preview} controls className="h-24 w-36 shrink-0 rounded bg-black object-contain" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{pendingVideo.file.name}</p>
              <p className="text-[11px] text-muted-foreground">{(pendingVideo.file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <Button size="sm" onClick={() => void sendVideo()} disabled={uploading}>{uploading ? <Loader2 className="animate-spin" /> : <Send />} ส่งวิดีโอ</Button>
            <Button size="icon" variant="ghost" aria-label="เอาวิดีโอออก" onClick={clearVideo} disabled={uploading}><X /></Button>
          </div>
        )}

        {canReply && pendingLibrary && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2">
            {pendingLibrary.mime.startsWith('video/')
              ? <video src={pendingLibrary.preview_url} className="h-20 w-28 shrink-0 rounded bg-black object-contain" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={pendingLibrary.preview_url} alt="สื่อจากคลัง" className="size-16 shrink-0 rounded object-cover" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{pendingLibrary.mime.startsWith('video/') ? 'วิดีโอจากคลัง' : 'รูปจากคลัง'}</p>
              <p className="text-[11px] text-muted-foreground">{(pendingLibrary.bytes / 1024 / 1024).toFixed(1)} MB · ตรวจตัวอย่างก่อนส่ง</p>
            </div>
            <Button size="sm" onClick={() => void sendLibraryMedia()} disabled={uploading}>{uploading ? <Loader2 className="animate-spin" /> : <Send />} ส่ง</Button>
            <Button size="icon" variant="ghost" className="size-9" aria-label="เอาไฟล์จากคลังออก" onClick={() => setPendingLibrary(null)} disabled={uploading}><X /></Button>
          </div>
        )}

        {!canReply ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            บัญชีของคุณดูได้อย่างเดียว ตอบแชทไม่ได้
          </p>
        ) : (
          <div className="flex items-end gap-1.5">
            {/* Paperclip = แนบไฟล์ใหม่จากเครื่อง ส่วนคลังรูป/วิดีโออยู่แถบบน */}
            <input
              ref={fileRef}
              type="file"
              accept={[...ALLOWED_IMAGE_MIMES, ...ALLOWED_VIDEO_MIMES].join(',')}
              className="hidden"
              onChange={(event) => pickAttachment(event.target.files?.[0] ?? null)}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label="แนบรูปหรือวิดีโอใหม่จากเครื่อง"
              title="แนบไฟล์ใหม่จากเครื่อง"
              disabled={sending || uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip />
            </Button>
            <textarea
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
              rows={1}
              placeholder="พิมพ์ข้อความ… (Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่ · / ค้นชุดคำตอบ)"
              disabled={sending}
              className="min-h-11 max-h-[10rem] min-w-0 flex-1 resize-none overflow-y-hidden rounded-xl border bg-background px-3 py-2 text-base leading-6 outline-none shadow-xs transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
            />
            <Button className="h-11 px-3" onClick={() => void send()} disabled={sending || (text.trim().length === 0 && cannedImages.length === 0)}>
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              <span className="hidden sm:inline">ส่ง</span>
            </Button>
          </div>
        )}

        {/**
          * ⭐ เหตุผลเต็มอยู่ตรงนี้ ไม่ใช่บนหัวห้อง
          *    เพราะเป็นจังหวะที่แอดมินกำลังจะพิมพ์พอดี = ต้องการคำอธิบายตอนนี้
          *    และตรงนี้มีความกว้างเต็มบรรทัดให้ข้อความยาวได้โดยไม่ดันอะไรพัง
          */}
      </div>

      {/* ---------- แผงข้อมูลลูกค้า (ข้อ 1.6 / 1.11) ---------- */}
      <CustomerDrawer
        conversationId={c.id}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        /**
         * ⭐ วางข้อความลงช่องพิมพ์เท่านั้น ไม่ส่งเอง
         *    ต่อท้ายของเดิมถ้ามี เพื่อไม่ให้ลบสิ่งที่แอดมินพิมพ์ค้างไว้
         */
        onInsertText={(t) => {
          setText((prev) => (prev.trim() ? `${prev}\n${t}` : t));
          inputRef.current?.focus();
        }}
      />

      <ProductPicker
        conversationId={c.id}
        open={productOpen}
        onClose={() => setProductOpen(false)}
        onInsertText={(t) => {
          setText((prev) => (prev.trim() ? `${prev}\n${t}` : t));
          inputRef.current?.focus();
        }}
      />

      <MediaLibraryPicker
        kind={libraryKind}
        onClose={() => setLibraryKind(null)}
        onSelect={(item) => { setPendingLibrary(item); setLibraryKind(null); }}
      />

      {/* ---------- เมนูแตะข้อความ ---------- */}
      <MessageMenu
        message={menuFor}
        onClose={() => setMenuFor(null)}
        onCopyToInput={(m) => {
          setText(m.text ?? '');
          setMenuFor(null);
          inputRef.current?.focus();
        }}
        onQuote={replyTo}
        onExtract={(m) => {
          setContactSource(m.text ?? '');
          setMenuFor(null);
        }}
        onCreateOrder={(m) => { setOrderSource(m); setOrderOpen(true); setMenuFor(null); }}
        onUseMedia={(mediaId) => { setMediaOrder({ mediaId }); setMenuFor(null); }}
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
        sourceText={orderSource?.text ?? null}
        sourceMessageId={orderSource?.id ?? null}
        onClose={() => { setOrderOpen(false); setOrderSource(null); }}
        onCreated={onChanged}
      />

      <MediaOrderDialog
        conversationId={c.id}
        mediaId={mediaOrder?.mediaId ?? null}
        onClose={() => setMediaOrder(null)}
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

function MediaLibraryPicker({
  kind,
  onClose,
  onSelect,
}: {
  kind: 'image' | 'video' | null;
  onClose: () => void;
  onSelect: (item: LibraryItem) => void;
}) {
  const [loaded, setLoaded] = useState<{ kind: 'image' | 'video'; items: LibraryItem[] } | null>(null);

  useEffect(() => {
    if (!kind) return;
    let alive = true;
    void fetch('/api/media-library', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (!alive) return;
        if (!json.ok) throw new Error(json?.error?.message_th ?? 'อ่านคลังสื่อไม่สำเร็จ');
        const all = json.data.items as LibraryItem[];
        setLoaded({ kind, items: all.filter((item) => kind === 'video' ? item.mime.startsWith('video/') : item.mime.startsWith('image/')) });
      })
      .catch((err) => {
        if (alive) { setLoaded({ kind, items: [] }); toast.error(err instanceof Error ? err.message : 'อ่านคลังสื่อไม่สำเร็จ'); }
      });
    return () => { alive = false; };
  }, [kind]);

  const items = kind && loaded?.kind === kind ? loaded.items : null;

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bottom-0 left-0 top-auto w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-3xl p-4 sm:left-1/2 sm:top-1/2 sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>{kind === 'video' ? 'เลือกจากคลังวิดีโอ' : 'เลือกจากคลังรูป'}</DialogTitle>
          <DialogDescription>เลือกไฟล์แล้วระบบจะนำมาพรีวิวในห้องแชทก่อน คุณต้องกดส่งอีกครั้ง</DialogDescription>
        </DialogHeader>
        {items === null ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
            ยังไม่มี{kind === 'video' ? 'วิดีโอ' : 'รูป'}ในคลัง<br />เพิ่มไฟล์ได้ที่เมนู “คลังสื่อ”
          </div>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {items.map((item) => (
              <button key={item.id} type="button" onClick={() => onSelect(item)} className="overflow-hidden rounded-xl border text-left transition hover:border-primary hover:ring-2 hover:ring-primary/20">
                {item.mime.startsWith('video/')
                  ? <video src={item.preview_url} muted preload="metadata" className="aspect-video w-full bg-black object-contain" />
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img src={item.preview_url} alt="รูปในคลัง" className="aspect-video w-full object-cover" />}
                <span className="block px-2 py-1.5 text-[11px] text-muted-foreground">{(item.bytes / 1024 / 1024).toFixed(1)} MB · เลือก</span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------ */
/* ปุ่ม "ลองดึงชื่ออีกครั้ง" (D-33)                                              */
/* ------------------------------------------------------------------------ */

/**
 * ⚠️ ปุ่มนี้ขึ้นเฉพาะตอน "ยังไม่รู้ชื่อจริง" เท่านั้น
 *    ถ้ารู้ชื่อแล้วต้องหายไป ไม่งั้นจะกลายเป็นปุ่มรกที่ไม่มีใครใช้
 */
function RefreshNameButton({
  conversationId,
  reason,
}: {
  conversationId: string;
  reason?: string | null;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/refresh-profile`, { method: 'POST' });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { name: string | null };
        error?: { message_th: string };
      };
      if (json.ok) {
        toast.success(json.data?.name ? `ได้ชื่อแล้ว : ${json.data.name}` : 'ดึงข้อมูลได้แล้ว');
        window.location.reload();
      } else {
        // ⭐ บอกเหตุผลจริงที่ทำอะไรต่อได้ ไม่ใช่ "ไม่สำเร็จ" ลอย ๆ
        toast.error(json.error?.message_th ?? 'ดึงชื่อไม่สำเร็จ', { duration: 10_000 });
      }
    } catch {
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      title={reason ?? 'ยังไม่รู้ชื่อจริงของลูกค้ารายนี้ — กดเพื่อลองดึงจาก Meta อีกครั้ง'}
      className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] text-muted-foreground hover:bg-accent disabled:opacity-50"
      aria-label="ลองดึงชื่อลูกค้าอีกครั้ง"
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
      ดึงชื่อ
    </button>
  );
}

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

  /** ปัดขวา → ตอบกลับข้อความนี้ทันที (สเปก 5.1) */
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
        {/**
          * ⭐ ข้อความที่ถูกตอบกลับ — แสดงเป็นแถบเล็กในฟอง ไม่ใช่ปนกับเนื้อข้อความ
          *
          * 🔴 ไม่ใส่ป้าย "ตอบกลับแล้ว" ต่างกันตาม reply_native โดยตั้งใจ
          *    เพราะในมุมแอดมิน มันคือการตอบกลับเหมือนกันทั้งสองแบบ
          *    ความต่างอยู่ที่ "ลูกค้าเห็นเส้นโยงในแอป Meta ไหม" ซึ่งเป็นเรื่องของ
          *    ความสามารถของช่องทาง ไม่ใช่สิ่งที่แอดมินควบคุมได้
          *    (แต่ฐานข้อมูลเก็บความจริงไว้ครบ เผื่อวันหนึ่งต้องไล่ตรวจ)
          */}
        {m.reply_to_message_id && (
          <span
            className={cn(
              'mb-1 block rounded border-l-2 px-2 py-1 text-xs',
              outgoing
                ? 'border-l-primary-foreground/50 bg-primary-foreground/10 text-primary-foreground/80'
                : 'border-l-muted-foreground/40 bg-background/60 text-muted-foreground',
            )}
          >
            {m.reply_preview
              ? (m.reply_preview.text || '[ไฟล์แนบ]')
              : 'ข้อความต้นทางถูกลบไปแล้ว'}
          </span>
        )}

        {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}

        {m.attachments.map((a, i) => {
          /**
           * ⭐ ใช้สำเนาที่เราเก็บไว้เองก่อนเสมอ (D-17)
           *    ลิงก์ของ Meta เป็นของชั่วคราว เปิดได้แค่ช่วงแรกเท่านั้น
           *    ถ้ามี media_id แปลว่าเราเก็บไฟล์ไว้แล้ว → เปิดได้ตลอดไป
           */
          const src = a.media_id ? `/api/media/${a.media_id}` : a.url;
          const durable = Boolean(a.media_id);

          if (a.type === 'image' && src) {
            return (
              <span key={i} className="mt-1 block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt="รูปที่แนบมา"
                  loading="lazy"
                  className="max-h-56 w-full rounded-lg object-cover"
                  onError={(e) => {
                    const el = e.currentTarget;
                    el.style.display = 'none';
                    const note = el.nextElementSibling as HTMLElement | null;
                    if (note) note.style.display = 'block';
                  }}
                />
                <span style={{ display: 'none' }} className="text-xs opacity-80">
                  {durable
                    ? '🖼️ เปิดรูปไม่ได้ ลองรีเฟรชหน้าอีกครั้ง'
                    : '🖼️ รูปหมดอายุแล้ว (ยังไม่ได้ตั้งค่าที่เก็บไฟล์) — เปิดดูใน Messenger แทน'}
                </span>
              </span>
            );
          }

          if (a.type === 'video' && src) {
            return (
              <span key={i} className="mt-1 block" onClick={(event) => event.stopPropagation()}>
                <video src={src} controls preload="metadata" className="max-h-72 w-full rounded-lg bg-black" />
              </span>
            );
          }

          if (src) {
            return (
              <a
                key={i}
                href={src}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block text-xs underline opacity-80"
                onClick={(e) => e.stopPropagation()}
              >
                [เปิดไฟล์แนบ {a.type}]
              </a>
            );
          }

          return (
            <span key={i} className="mt-1 block text-xs opacity-80">
              [ไฟล์แนบ {a.type}]
            </span>
          );
        })}
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
  onCreateOrder,
  onUseMedia,
}: {
  message: MessageRow | null;
  onClose: () => void;
  onCopyToInput: (m: MessageRow) => void;
  onQuote: (m: MessageRow) => void;
  onExtract: (m: MessageRow) => void;
  onCreateOrder: (m: MessageRow) => void;
  onUseMedia: (mediaId: string) => void;
}) {
  /**
   * ⭐ เมนูนี้เป็นของ "ข้อความนี้" เท่านั้น
   *    ห้ามเอา action ระดับห้อง (แท็ก / สร้างออเดอร์เปล่า / ข้อมูลจัดส่ง) มาปนที่นี่
   *    เพราะเวลาแอดมินแตะข้อความ เขากำลังคิดถึงข้อความนั้น ไม่ใช่ทั้งห้อง
   *    ของระดับห้องอยู่บนหัวห้องซึ่งเป็นที่ที่มองหาโดยสัญชาตญาณอยู่แล้ว
   *
   * ลำดับเรียงตาม "ความถี่ที่ใช้จริง" ไม่ใช่ตามตัวอักษร
   * ตอบกลับคือสิ่งที่ทำบ่อยที่สุด จึงอยู่บนสุด
   */
  const mediaId = message?.attachments.find((attachment) => attachment.media_id)?.media_id ?? null;
  const items = message
    ? [
        { icon: Reply, label: 'ตอบกลับข้อความนี้', run: () => onQuote(message) },
        { icon: MapPin, label: 'ดึงข้อมูลลูกค้าจากข้อความนี้', run: () => onExtract(message) },
        { icon: ShoppingCart, label: 'สร้างออเดอร์จากข้อความนี้', run: () => onCreateOrder(message) },
        ...(mediaId ? [{ icon: Package, label: 'แนบรูปนี้กับออเดอร์ / ตั้งเป็นสลิป', run: () => onUseMedia(mediaId) }] : []),
        { icon: ClipboardCopy, label: 'คัดลอกไปช่องพิมพ์', run: () => onCopyToInput(message) },
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

      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */

function MediaOrderDialog({
  conversationId, mediaId, onClose,
}: { conversationId: string; mediaId: string | null; onClose: () => void }) {
  const [orders, setOrders] = useState<Array<{ id: string; order_no: string }>>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mediaId) return;
    void apiCall<{ orders: Array<{ id: string; order_no: string }> }>(
      `/api/orders?conversation_id=${encodeURIComponent(conversationId)}`,
    ).then((data) => {
      const found = data?.orders ?? [];
      setOrders(found);
      setSelected(found[0]?.id ?? '');
    });
  }, [conversationId, mediaId]);

  async function link(purpose: 'attachment' | 'payment_slip') {
    if (!mediaId || !selected) return;
    setBusy(true);
    try {
      const result = await apiCall(`/api/orders/${selected}/media`, {
        method: 'POST', body: JSON.stringify({ media_id: mediaId, purpose }),
      });
      if (!result) throw new Error('ผูกรูปไม่สำเร็จ');
      toast.success(purpose === 'payment_slip' ? 'ตั้งรูปเป็นสลิปแล้ว' : 'แนบรูปกับออเดอร์แล้ว');
      onClose();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'ผูกรูปไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={mediaId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>ใช้รูปกับออเดอร์</DialogTitle><DialogDescription>เลือกได้เฉพาะออเดอร์ของห้องแชทนี้</DialogDescription></DialogHeader>
        {orders.length === 0 ? <p className="text-sm text-muted-foreground">ห้องนี้ยังไม่มีออเดอร์ สร้างออเดอร์ก่อนแล้วกลับมาเลือกอีกครั้ง</p> : (
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={selected} onChange={(event) => setSelected(event.target.value)}>
            {orders.map((order) => <option key={order.id} value={order.id}>{order.order_no}</option>)}
          </select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button variant="secondary" disabled={!selected || busy} onClick={() => void link('attachment')}>แนบกับออเดอร์</Button>
          <Button disabled={!selected || busy} onClick={() => void link('payment_slip')}>ตั้งเป็นสลิป</Button>
        </DialogFooter>
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
