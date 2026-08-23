'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  MessagesSquare, ShoppingBag, BarChart3, MessageCircle,
  Settings, LogOut, KeyRound, UserCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { can } from '@/lib/auth/permissions';
import { ROLE_LABEL_TH } from '@/lib/auth/permissions';
import type { PublicAdmin } from '@/types/db';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

/**
 * โครงหน้าจอหลัก
 * -------------------------------------------------------------------------
 * มือถือ  : แถบเมนูอยู่ "ล่างจอ" — นิ้วโป้งถึงง่าย แอดมินยืนตอบแชทได้
 * เดสก์ท็อป: แถบเมนูอยู่ซ้าย
 * (หลักคิดข้อ 2 : ทุกอย่างต้องกดจากมือถือได้)
 */

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** ซ่อนเมนูถ้าไม่มีสิทธิ์ */
  visible: (admin: PublicAdmin) => boolean;
};

const NAV: NavItem[] = [
  { href: '/inbox',     label: 'อินบ็อกซ์', icon: MessagesSquare, visible: (a) => can(a.role, 'chat.reply') || a.role === 'viewer' },
  { href: '/orders',    label: 'ออเดอร์',   icon: ShoppingBag,    visible: (a) => can(a.role, 'order.create') || a.role === 'viewer' },
  { href: '/dashboard', label: 'สรุปยอด',   icon: BarChart3,      visible: (a) => can(a.role, 'dashboard.view.all') || can(a.role, 'dashboard.view.self') },
  { href: '/comments',  label: 'คอมเมนต์',  icon: MessageCircle,  visible: (a) => can(a.role, 'chat.reply') },
  { href: '/settings',  label: 'ตั้งค่า',    icon: Settings,       visible: () => true },
];

export default function AppShell({ admin, children }: { admin: PublicAdmin; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = NAV.filter((item) => item.visible(admin));

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    toast.success('ออกจากระบบแล้ว');
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      {/* ---------- เมนูซ้าย (เดสก์ท็อป) ---------- */}
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex h-14 items-center px-4 font-semibold">HubChat</div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <AccountMenu admin={admin} onLogout={handleLogout} className="m-2" />
      </aside>

      {/* ---------- เนื้อหา ---------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4 md:hidden">
          <span className="font-semibold">HubChat</span>
          <AccountMenu admin={admin} onLogout={handleLogout} />
        </header>

        {/* pb-20 เว้นที่ให้แถบเมนูล่างบนมือถือ */}
        <main className="flex-1 overflow-x-hidden p-4 pb-24 md:pb-4">{children}</main>
      </div>

      {/* ---------- แถบเมนูล่าง (มือถือ) ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
                active ? 'text-primary font-medium' : 'text-muted-foreground',
              )}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={cn('justify-start gap-2', className)}>
          <UserCircle2 className="size-5" />
          <span className="truncate">{admin.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span>{admin.name}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {admin.email} · {ROLE_LABEL_TH[admin.role]}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/change-password">
            <KeyRound />
            เปลี่ยนรหัสผ่าน
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onLogout}>
          <LogOut />
          ออกจากระบบ
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
