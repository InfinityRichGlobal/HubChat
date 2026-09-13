'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, ArrowDown, Check, CheckCheck, ChevronDown, ChevronUp, ClipboardCopy, Copy, ExternalLink, ImageIcon, Images,
  Bot, CheckCircle2, Clock, Handshake, Inbox, Layers, Loader2, Lock, MapPin, MessageCircle, MessageSquareOff,
  Megaphone, Package, Paperclip, Phone, Reply, RefreshCw, Search, Send, ShieldAlert, ShoppingBag, ShoppingCart,
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
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import CustomerAvatar from '@/components/customer-avatar';
import PlatformIcon from '@/components/platform-icon';
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

function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

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
  public_url?: string;
  categories?: string[];
  is_hidden?: boolean;
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

export type OrderFilterGroup = 'all' | '0' | '1' | '2' | '3' | '4' | '5_10' | '11_plus';

const ORDER_FILTER_LABELS: Record<OrderFilterGroup, string> = {
  all: 'ทั้งหมด',
  '0': '0 ออเดอร์ (ยังไม่สั่ง)',
  '1': '1 ออเดอร์ (สั่งครั้งแรก)',
  '2': '2 ออเดอร์ (ซื้อซ้ำ)',
  '3': '3 ออเดอร์',
  '4': '4 ออเดอร์',
  '5_10': '5 - 10 ออเดอร์ (ลูกค้าประจำ)',
  '11_plus': '11+ ออเดอร์ (ลูกค้า VIP)',
};

export default function InboxClient({
  me,
  canReply,
  initialConversations,
  initialHasMore,
  initialConversationId,
  pages,
  admins = [],
}: {
  me: { id: string; name: string };
  canReply: boolean;
  initialConversations: ConversationRow[];
  /** ชุดแรกที่เสิร์ฟเวอร์ส่งมาชนเพดานไหม */
  initialHasMore: boolean;
  /** เปิดห้องนี้ทันที — มาจาก /inbox?c=... ที่หน้าออเดอร์ลิงก์มา */
  initialConversationId?: string | null;
  pages: InboxPage[];
  admins?: Array<{ id: string; name: string }>;
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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const q = sp.get('search');
      if (q) setSearch(q);
    }
    const handleCustomSearch = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      setSearch(customEvent.detail ?? '');
    };
    window.addEventListener('hubchat:search', handleCustomSearch);
    return () => window.removeEventListener('hubchat:search', handleCustomSearch);
  }, []);
  const [inboxGroup, setInboxGroup] = useState<InboxGroup>('all');
  const [orderFilter, setOrderFilter] = useState<OrderFilterGroup>('all');
  const [assignedAdminFilter, setAssignedAdminFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ควบคุมการเปิดปิดดรอปดาวน์ในแถบฟิลเตอร์บนมือถือ
  const [openDropdown, setOpenDropdown] = useState<'tags' | 'admins' | 'platform' | 'order' | null>(null);
  const isTouchRef = useRef(false);
  const isSwipingRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleFilterTouchStart = (e: React.TouchEvent) => {
    isTouchRef.current = true;
    if (e.touches.length > 0) {
      touchStartPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      isSwipingRef.current = false;
    }
  };

  const handleFilterTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current || e.touches.length === 0) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartPosRef.current.x);
    const dy = Math.abs(e.touches[0].clientY - touchStartPosRef.current.y);
    if (dx > 6 || dy > 6) {
      isSwipingRef.current = true;
      setOpenDropdown(null);
    }
  };

  const handleFilterTouchEnd = () => {
    touchStartPosRef.current = null;
    setTimeout(() => {
      isSwipingRef.current = false;
    }, 120);
  };
  const router = useRouter();
  const searchParams = useSearchParams();
  const cParam = searchParams?.get('c') ?? initialConversationId ?? null;

  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);

  // อัปเดต activeId เมื่อ query param เปลี่ยน (เช่น กดมาจากแจ้งเตือน, กด back เบราว์เซอร์ หรือปัดขวาบนมือถือ)
  useEffect(() => {
    const currentC = searchParams?.get('c') ?? null;
    setActiveId(currentC);
  }, [searchParams]);

  // ดักฟัง popstate ของเบราว์เซอร์ (เช่น ปัดขอบจอย้อนกลับบน iOS / Safari PWA หรือกดปุ่ม Back)
  // ให้สลับ activeId ทันทีแบบ synchronous 0ms ไม่ต้องรอ transition ของ Next.js router
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      try {
        const sp = new URLSearchParams(window.location.search);
        setActiveId(sp.get('c'));
      } catch (_) {}
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // ดักฟังข้อความจาก Service Worker เมื่อกด Push Notification ขณะเปิดแอปอยู่
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'HUBCHAT_NAVIGATE' && event.data.link) {
        try {
          const url = new URL(event.data.link, window.location.origin);
          const c = url.searchParams.get('c');
          if (c) {
            setActiveId(c);
            router.replace(`/inbox?c=${c}`);
          }
        } catch (_) {}
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [router]);

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

  // ถ้ามี activeId แต่ยังไม่มีในลิสต์ (เช่น แชทใหม่ที่ทักมาแล้วกดเปิดจากแจ้งเตือน) ให้โหลดรายการใหม่ทันที
  useEffect(() => {
    if (activeId && !conversations.some((c) => c.id === activeId)) {
      void loadList();
    }
  }, [activeId, conversations, loadList]);

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
    const timer = setInterval(poll, 4000);
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
  const filterCount =
    selectedPages.length +
    selectedTags.length +
    Number(inboxGroup !== 'all') +
    Number(orderFilter !== 'all') +
    Number(assignedAdminFilter !== 'all') +
    Number(platformFilter !== 'all');

  const displayedConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (inboxGroup === 'follow_up' && !c.is_important && c.order_count === 0) return false;
      if (inboxGroup === 'unread' && c.is_read) return false;
      if (selectedTags.length > 0 && (!c.tag_ids || !selectedTags.some((t) => c.tag_ids.includes(t)))) return false;
      if (platformFilter !== 'all') {
        if (platformFilter.startsWith('page:')) {
          if (c.page.id !== platformFilter.slice(5)) return false;
        } else if (c.page.platform !== platformFilter) {
          return false;
        }
      }
      if (orderFilter !== 'all') {
        if (orderFilter === '0' && c.order_count !== 0) return false;
        if (orderFilter === '1' && c.order_count !== 1) return false;
        if (orderFilter === '2' && c.order_count !== 2) return false;
        if (orderFilter === '3' && c.order_count !== 3) return false;
        if (orderFilter === '4' && c.order_count !== 4) return false;
        if (orderFilter === '5_10' && (c.order_count < 5 || c.order_count > 10)) return false;
        if (orderFilter === '11_plus' && c.order_count < 11) return false;
      }
      if (assignedAdminFilter === 'unassigned' && c.assigned_admin_id !== null) return false;
      if (assignedAdminFilter !== 'all' && assignedAdminFilter !== 'unassigned' && c.assigned_admin_id !== assignedAdminFilter) return false;
      return true;
    });
  }, [conversations, orderFilter, assignedAdminFilter, platformFilter, inboxGroup, selectedTags]);

  return (
    <div className="flex h-full w-full gap-3 p-[10px]">
      {/* ---------------- ลิสต์แชท ---------------- */}
      <div className={cn('flex min-w-0 flex-1 flex-col gap-2 md:max-w-sm', (active || activeId) && 'hidden md:flex')}>
        <div className="flex flex-col gap-2">
          {/* ช่องค้นหาเดสก์ท็อป */}
          <div className="relative hidden md:block">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ชื่อ เบอร์ ออเดอร์ หรือเลขพัสดุ"
              className="pl-8"
            />
          </div>

          {/* ป้ายแสดงผลการค้นหาบนมือถือ */}
          {search && (
            <div className="flex items-center justify-between rounded-md bg-primary/10 px-2.5 py-1 text-xs text-primary md:hidden">
              <span className="truncate">ค้นหา: &quot;{search}&quot;</span>
              <button
                type="button"
                onClick={() => setSearch('')}
                className="ml-2 shrink-0 rounded p-0.5 hover:bg-primary/20"
                aria-label="ล้างคำค้นหา"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          <div
            className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none touch-pan-x select-none"
            onTouchStart={handleFilterTouchStart}
            onTouchMove={handleFilterTouchMove}
            onTouchEnd={handleFilterTouchEnd}
            onClickCapture={(e) => {
              if (isSwipingRef.current) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            {/* 1. ปุ่มตัวกรองหลัก */}
            <Button
              variant={filterCount > 0 ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 rounded-full px-3 text-xs shrink-0 whitespace-nowrap"
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

            {/* 2. ชิป: ยังไม่ได้อ่าน */}
            <FilterChip active={inboxGroup === 'unread'} onClick={() => setInboxGroup(inboxGroup === 'unread' ? 'all' : 'unread')}>
              <MessageSquareOff className="size-3.5" />
              ยังไม่ได้อ่าน{inboxGroup === 'all' && unreadCount > 0 ? ` (${unreadCount})` : ''}
            </FilterChip>

            {/* 3. ปุ่มดรอปดาวน์: ป้ายแท็ก (วางก่อนติดตามผล) */}
            <DropdownMenu
              open={openDropdown === 'tags'}
              onOpenChange={(open) => {
                if (!open) {
                  setOpenDropdown(null);
                } else if (!isTouchRef.current) {
                  setOpenDropdown('tags');
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onTouchEnd={(e) => {
                    if (!isSwipingRef.current) {
                      e.preventDefault();
                      setOpenDropdown((prev) => (prev === 'tags' ? null : 'tags'));
                    }
                  }}
                  onClick={() => {
                    if (!isTouchRef.current) {
                      setOpenDropdown((prev) => (prev === 'tags' ? null : 'tags'));
                    }
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs shrink-0 whitespace-nowrap transition-colors',
                    selectedTags.length > 0 ? 'border-primary bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                  )}
                  title="กรองตามป้ายแท็ก"
                >
                  <TagIcon className="size-3.5" />
                  <span className="max-w-[80px] truncate">
                    {selectedTags.length === 0
                      ? 'ป้ายแท็ก'
                      : selectedTags.length === 1
                        ? (tags.find((t) => t.id === selectedTags[0])?.name ?? '1 แท็ก')
                        : `${selectedTags.length} แท็ก`}
                  </span>
                  <ChevronDown className="size-3 opacity-60 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48 max-h-64 overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-muted-foreground">ป้ายแท็ก</DropdownMenuLabel>
                {tags.length === 0 ? (
                  <div className="p-2 text-xs text-muted-foreground text-center">ยังไม่มีแท็ก</div>
                ) : (
                  tags.map((t) => {
                    const isSelected = selectedTags.includes(t.id);
                    return (
                      <DropdownMenuItem
                        key={t.id}
                        onSelect={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.preventDefault();
                          toggle(setSelectedTags)(t.id);
                        }}
                        className="flex items-center justify-between text-xs cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                          <span className="truncate">{t.name}</span>
                        </span>
                        {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
                      </DropdownMenuItem>
                    );
                  })
                )}
                {selectedTags.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={(e) => e.preventDefault()}
                      onClick={() => setSelectedTags([])}
                      className="text-xs text-destructive justify-center cursor-pointer font-medium"
                    >
                      ล้างป้ายแท็กที่เลือก
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 4. ชิป: ติดตามผล */}
            <FilterChip active={inboxGroup === 'follow_up'} onClick={() => setInboxGroup(inboxGroup === 'follow_up' ? 'all' : 'follow_up')}>
              <Star className={cn('size-3.5', inboxGroup === 'follow_up' && 'fill-current text-amber-500')} />
              ติดตามผล
            </FilterChip>

            {/* 4. ปุ่มดรอปดาวน์: ผู้ดูแล / แอดมิน */}
            <DropdownMenu
              open={openDropdown === 'admins'}
              onOpenChange={(open) => {
                if (!open) {
                  setOpenDropdown(null);
                } else if (!isTouchRef.current) {
                  setOpenDropdown('admins');
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onTouchEnd={(e) => {
                    if (!isSwipingRef.current) {
                      e.preventDefault();
                      setOpenDropdown((prev) => (prev === 'admins' ? null : 'admins'));
                    }
                  }}
                  onClick={() => {
                    if (!isTouchRef.current) {
                      setOpenDropdown((prev) => (prev === 'admins' ? null : 'admins'));
                    }
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs shrink-0 whitespace-nowrap transition-colors',
                    assignedAdminFilter !== 'all' ? 'border-primary bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                  )}
                  title="กรองตามแอดมินผู้ดูแล"
                >
                  <User className="size-3.5" />
                  <span className="max-w-[80px] truncate">
                    {assignedAdminFilter === 'all'
                      ? 'ผู้ดูแล'
                      : assignedAdminFilter === 'unassigned'
                        ? 'ยังไม่มอบหมาย'
                        : (admins.find((a) => a.id === assignedAdminFilter)?.name ?? 'ผู้ดูแล')}
                  </span>
                  <ChevronDown className="size-3 opacity-60 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuLabel className="text-xs text-muted-foreground">แอดมินผู้ดูแล</DropdownMenuLabel>
                <DropdownMenuItem
                  className={cn('cursor-pointer text-xs flex items-center justify-between', assignedAdminFilter === 'all' && 'font-semibold bg-accent')}
                  onClick={() => setAssignedAdminFilter('all')}
                >
                  <span>ทั้งหมด</span>
                  {assignedAdminFilter === 'all' && <Check className="size-3 text-primary" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={cn('cursor-pointer text-xs flex items-center justify-between', assignedAdminFilter === 'unassigned' && 'font-semibold bg-accent')}
                  onClick={() => setAssignedAdminFilter('unassigned')}
                >
                  <span>ยังไม่มอบหมาย</span>
                  {assignedAdminFilter === 'unassigned' && <Check className="size-3 text-primary" />}
                </DropdownMenuItem>
                {admins.length > 0 && <DropdownMenuSeparator />}
                {admins.map((adm) => (
                  <DropdownMenuItem
                    key={adm.id}
                    className={cn('cursor-pointer text-xs flex items-center justify-between', assignedAdminFilter === adm.id && 'font-semibold bg-accent')}
                    onClick={() => setAssignedAdminFilter(adm.id)}
                  >
                    <span className="truncate">{adm.name}</span>
                    {assignedAdminFilter === adm.id && <Check className="size-3 text-primary shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 5. ปุ่มดรอปดาวน์: แพลตฟอร์ม & รายเพจ */}
            <DropdownMenu
              open={openDropdown === 'platform'}
              onOpenChange={(open) => {
                if (!open) {
                  setOpenDropdown(null);
                } else if (!isTouchRef.current) {
                  setOpenDropdown('platform');
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onTouchEnd={(e) => {
                    if (!isSwipingRef.current) {
                      e.preventDefault();
                      setOpenDropdown((prev) => (prev === 'platform' ? null : 'platform'));
                    }
                  }}
                  onClick={() => {
                    if (!isTouchRef.current) {
                      setOpenDropdown((prev) => (prev === 'platform' ? null : 'platform'));
                    }
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs shrink-0 whitespace-nowrap transition-colors',
                    platformFilter !== 'all' ? 'border-primary bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                  )}
                  title="กรองตามแพลตฟอร์มหรือเพจ"
                >
                  {platformFilter.startsWith('page:') ? (
                    (() => {
                      const p = pages.find((pg) => pg.id === platformFilter.slice(5));
                      return (
                        <>
                          <PlatformIcon platform={p?.platform ?? 'facebook'} size="xs" />
                          <span className="max-w-[90px] truncate">{p?.name ?? 'เพจ'}</span>
                        </>
                      );
                    })()
                  ) : platformFilter === 'facebook' ? (
                    <>
                      <PlatformIcon platform="facebook" size="xs" />
                      <span>Facebook</span>
                    </>
                  ) : platformFilter === 'instagram' ? (
                    <>
                      <PlatformIcon platform="instagram" size="xs" />
                      <span>Instagram</span>
                    </>
                  ) : platformFilter === 'line' ? (
                    <>
                      <PlatformIcon platform="line" size="xs" />
                      <span>LINE</span>
                    </>
                  ) : (
                    <>
                      <Layers className="size-3.5" />
                      <span>แพลตฟอร์ม</span>
                    </>
                  )}
                  <ChevronDown className="size-3 opacity-60 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 max-h-80 overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-muted-foreground">ช่องทาง / เพจ</DropdownMenuLabel>
                <DropdownMenuItem
                  className={cn('cursor-pointer text-xs flex items-center justify-between', platformFilter === 'all' && 'font-semibold bg-accent')}
                  onClick={() => setPlatformFilter('all')}
                >
                  <span className="flex items-center gap-2"><Layers className="size-3.5 text-muted-foreground" /> ทุกช่องทาง</span>
                  {platformFilter === 'all' && <Check className="size-3 text-primary" />}
                </DropdownMenuItem>

                {/* Facebook Group */}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] font-semibold flex items-center gap-1.5 py-1 text-foreground">
                  <PlatformIcon platform="facebook" size="xs" /> Facebook
                </DropdownMenuLabel>
                <DropdownMenuItem
                  className={cn('cursor-pointer text-xs flex items-center justify-between pl-6', platformFilter === 'facebook' && 'font-semibold bg-accent')}
                  onClick={() => setPlatformFilter('facebook')}
                >
                  <span>ทุกเพจ Facebook</span>
                  {platformFilter === 'facebook' && <Check className="size-3 text-primary" />}
                </DropdownMenuItem>
                {pages.filter((p) => p.platform === 'facebook').map((page) => (
                  <DropdownMenuItem
                    key={page.id}
                    className={cn('cursor-pointer text-xs flex items-center justify-between pl-6', platformFilter === `page:${page.id}` && 'font-semibold bg-accent')}
                    onClick={() => setPlatformFilter(`page:${page.id}`)}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: page.tag_color }} />
                      <span className="truncate">{page.name}</span>
                    </span>
                    {platformFilter === `page:${page.id}` && <Check className="size-3 text-primary shrink-0" />}
                  </DropdownMenuItem>
                ))}

                {/* Instagram Group */}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] font-semibold flex items-center gap-1.5 py-1 text-foreground">
                  <PlatformIcon platform="instagram" size="xs" /> Instagram
                </DropdownMenuLabel>
                <DropdownMenuItem
                  className={cn('cursor-pointer text-xs flex items-center justify-between pl-6', platformFilter === 'instagram' && 'font-semibold bg-accent')}
                  onClick={() => setPlatformFilter('instagram')}
                >
                  <span>ทุกบัญชี Instagram</span>
                  {platformFilter === 'instagram' && <Check className="size-3 text-primary" />}
                </DropdownMenuItem>
                {pages.filter((p) => p.platform === 'instagram').map((page) => (
                  <DropdownMenuItem
                    key={page.id}
                    className={cn('cursor-pointer text-xs flex items-center justify-between pl-6', platformFilter === `page:${page.id}` && 'font-semibold bg-accent')}
                    onClick={() => setPlatformFilter(`page:${page.id}`)}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: page.tag_color }} />
                      <span className="truncate">{page.name}</span>
                    </span>
                    {platformFilter === `page:${page.id}` && <Check className="size-3 text-primary shrink-0" />}
                  </DropdownMenuItem>
                ))}

                {/* LINE Group */}
                {pages.some((p) => (p.platform as string) === 'line') && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[11px] font-semibold flex items-center gap-1.5 py-1 text-foreground">
                      <PlatformIcon platform="line" size="xs" /> LINE
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      className={cn('cursor-pointer text-xs flex items-center justify-between pl-6', platformFilter === 'line' && 'font-semibold bg-accent')}
                      onClick={() => setPlatformFilter('line')}
                    >
                      <span>ทุกบัญชี LINE</span>
                      {platformFilter === 'line' && <Check className="size-3 text-primary" />}
                    </DropdownMenuItem>
                    {pages.filter((p) => (p.platform as string) === 'line').map((page) => (
                      <DropdownMenuItem
                        key={page.id}
                        className={cn('cursor-pointer text-xs flex items-center justify-between pl-6', platformFilter === `page:${page.id}` && 'font-semibold bg-accent')}
                        onClick={() => setPlatformFilter(`page:${page.id}`)}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: page.tag_color }} />
                          <span className="truncate">{page.name}</span>
                        </span>
                        {platformFilter === `page:${page.id}` && <Check className="size-3 text-primary shrink-0" />}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 6. ปุ่มดรอปดาวน์: จำนวนออเดอร์ */}
            <DropdownMenu
              open={openDropdown === 'order'}
              onOpenChange={(open) => {
                if (!open) {
                  setOpenDropdown(null);
                } else if (!isTouchRef.current) {
                  setOpenDropdown('order');
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onTouchEnd={(e) => {
                    if (!isSwipingRef.current) {
                      e.preventDefault();
                      setOpenDropdown((prev) => (prev === 'order' ? null : 'order'));
                    }
                  }}
                  onClick={() => {
                    if (!isTouchRef.current) {
                      setOpenDropdown((prev) => (prev === 'order' ? null : 'order'));
                    }
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs shrink-0 whitespace-nowrap transition-colors',
                    orderFilter !== 'all' ? 'border-primary bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                  )}
                  title="กรองตามประวัติการสั่งซื้อ"
                >
                  <ShoppingBag className="size-3.5" />
                  <span>{orderFilter === 'all' ? 'ออเดอร์' : ORDER_FILTER_LABELS[orderFilter]}</span>
                  <ChevronDown className="size-3 opacity-60 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground">จำนวนประวัติการสั่งซื้อ</DropdownMenuLabel>
                {(Object.keys(ORDER_FILTER_LABELS) as OrderFilterGroup[]).map((grp) => (
                  <DropdownMenuItem
                    key={grp}
                    className={cn('cursor-pointer text-xs flex items-center justify-between', orderFilter === grp && 'font-semibold bg-accent')}
                    onClick={() => setOrderFilter(grp)}
                  >
                    <span>{ORDER_FILTER_LABELS[grp]}</span>
                    {orderFilter === grp && <Check className="size-3 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 7. ชิปรอง: กลุ่มสถานะอื่นๆ เมื่อเลือกผ่าน dialog */}
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
          {displayedConversations.length === 0 ? (
            <EmptyList hasPages={pages.length > 0} />
          ) : (
            <ul className="divide-y">
              {displayedConversations.map((c) => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  isActive={c.id === activeId}
                  meId={me.id}
                  tagById={tagById}
                  onSelect={() => {
                    setActiveId(c.id);
                    router.push(`/inbox?c=${c.id}`);
                  }}
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
      <div className={cn('min-w-0 flex-1', !active && !activeId && 'hidden md:block')}>
        {active ? (
          <ChatRoom
            key={active.id}
            conversation={active}
            canReply={canReply}
            meId={me.id}
            tags={tags}
            onBack={() => {
              setActiveId(null);
              router.push('/inbox');
            }}
            onChanged={loadList}
            onStateChanged={() => {
              listInitRef.current = false;
              void loadList();
            }}
            onUpdateConversation={(patch) => {
              setConversations((prev) =>
                prev.map((item) => (item.id === active.id ? { ...item, ...patch } : item)),
              );
            }}
          />
        ) : activeId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border p-6 text-center text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <div className="text-sm font-medium">กำลังเปิดห้องแชท...</div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setActiveId(null);
                router.push('/inbox');
              }}
            >
              <ArrowLeft className="mr-1.5 size-4" />
              กลับหน้ารวมแชท
            </Button>
          </div>
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
        admins={admins}
        orderFilter={orderFilter}
        assignedAdminFilter={assignedAdminFilter}
        onTogglePage={toggle(setSelectedPages)}
        onToggleTag={toggle(setSelectedTags)}
        onSelectGroup={setInboxGroup}
        onSelectOrderFilter={setOrderFilter}
        onSelectAdminFilter={setAssignedAdminFilter}
        onClear={() => {
          setSelectedPages([]);
          setSelectedTags([]);
          setInboxGroup('all');
          setOrderFilter('all');
          setAssignedAdminFilter('all');
          setPlatformFilter('all');
        }}
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
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap shrink-0 transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
      )}
    >
      {dotColor && <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />}
      {children}
    </button>
  );
}

function InboxFilterDialog({
  open, onOpenChange, pages, tags, selectedPages, selectedTags, inboxGroup,
  admins, orderFilter, assignedAdminFilter,
  onTogglePage, onToggleTag, onSelectGroup, onSelectOrderFilter, onSelectAdminFilter, onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: InboxPage[];
  tags: Tag[];
  selectedPages: string[];
  selectedTags: string[];
  inboxGroup: InboxGroup;
  admins: Array<{ id: string; name: string }>;
  orderFilter: OrderFilterGroup;
  assignedAdminFilter: string;
  onTogglePage: (id: string) => void;
  onToggleTag: (id: string) => void;
  onSelectGroup: (group: InboxGroup) => void;
  onSelectOrderFilter: (v: OrderFilterGroup) => void;
  onSelectAdminFilter: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bottom-0 left-0 top-auto max-h-[88dvh] w-full max-w-none translate-x-0 translate-y-0 gap-4 overflow-y-auto rounded-b-none rounded-t-3xl p-4 sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg">
        <DialogHeader className="text-center sm:text-left">
          <DialogTitle>กรองและจัดกลุ่มแชท</DialogTitle>
          <DialogDescription>เลือกกลุ่มงาน ประวัติสั่งซื้อ แอดมินผู้ดูแล หรือเพจและป้ายที่ต้องการ</DialogDescription>
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
                <span className="inline-flex items-center gap-1.5">
                  <PlatformIcon platform={page.platform} size="xs" />
                  {page.platform === 'instagram' ? 'Instagram · ' : 'Messenger · '}{page.name}
                </span>
              </FilterChoice>
            ))}
          </FilterGroup>

          <FilterGroup title="ป้าย / กลุ่มแชท">
            {tags.length === 0 ? <p className="text-xs text-muted-foreground">ยังไม่มีป้าย — เพิ่มได้ที่ ตั้งค่า → เนื้อหา</p> : tags.map((tag) => (
              <FilterChoice key={tag.id} active={selectedTags.includes(tag.id)} onClick={() => onToggleTag(tag.id)} dotColor={tag.color}>{tag.name}</FilterChoice>
            ))}
          </FilterGroup>

          {admins.length > 0 && (
            <FilterGroup title="แอดมินผู้ดูแล (มอบหมาย)">
              <FilterChoice active={assignedAdminFilter === 'all'} onClick={() => onSelectAdminFilter('all')}>
                ทั้งหมด
              </FilterChoice>
              <FilterChoice active={assignedAdminFilter === 'unassigned'} onClick={() => onSelectAdminFilter('unassigned')}>
                ยังไม่มอบหมาย
              </FilterChoice>
              {admins.map((adm) => (
                <FilterChoice
                  key={adm.id}
                  active={assignedAdminFilter === adm.id}
                  onClick={() => onSelectAdminFilter(adm.id)}
                >
                  {adm.name}
                </FilterChoice>
              ))}
            </FilterGroup>
          )}

          <FilterGroup title="ประวัติการสั่งซื้อ (ออเดอร์)">
            {(Object.keys(ORDER_FILTER_LABELS) as OrderFilterGroup[]).map((grp) => (
              <FilterChoice
                key={grp}
                active={orderFilter === grp}
                onClick={() => onSelectOrderFilter(grp)}
              >
                {ORDER_FILTER_LABELS[grp]}
              </FilterChoice>
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
          <span className="absolute -bottom-1 -right-1">
            <PlatformIcon platform={c.page.platform} size="xs" />
          </span>
          {!c.is_read && (
            <span
              className="absolute -top-1 -right-1 z-10 flex min-w-4.5 h-4.5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-xs ring-2 ring-background animate-in fade-in zoom-in-75 duration-200"
              title={`${c.unread_count || 1} ข้อความที่ยังไม่อ่าน`}
            >
              {(c.unread_count || 1) > 99 ? '99+' : (c.unread_count || 1)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <span className={cn('min-w-0 flex-1 break-words text-sm leading-5', !c.is_read && 'font-semibold')}>
              {displayName(c)}
            </span>
            <span className="flex shrink-0 items-center justify-end gap-1 whitespace-nowrap text-[11px] text-muted-foreground">
              {dayTh(c.last_message_at)}
              {(c.order_count > 0 || c.is_important) && (
                <Star className="size-3.5 fill-amber-500 text-amber-500" aria-label={c.order_count > 0 ? 'ติดตามผล' : 'สำคัญ'} />
              )}
            </span>
          </div>

          <p className={cn('mt-0.5 truncate text-xs leading-5', c.is_read ? 'text-muted-foreground' : 'font-medium')}>
            {c.last_message_preview ?? '—'}
          </p>

          <div className="mt-1 flex items-start justify-between gap-2 text-[10px] text-muted-foreground">
            <div className="min-w-0 flex flex-wrap items-center gap-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: c.page.tag_color }} /> {c.page.name}
              </span>
              {c.inbox_status === 'done' && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><CheckCircle2 className="size-2.5" /> เรียบร้อย</span>}
              {c.inbox_status === 'spam' && <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive"><ShieldAlert className="size-2.5" /> สแปม</span>}
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
              {!c.is_read && (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
                  <span className="size-1.5 rounded-full bg-destructive" /> {(c.unread_count || 1) > 1 ? `${c.unread_count} ข้อความใหม่` : 'ใหม่'}
                </span>
              )}
              {c.tag_ids.slice(0, 1).map((id) => {
                const t = tagById.get(id);
                if (!t) return null;
                return (
                  <span
                    key={id}
                    className="rounded-full border px-1.5 py-0.5 text-[10px]"
                    style={{ backgroundColor: t.color, borderColor: t.color, color: isLightColor(t.color) ? '#1a1a1a' : '#ffffff' }}
                  >
                    {t.name}
                  </span>
                );
              })}
              {c.tag_ids.length > 1 && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{c.tag_ids.length - 1}</span>}
              {lockedByOther && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[var(--warning,#b45309)] dark:bg-amber-950">
                  <Lock className="size-2.5" /> {c.locked_by_name} กำลังดูอยู่
                </span>
              )}
            </div>
            {(c.assigned_admin_name || c.order_count > 0) && (
              <div className="flex shrink-0 items-center justify-end gap-1">
                {c.assigned_admin_name && (
                  c.assigned_admin_avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.assigned_admin_avatar_url}
                      alt={c.assigned_admin_name}
                      title={`ผู้ดูแล ${c.assigned_admin_name}`}
                      className="size-5 shrink-0 rounded-full object-cover border"
                    />
                  ) : (
                    <div
                      className="size-5 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[9px] font-bold border"
                      title={`ผู้ดูแล ${c.assigned_admin_name}`}
                    >
                      {c.assigned_admin_name.slice(0, 1).toUpperCase()}
                    </div>
                  )
                )}
                {c.order_count > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    <ShoppingCart className="size-2.5" /> {c.order_count}
                  </span>
                )}
              </div>
            )}
          </div>
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
  onUpdateConversation,
}: {
  conversation: ConversationRow;
  canReply: boolean;
  meId: string;
  tags: Tag[];
  onBack: () => void;
  onChanged: () => void;
  onStateChanged: () => void;
  onUpdateConversation?: (patch: Partial<ConversationRow>) => void;
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
  const [pendingLibraryItems, setPendingLibraryItems] = useState<LibraryItem[]>([]);
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
    // ตรวจว่ามีข้อความใหม่จากลูกค้าไหม — ถ้ามี = กรอบ 24 ชม. อาจเปิดใหม่ ต้อง refresh policy
    const hasNewInbound = got.rows.some((r) => r.direction === 'in');
    setMessages((prev) => {
      if (prev === null) return got.rows;
      const prevIds = new Set(prev.map((m) => m.id));
      const actuallyNew = got.rows.some((r) => r.direction === 'in' && !prevIds.has(r.id));
      if (actuallyNew) {
        void fetchPolicy().then((p) => { if (p) setPolicy(p); });
      }
      return mergeMessages(prev, got.rows, true);
    });
    // ⚠️ ตั้ง "ยังมีของเก่าอีกไหม" เฉพาะรอบแรก
    //    รอบหลัง ๆ ของเก่าที่กดโหลดมาแล้วยังอยู่ในมือ ค่าจาก API จึงไม่ใช่ความจริงอีกต่อไป
    if (!initializedRef.current) {
      initializedRef.current = true;
      setHasOlder(got.has_more);
    }
    if (got.truncated) toast.warning('มีข้อความใหม่เกินเพดานหนึ่งรอบ ระบบกำลังดึงต่อและไม่ได้ทิ้งข้อความ');
  }, [fetchPolicy]);

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
    if (!c.is_read) {
      onUpdateConversation?.({ is_read: true, unread_count: 0 });
    }
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

    const msgTimer = setInterval(pullMessages, 2500);
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
    const items = [...pendingLibraryItems];
    if (items.length === 0 || uploading) return;
    setUploading(true);
    let sentCount = 0;
    try {
      for (const item of items) {
        const res = await fetch(`/api/conversations/${c.id}/reply-library-media`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ media_id: item.id, idempotency_key: newIdempotencyKey() }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok || !json.data?.sent) {
          toast.error(json?.error?.message_th ?? json?.data?.reason_th ?? 'ส่งไฟล์จากคลังไม่สำเร็จ');
          setPendingLibraryItems(items.slice(sentCount));
          return;
        }
        sentCount++;
      }
      setPendingLibraryItems([]);
      idempotencyKey.current = newIdempotencyKey();
      stickBottomRef.current = true;
      await loadMessages();
      onChanged();
      if (sentCount > 1) {
        toast.success(`ส่งไฟล์จากคลังสำเร็จ ${sentCount} รายการ`);
      }
    } catch (err) {
      toast.error('ส่งไฟล์จากคลังไม่สำเร็จ', { description: err instanceof Error ? err.message : undefined });
      setPendingLibraryItems(items.slice(sentCount));
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
    // ⭐ คัดลอกรูปไว้ในตัวแปร local แล้วเคลียร์ state ทันที
    //    กันรูปถูกส่งซ้ำหากข้อความ text ส่งไม่สำเร็จแล้วผู้ใช้กดส่งอีกครั้ง
    const imagesToSend = [...cannedImages];
    if (imagesToSend.length > 0) setCannedImages([]);
    try {
      // ชุดคำตอบ: ส่งรูปภาพทั้งหมดก่อนข้อความ
      let failedImageCount = 0;
      for (let index = 0; index < imagesToSend.length; index += 1) {
        const image = imagesToSend[index];
        try {
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
            failedImageCount += 1;
            console.warn(`[canned-image] รูปที่ ${index + 1} ส่งไม่สำเร็จ:`, mediaJson);
          }
        } catch (err) {
          failedImageCount += 1;
          console.warn(`[canned-image] ส่งรูปที่ ${index + 1} เกิดข้อผิดพลาด:`, err);
        }
      }
      if (failedImageCount > 0) {
        toast.warning(`ส่งรูปสำเร็จ ${imagesToSend.length - failedImageCount} จาก ${imagesToSend.length} รูป`);
      }


      if (!body) {
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
      | { action: 'confirm_spam_restored'; value: true }
      | { action: 'ai_bot'; value: boolean },
    success: string,
  ) {
    setStateBusy(true);
    // อัปเดต UI ทันที (Optimistic Update) ให้ผู้ใช้เห็นการเปลี่ยนแปลงทันที
    if (input.action === 'important') {
      onUpdateConversation?.({ is_important: input.value });
    } else if (input.action === 'status') {
      onUpdateConversation?.({ inbox_status: input.value });
    } else if (input.action === 'assignment') {
      onUpdateConversation?.({ assigned_admin_id: input.value === 'me' ? meId : null });
    } else if (input.action === 'ai_bot') {
      onUpdateConversation?.({ has_ai_reply: input.value });
    }
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
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <PlatformIcon platform={c.page.platform} size="xs" />
                  <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: c.page.tag_color }} />
                  {(c.page.platform as string) === 'instagram' ? 'Instagram' : (c.page.platform as string) === 'line' ? 'LINE' : 'Messenger'} · {c.page.name}
                </span>
                {c.username && <span>@{c.username}</span>}
                {c.phone && <button type="button" className="inline-flex items-center gap-1 underline decoration-dotted" onClick={() => void copyText(c.phone!).then((done) => done ? toast.success('คัดลอกเบอร์แล้ว') : toast.error('คัดลอกไม่สำเร็จ'))}><Phone className="size-3" />{c.phone}</button>}
                {!hasRealName(c) && <RefreshNameButton conversationId={c.id} reason={c.profile_error_th} />}
              </div>

              {/* ย้ายป้าย "ตอบได้อีก XX ชม." มาไว้มุมขวา บรรทัดเดียวกันข้างชื่อเพจ */}
              {replyHint && (!policy || policy.can_send) && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 shadow-2xs',
                    replyHint.tone === 'warn' && 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300',
                    replyHint.tone === 'over' && 'bg-destructive/15 text-destructive',
                    replyHint.tone === 'ok' && 'bg-muted text-muted-foreground',
                  )}
                >
                  <Clock className="size-3" />
                  {replyHint.text}
                </span>
              )}
            </div>
          </div>
        </div>

        {policy && !policy.can_send && (
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
        )}

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
                style={{ backgroundColor: t.color, borderColor: t.color, color: isLightColor(t.color) ? '#1a1a1a' : '#ffffff' }}
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
                      isRead={
                        m.direction === 'out' && (
                          Boolean(c.last_customer_message_at && new Date(m.created_at).getTime() <= new Date(c.last_customer_message_at).getTime()) ||
                          messages.some((other) => other.direction === 'in' && new Date(other.created_at).getTime() >= new Date(m.created_at).getTime())
                        )
                      }
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

            <div className="mx-1 h-4 w-px bg-border shrink-0" />

            {/* ปุ่มเปิด/ปิด AI บอทในห้องแชทนี้ (ข้างไอคอนวิดีโอตามที่ผู้ใช้ต้องการ) */}
            <Button
              type="button"
              variant={c.has_ai_reply ? 'default' : 'outline'}
              size="sm"
              className={cn(
                'h-8 px-2.5 text-xs gap-1.5 transition-colors font-medium',
                c.has_ai_reply
                  ? 'bg-violet-600 text-white hover:bg-violet-700'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
              title={
                c.has_ai_reply
                  ? '🤖 บอทกำลังเปิดตอบอัตโนมัติในห้องนี้ (คลิกเพื่อปิด ให้แอดมินตอบเอง)'
                  : '🤖 บอทปิดอยู่ (คลิกเพื่อเปิดให้ AI ตอบอัตโนมัติ)'
              }
              disabled={stateBusy}
              onClick={() => {
                const nextVal = !c.has_ai_reply;
                void changeInboxState(
                  { action: 'ai_bot', value: nextVal },
                  nextVal
                    ? 'เปิด AI บอทตอบอัตโนมัติในแชทนี้แล้ว'
                    : 'ปิด AI บอทในแชทนี้แล้ว (แอดมินตอบเอง)',
                );
              }}
            >
              <Bot className={cn('size-3.5 shrink-0', c.has_ai_reply && 'animate-pulse')} />
              <span>{c.has_ai_reply ? 'บอท: เปิด' : 'บอท: ปิด'}</span>
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

        {canReply && pendingLibraryItems.length > 0 && (
          <div className="mb-2 rounded-md border border-primary/30 bg-primary/5 p-2 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">
                สื่อจากคลัง ({pendingLibraryItems.length} รายการ) · ตรวจตัวอย่างก่อนส่ง
              </span>
              <div className="flex items-center gap-1.5">
                <Button size="sm" className="h-7 text-xs" onClick={() => void sendLibraryMedia()} disabled={uploading}>
                  {uploading ? <Loader2 className="size-3 animate-spin mr-1" /> : <Send className="size-3 mr-1" />}
                  ส่ง ({pendingLibraryItems.length})
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPendingLibraryItems([])} disabled={uploading}>
                  ล้างทั้งหมด
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto py-1">
              {pendingLibraryItems.map((item) => (
                <div key={item.id} className="relative group shrink-0 rounded-lg border bg-background overflow-hidden">
                  {item.mime.startsWith('video/') ? (
                    <div className="relative h-16 w-20 bg-black flex items-center justify-center">
                      <video
                        src={`${item.public_url || item.preview_url}#t=0.001`}
                        playsInline
                        muted
                        preload="metadata"
                        className="size-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                        <Video className="size-4 text-white drop-shadow-md" />
                      </div>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.preview_url} alt="สื่อจากคลัง" className="size-16 object-cover" />
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingLibraryItems((prev) => prev.filter((x) => x.id !== item.id))}
                    disabled={uploading}
                    className="absolute top-1 right-1 size-5 rounded-full bg-black/70 text-white flex items-center justify-center text-xs hover:bg-destructive transition"
                    title="ลบออก"
                  >
                    <X className="size-3" />
                  </button>
                  <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] text-center truncate px-0.5">
                    {(item.bytes / 1024 / 1024).toFixed(1)}M
                  </span>
                </div>
              ))}
            </div>
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
                if (e.key === 'Enter') {
                  // กำลังเลือกชุดคำตอบอยู่ → Enter หมายถึง "เลือกอันแรก"
                  if (cannedVisible.length > 0 && !e.shiftKey) {
                    e.preventDefault();
                    applyCanned(cannedVisible[0]);
                    return;
                  }
                  // ส่งข้อความเมื่อกด Ctrl+Enter หรือ Cmd+Enter เท่านั้น (Enter ธรรมดาขึ้นบรรทัดใหม่)
                  if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }
                if (e.key === 'Escape') setDismissedCanned(true);
              }}
              rows={1}
              placeholder="พิมพ์ข้อความ..."
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
        onSelectMultiple={(items) => {
          setPendingLibraryItems((prev) => {
            const map = new Map(prev.map((i) => [i.id, i]));
            for (const it of items) map.set(it.id, it);
            return Array.from(map.values());
          });
          setLibraryKind(null);
        }}
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
  onSelectMultiple,
}: {
  kind: 'image' | 'video' | null;
  onClose: () => void;
  onSelectMultiple: (items: LibraryItem[]) => void;
}) {
  const [loaded, setLoaded] = useState<{ items: LibraryItem[]; albums: string[] } | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<string>('ทั้งหมด');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!kind) return;
    let alive = true;
    setSelectedIds(new Set());
    setSelectedAlbum('ทั้งหมด');
    void fetch('/api/media-library?for_picker=1', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (!alive) return;
        if (!json.ok) throw new Error(json?.error?.message_th ?? 'อ่านคลังสื่อไม่สำเร็จ');
        const all = (json.data.items as LibraryItem[]) || [];
        const albums = (json.data.albums as string[]) || ['โปรโมชั่น', 'สินค้า', 'รีวิว / สลิป', 'วิดีโอ', 'ระบบ', 'ทั่วไป'];
        setLoaded({
          items: all,
          albums,
        });
      })
      .catch((err) => {
        if (alive) {
          setLoaded({ items: [], albums: [] });
          toast.error(err instanceof Error ? err.message : 'อ่านคลังสื่อไม่สำเร็จ');
        }
      });
    return () => { alive = false; };
  }, [kind]);

  const allItems = useMemo(() => {
    if (!loaded || !kind) return [];
    return loaded.items.filter((item) => {
      if (kind === 'video') return item.mime.startsWith('video/');
      return item.mime.startsWith('image/') && !item.categories?.includes('ระบบ');
    });
  }, [loaded, kind]);

  const filteredItems = useMemo(() => {
    if (selectedAlbum === 'ทั้งหมด') return allItems;
    return allItems.filter((item) => {
      if (selectedAlbum === 'วิดีโอ') return item.mime.startsWith('video/');
      return item.categories?.includes(selectedAlbum);
    });
  }, [allItems, selectedAlbum]);

  const toggleSelect = (item: LibraryItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const handleConfirm = () => {
    const selected = allItems.filter((item) => selectedIds.has(item.id));
    if (selected.length === 0) return;
    onSelectMultiple(selected);
    onClose();
  };

  const albumsList = useMemo(() => {
    if (!loaded?.albums) return ['ทั้งหมด'];
    if (kind === 'video') return [];
    const filtered = loaded.albums.filter((a) => a !== 'ทั้งหมด' && a !== 'วิดีโอ' && a !== 'ระบบ');
    return ['ทั้งหมด', ...filtered];
  }, [loaded?.albums, kind]);

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bottom-0 left-0 top-auto w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-3xl p-4 sm:left-1/2 sm:top-1/2 sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl max-h-[88dvh] flex flex-col gap-3">
        <DialogHeader className="pb-1 text-left">
          <DialogTitle className="text-base">
            {kind === 'video' ? 'เลือกจากคลังวิดีโอ' : 'เลือกจากคลังรูปภาพ'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {kind === 'video'
              ? 'แตะเลือกวิดีโอเพื่อส่งในแชท'
              : 'แตะที่รูปเพื่อเลือกหลายรายการพร้อมกัน แล้วกดปุ่ม “นำไปใส่ในแชท” ด้านล่าง'}
          </DialogDescription>
        </DialogHeader>

        {/* --- แถบเลือกอัลบั้ม (เฉพาะรูปภาพ และซ่อนวิดีโอ/ระบบ) --- */}
        {loaded && kind === 'image' && albumsList.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {albumsList.map((alb) => {
              const active = selectedAlbum === alb;
              return (
                <button
                  key={alb}
                  type="button"
                  onClick={() => setSelectedAlbum(alb)}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1 text-xs transition border',
                    active
                      ? 'border-primary bg-primary text-primary-foreground font-medium'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50',
                  )}
                >
                  {alb}
                </button>
              );
            })}
          </div>
        )}

        {/* --- ตารางรูปภาพย่อแบบกะทัดรัด (4-6 คอลัมน์) --- */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loaded === null ? (
            <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-xs text-muted-foreground">
              {allItems.length === 0 ? (
                <>ยังไม่มี{kind === 'video' ? 'วิดีโอ' : 'รูปภาพ'}ในคลัง<br />เพิ่มไฟล์ได้ที่เมนู “คลังสื่อ”</>
              ) : (
                <>ไม่มีไฟล์ในอัลบั้ม “{selectedAlbum}”</>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 p-0.5">
              {filteredItems.map((item) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleSelect(item)}
                    className={cn(
                      'group relative aspect-square w-full overflow-hidden rounded-lg border bg-muted text-left transition focus:outline-none',
                      isSelected ? 'border-primary ring-2 ring-primary ring-offset-1' : 'hover:border-primary/50',
                    )}
                  >
                    {item.mime.startsWith('video/') ? (
                      <div className="relative size-full bg-black flex items-center justify-center">
                        <video
                          src={`${item.public_url || item.preview_url}#t=0.001`}
                          muted
                          playsInline
                          preload="metadata"
                          className="size-full object-cover"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
                          <Video className="size-6 text-white drop-shadow-md" />
                        </div>
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.preview_url} alt="รูปในคลัง" loading="lazy" className="size-full object-cover" />
                    )}

                    {/* เครื่องหมายถูกเมื่อเลือก */}
                    <div
                      className={cn(
                        'absolute top-1 right-1 size-5 rounded-full flex items-center justify-center text-[10px] font-bold shadow-sm transition',
                        isSelected
                          ? 'bg-primary text-primary-foreground scale-100'
                          : 'border border-white/80 bg-black/40 text-transparent opacity-0 group-hover:opacity-100',
                      )}
                    >
                      <Check className="size-3 stroke-[3]" />
                    </div>

                    {/* ป้ายบอกขนาดไฟล์ */}
                    <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white text-[9px] px-1 pb-0.5 pt-2 truncate">
                      {(item.bytes / 1024 / 1024).toFixed(1)}MB
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* --- แถบล่างสรุปการเลือกและปุ่มยืนยัน --- */}
        <div className="flex items-center justify-between border-t pt-2 mt-auto text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium">
              เลือกแล้ว <strong className="text-foreground">{selectedIds.size}</strong> รายการ
            </span>
            {filteredItems.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (selectedIds.size === filteredItems.length) setSelectedIds(new Set());
                  else setSelectedIds(new Set(filteredItems.map((i) => i.id)));
                }}
                className="text-primary hover:underline"
              >
                {selectedIds.size === filteredItems.length ? 'ล้างที่เลือก' : 'เลือกทั้งหมดในหน้านี้'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button
              size="sm"
              disabled={selectedIds.size === 0}
              onClick={handleConfirm}
            >
              นำไปใส่ในแชท ({selectedIds.size})
            </Button>
          </div>
        </div>
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
  isRead = false,
  onTap,
  onSwipeRight,
}: {
  message: MessageRow;
  isRead?: boolean;
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
      <div className={cn('flex items-end gap-1.5 max-w-[85%]', outgoing ? 'flex-row-reverse' : 'flex-row')}>
        {outgoing && m.sender_type === 'admin' && (
          m.admin_avatar_url ? (
            <img
              src={m.admin_avatar_url}
              alt={m.admin_name ?? 'แอดมิน'}
              title={m.admin_name ?? 'แอดมิน'}
              className="size-6 rounded-full object-cover border shrink-0 mb-0.5"
            />
          ) : (
            <div
              className="size-6 rounded-full bg-primary/15 text-primary border flex items-center justify-center text-[10px] font-semibold shrink-0 mb-0.5"
              title={m.admin_name ?? 'แอดมิน'}
            >
              {m.admin_name ? m.admin_name.slice(0, 1).toUpperCase() : 'A'}
            </div>
          )
        )}
        <button
          type="button"
          onClick={onTap}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className={cn(
            'rounded-2xl px-3 py-2 text-left text-sm break-words',
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
              <span key={i} className="mt-1 block overflow-hidden rounded-lg" onClick={(event) => event.stopPropagation()}>
                <video
                  src={`${src}#t=0.001`}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-72 w-full rounded-lg bg-black"
                />
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
      </div>

      <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
        <span>{clockTh(m.created_at)}</span>
        {outgoing && (
          isRead ? (
            <span className="inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400 font-medium">
              <CheckCheck className="size-3" /> อ่านแล้ว
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-muted-foreground">
              <Check className="size-3" /> ส่งแล้ว
            </span>
          )
        )}
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
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  !on && 'text-muted-foreground hover:bg-muted/50'
                )}
                style={on ? { backgroundColor: t.color, borderColor: t.color, color: isLightColor(t.color) ? '#1a1a1a' : '#ffffff' } : { borderColor: t.color, color: t.color }}
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
