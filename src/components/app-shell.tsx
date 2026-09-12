'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  MessagesSquare, ShoppingBag, BarChart3, MessageCircle,
  Settings, LogOut, KeyRound, UserCircle2,
  Moon, Sun,
  ContactRound,
  Images as ImagesIcon,
  MoreHorizontal,
  Camera,
  SlidersHorizontal,
  Check,
  Search,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { can } from '@/lib/auth/permissions';
import { ROLE_LABEL_TH } from '@/lib/auth/permissions';
import type { PublicAdmin } from '@/types/db';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import ImageUploadCrop from '@/components/image-upload-crop';
import { toast } from 'sonner';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  visible: (admin: PublicAdmin) => boolean;
};

const NAV: NavItem[] = [
  { href: '/inbox',     label: 'อินบ็อกซ์', icon: MessagesSquare, visible: (a) => can(a.role, 'chat.reply') || a.role === 'viewer' },
  { href: '/orders',    label: 'ออเดอร์',   icon: ShoppingBag,    visible: (a) => can(a.role, 'order.create') || a.role === 'viewer' },
  { href: '/customers', label: 'ลูกค้า',     icon: ContactRound,   visible: () => true },
  { href: '/media',     label: 'คลังสื่อ',   icon: ImagesIcon,     visible: (a) => can(a.role, 'content.view') },
  { href: '/dashboard', label: 'สรุปยอด',   icon: BarChart3,      visible: (a) => can(a.role, 'dashboard.view.all') || can(a.role, 'dashboard.view.self') },
  { href: '/comments',  label: 'คอมเมนต์',  icon: MessageCircle,  visible: (a) => can(a.role, 'chat.reply') },
  { href: '/settings',  label: 'ตั้งค่า',    icon: Settings,       visible: () => true },
];

const DEFAULT_PRIMARY = ['/inbox', '/orders', '/customers', '/media'];

export default function AppShell({
  admin, children, brand,
}: {
  admin: PublicAdmin;
  children: React.ReactNode;
  brand: { name: string; logoUrl: string | null };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<{ unread_chats: number; unhandled_comments: number }>({
    unread_chats: 0,
    unhandled_comments: 0,
  });
  const [primaryHrefs, setPrimaryHrefs] = useState<string[]>(DEFAULT_PRIMARY);
  const [navCustomizeOpen, setNavCustomizeOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [headerSearchQuery, setHeaderSearchQuery] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('hubchat_mobile_nav_primary');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 4) {
          setPrimaryHrefs(parsed);
        }
      }
    } catch {
      // ใช้ค่าเริ่มต้น
    }
  }, []);

  const savePrimaryHrefs = (hrefs: string[]) => {
    setPrimaryHrefs(hrefs);
    try {
      localStorage.setItem('hubchat_mobile_nav_primary', JSON.stringify(hrefs));
      toast.success('บันทึกการจัดปุ่มเมนูล่างแล้ว');
    } catch {
      // ข้าม
    }
  };

  useEffect(() => {
    let alive = true;
    const fetchCounts = async () => {
      try {
        const res = await fetch('/api/notify/counts');
        if (!res.ok) return;
        const json = await res.json();
        if (alive && json.ok && json.data) {
          setCounts({
            unread_chats: Number(json.data.unread_chats ?? 0),
            unhandled_comments: Number(json.data.unhandled_comments ?? 0),
          });
        }
      } catch {
        // เงียบ
      }
    };

    void fetchCounts();
    const timer = setInterval(() => void fetchCounts(), 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const items = NAV.filter((item) => item.visible(admin));

  // เมนูล่าง 1 - 4 ปุ่มหลักตามการตั้งค่า (ส่วนที่เหลือจะไปอยู่ในปุ่ม "เพิ่มเติม (...)")
  const mobilePrimary = primaryHrefs
    .map((href) => items.find((it) => it.href === href))
    .filter((it): it is NavItem => Boolean(it));
  const mobileMore = items.filter((it) => !mobilePrimary.some((p) => p.href === it.href));

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    toast.success('ออกจากระบบแล้ว');
    router.replace('/login');
    router.refresh();
  }

  const getBadgeCount = (href: string) => {
    if (href === '/inbox') return counts.unread_chats;
    if (href === '/comments') return counts.unhandled_comments;
    return 0;
  };

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      {/* ---------- เมนูซ้าย (เดสก์ท็อป) ---------- */}
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-card md:flex">
        <Link
          href="/inbox"
          className="flex h-14 items-center gap-2 px-4 font-semibold transition-opacity hover:opacity-80"
          title="กลับหน้าหลักอินบ็อกซ์"
        >
          {brand.logoUrl && <img src={brand.logoUrl} alt="" className="size-8 rounded object-contain" />}
          <span className="truncate">{brand.name}</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const badge = getBadgeCount(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors',
                  active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                )}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <item.icon className="size-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {badge > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <AccountMenu admin={admin} onLogout={handleLogout} className="m-2" />
      </aside>

      {/* ---------- เนื้อหา ---------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[calc(3.5rem+env(safe-area-inset-top,0px))] shrink-0 items-center justify-between border-b bg-card px-4 pt-[env(safe-area-inset-top,0px)] md:hidden">
          <Link
            href="/inbox"
            className="flex min-w-0 items-center gap-2 font-semibold transition-opacity hover:opacity-80"
            title="กลับหน้าหลักอินบ็อกซ์"
          >
            {brand.logoUrl && <img src={brand.logoUrl} alt="" className="size-8 rounded object-contain" />}
            <span className="truncate">{brand.name}</span>
          </Link>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchModalOpen(true)}
              aria-label="ค้นหา"
              title="ค้นหา"
            >
              <Search className="size-5" />
            </Button>
            <AccountMenu admin={admin} onLogout={handleLogout} />
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden p-2 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:p-4 md:pb-4">{children}</main>
      </div>

      {/* ---------- แถบเมนูล่าง (มือถือ) ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden shadow-lg">
        {mobilePrimary.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const badge = getBadgeCount(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
                active ? 'text-primary font-semibold' : 'text-muted-foreground',
              )}
            >
              <div className="relative">
                <item.icon className="size-5" />
                {badge > 0 && (
                  <span className="absolute -top-1 -right-2 inline-flex items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow-sm">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </div>
              <span>{item.label}</span>
            </Link>
          );
        })}
        {mobileMore.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
                  mobileMore.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
                    ? 'font-semibold text-primary'
                    : 'text-muted-foreground',
                )}
              >
                <div className="relative">
                  <MoreHorizontal className="size-5" />
                  {mobileMore.some((m) => getBadgeCount(m.href) > 0) && (
                    <span className="absolute -top-1 -right-1 size-2 rounded-full bg-red-500 shadow-sm" />
                  )}
                </div>
                <span>เพิ่มเติม</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="mb-2 w-52">
              {mobileMore.map((item) => {
                const badge = getBadgeCount(item.href);
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link href={item.href} className="flex items-center justify-between w-full">
                      <span className="flex items-center gap-2">
                        <item.icon className="size-4" />
                        {item.label}
                      </span>
                      {badge > 0 && (
                        <span className="inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setNavCustomizeOpen(true)}>
                <SlidersHorizontal className="size-4 mr-2" />
                ปรับแต่ง
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>

      {/* Dialog ปรับแต่งปุ่มล่างมือถือ */}
      <Dialog open={navCustomizeOpen} onOpenChange={setNavCustomizeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>ปรับแต่งเมนูล่าง</DialogTitle>
            <DialogDescription>
              เลือกเมนูที่คุณต้องการให้แสดงที่แถบล่างได้ 1 ถึง 4 ปุ่ม ส่วนที่เหลือจะไปอยู่ในปุ่ม &quot;เพิ่มเติม (...)&quot;
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            {items.map((item) => {
              const selected = primaryHrefs.includes(item.href);
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => {
                    if (selected) {
                      if (primaryHrefs.length <= 1) {
                        toast.info('ต้องมีปุ่มหลักอย่างน้อย 1 ปุ่ม');
                        return;
                      }
                      savePrimaryHrefs(primaryHrefs.filter((h) => h !== item.href));
                    } else {
                      if (primaryHrefs.length >= 4) {
                        toast.info('เลือกได้สูงสุด 4 ปุ่ม (กรุณากดยกเลิกปุ่มอื่นก่อน)');
                        return;
                      }
                      savePrimaryHrefs([...primaryHrefs, item.href]);
                    }
                  }}
                  className={cn(
                    'flex items-center justify-between rounded-lg border p-3 text-sm transition-colors',
                    selected ? 'border-primary bg-primary/5 font-medium text-primary' : 'hover:bg-accent',
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <item.icon className="size-4" />
                    {item.label}
                  </span>
                  {selected && <Check className="size-4 text-primary" />}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog ค้นหาบนมือถือ */}
      <Dialog open={searchModalOpen} onOpenChange={setSearchModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>ค้นหา</DialogTitle>
            <DialogDescription>ค้นหาชื่อลูกค้า เบอร์โทร ออเดอร์ หรือเลขพัสดุ</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const q = headerSearchQuery.trim();
              setSearchModalOpen(false);
              window.dispatchEvent(new CustomEvent('hubchat:search', { detail: q }));
              if (pathname !== '/inbox') {
                router.push(`/inbox?search=${encodeURIComponent(q)}`);
              }
            }}
            className="flex flex-col gap-3 py-2"
          >
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={headerSearchQuery}
                onChange={(e) => setHeaderSearchQuery(e.target.value)}
                placeholder="พิมพ์คำค้นหา..."
                className="pl-8"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setHeaderSearchQuery('');
                  window.dispatchEvent(new CustomEvent('hubchat:search', { detail: '' }));
                  setSearchModalOpen(false);
                }}
              >
                ล้างคำค้น
              </Button>
              <Button type="submit" size="sm">ค้นหา</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountMenu({
  admin,
  onLogout,
  className,
}: {
  admin: PublicAdmin;
  onLogout: () => void;
  className?: string;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(admin.avatar_url ?? null);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);

  const handleAvatarChange = async (url: string | null) => {
    setSavingAvatar(true);
    try {
      const res = await fetch(`/api/admins/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: url }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error?.message_th ?? 'อัปเดตรูปไม่สำเร็จ');
      }
      setAvatarUrl(url);
      toast.success('อัปเดตรูปโปรไฟล์เรียบร้อย');
      setAvatarDialogOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSavingAvatar(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className={cn('justify-start gap-2', className)}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt={admin.name}
                className="size-5 rounded-full object-cover border"
              />
            ) : (
              <UserCircle2 className="size-5" />
            )}
            <span className="truncate">{admin.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex items-center gap-3">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={admin.name}
                  className="size-9 rounded-full object-cover border shrink-0"
                />
              ) : (
                <UserCircle2 className="size-8 text-muted-foreground shrink-0" />
              )}
              <div className="flex flex-col min-w-0">
                <span className="truncate font-medium">{admin.name}</span>
                <span className="text-xs font-normal text-muted-foreground truncate">
                  {admin.email} · {ROLE_LABEL_TH[admin.role]}
                </span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAvatarDialogOpen(true)}>
            <Camera className="size-4 mr-2" />
            เปลี่ยนรูปโปรไฟล์
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
            {resolvedTheme === 'dark' ? <Sun className="size-4 mr-2" /> : <Moon className="size-4 mr-2" />}
            {resolvedTheme === 'dark' ? 'ใช้ธีมสว่าง' : 'ใช้ธีมมืด'}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/change-password">
              <KeyRound className="size-4 mr-2" />
              เปลี่ยนรหัสผ่าน
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onLogout}>
            <LogOut className="size-4 mr-2" />
            ออกจากระบบ
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={avatarDialogOpen} onOpenChange={setAvatarDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>จัดการรูปโปรไฟล์ของฉัน</DialogTitle>
            <DialogDescription>
              อัปโหลดรูปหน้าของคุณ ระบบจะครอปเป็นสัดส่วน 1:1 จัตุรัส และนำไปแสดงบนแถบเมนูและในช่องแชทที่คุณพิมพ์ตอบ
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-4">
            <ImageUploadCrop
              value={avatarUrl}
              aspect="circle"
              size={96}
              label=""
              onChange={(url) => void handleAvatarChange(url)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
