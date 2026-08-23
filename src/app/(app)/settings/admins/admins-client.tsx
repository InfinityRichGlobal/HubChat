'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, LogOut, Loader2, Plus, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ROLE_LABEL_TH, ROLE_DESCRIPTION_TH } from '@/lib/auth/permissions';
import type { AdminRole } from '@/types/db';
import { toast } from 'sonner';

export type AdminRow = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  allowed_page_ids: string[];
  must_change_password: boolean;
  is_active: boolean;
  last_seen_at: string | null;
  last_login_ip: string | null;
  created_at: string;
};

export type PageOption = {
  id: string;
  display_name: string | null;
  page_name: string;
  platform: 'facebook' | 'instagram';
  tag_color: string;
};

/** ถือว่าออนไลน์ถ้าใช้งานภายใน 3 นาที */
function isOnline(lastSeen: string | null) {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 3 * 60 * 1000;
}

function timeAgoTh(iso: string | null) {
  if (!iso) return 'ยังไม่เคยเข้าใช้';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'เมื่อสักครู่';
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

export default function AdminsClient({
  meId,
  initialAdmins,
  pages,
}: {
  meId: string;
  initialAdmins: AdminRow[];
  pages: PageOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ name: string; password: string } | null>(null);
  const admins = initialAdmins;

  /** เรียก API แล้วรีเฟรชหน้า */
  async function call(url: string, init: RequestInit, successMsg?: string) {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      toast.error(json?.error?.message_th ?? 'ทำรายการไม่สำเร็จ');
      return null;
    }
    if (successMsg) toast.success(successMsg);
    startTransition(() => router.refresh());
    return json.data;
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">แอดมิน + สิทธิ์</h1>
          <p className="text-sm text-muted-foreground">เจ้าของเป็นคนสร้างบัญชีทั้งหมด ไม่มีหน้าสมัครสมาชิก</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          เพิ่มแอดมิน
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {admins.map((a) => (
          <Card key={a.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`size-2 shrink-0 rounded-full ${isOnline(a.last_seen_at) ? 'bg-[var(--success)]' : 'bg-muted-foreground/40'}`}
                  title={isOnline(a.last_seen_at) ? 'กำลังใช้งานอยู่' : 'ออฟไลน์'}
                />
                <CardTitle className="text-base">{a.name}</CardTitle>
                <Badge variant={a.role === 'owner' ? 'default' : 'secondary'}>{ROLE_LABEL_TH[a.role]}</Badge>
                {a.id === meId && <Badge variant="outline">คุณ</Badge>}
                {!a.is_active && <Badge variant="destructive">ปิดใช้งาน</Badge>}
                {a.must_change_password && <Badge variant="warning">รอตั้งรหัสใหม่</Badge>}
              </div>
              <CardDescription>
                {a.email} · ใช้งานล่าสุด {timeAgoTh(a.last_seen_at)}
                {a.last_login_ip ? ` · IP ${a.last_login_ip}` : ''}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              {/* --- สิทธิ์ --- */}
              <div className="grid gap-2 sm:max-w-xs">
                <Label>ระดับสิทธิ์</Label>
                <Select
                  value={a.role}
                  disabled={a.id === meId}
                  onValueChange={(role) =>
                    call(`/api/admins/${a.id}`, { method: 'PATCH', body: JSON.stringify({ role }) }, 'เปลี่ยนสิทธิ์แล้ว — บัญชีนี้ถูกออกจากระบบทุกอุปกรณ์')
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['owner', 'admin', 'viewer'] as AdminRole[]).map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABEL_TH[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTION_TH[a.role]}</p>
              </div>

              {/* --- เพจที่เห็น --- */}
              <div className="grid gap-2">
                <Label>เห็นเพจไหนบ้าง</Label>
                {a.role === 'owner' ? (
                  <p className="text-xs text-muted-foreground">เจ้าของเห็นทุกเพจเสมอ</p>
                ) : pages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">ยังไม่ได้เชื่อมเพจ (จะทำในรอบถัดไป)</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {pages.map((p) => {
                      const checked = a.allowed_page_ids.includes(p.id);
                      return (
                        <label key={p.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              const next = v
                                ? [...a.allowed_page_ids, p.id]
                                : a.allowed_page_ids.filter((id) => id !== p.id);
                              call(
                                `/api/admins/${a.id}`,
                                { method: 'PATCH', body: JSON.stringify({ allowed_page_ids: next }) },
                                'บันทึกสิทธิ์เพจแล้ว',
                              );
                            }}
                          />
                          <span className="inline-flex items-center gap-1">
                            <span className="size-2 rounded-full" style={{ backgroundColor: p.tag_color }} />
                            {p.display_name || p.page_name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* --- ปุ่มจัดการ --- */}
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <div className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={a.is_active}
                    disabled={a.id === meId}
                    onCheckedChange={(v) =>
                      call(
                        `/api/admins/${a.id}`,
                        { method: 'PATCH', body: JSON.stringify({ is_active: v }) },
                        v ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานชั่วคราวแล้ว',
                      )
                    }
                  />
                  <span>{a.is_active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</span>
                </div>

                <div className="grow" />

                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const data = await call(
                      `/api/admins/${a.id}`,
                      { method: 'PATCH', body: JSON.stringify({ reset_password: true }) },
                    );
                    if (data?.temp_password) setTempPassword({ name: a.name, password: data.temp_password });
                  }}
                >
                  <RotateCcw />
                  ตั้งรหัสชั่วคราวใหม่
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!confirm(`เตะ ${a.name} ออกจากทุกอุปกรณ์ทันที?\n(ใช้ตอนมือถือหายหรือสงสัยว่ารหัสหลุด)`)) return;
                    call(`/api/admins/${a.id}/force-logout`, { method: 'POST' }, 'เตะออกทุกอุปกรณ์แล้ว');
                  }}
                >
                  <LogOut />
                  เตะออกทุกอุปกรณ์
                </Button>

                {a.id !== meId && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (!confirm(`ลบบัญชี ${a.name} ถาวร?\nประวัติข้อความที่เคยตอบจะยังอยู่ แต่จะไม่ผูกกับชื่อนี้อีก`)) return;
                      call(`/api/admins/${a.id}`, { method: 'DELETE' }, 'ลบแอดมินแล้ว');
                    }}
                  >
                    <Trash2 />
                    ลบ
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {pending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> กำลังอัปเดต…
        </p>
      )}

      <CreateAdminDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        pages={pages}
        onCreated={(name, password) => setTempPassword({ name, password })}
        call={call}
      />

      <TempPasswordDialog value={tempPassword} onClose={() => setTempPassword(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* กล่องเพิ่มแอดมิน                                                     */
/* ------------------------------------------------------------------ */
function CreateAdminDialog({
  open,
  onOpenChange,
  pages,
  onCreated,
  call,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pages: PageOption[];
  onCreated: (name: string, password: string) => void;
  call: (url: string, init: RequestInit, msg?: string) => Promise<{ temp_password?: string } | null>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('admin');
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const data = await call('/api/admins', {
      method: 'POST',
      body: JSON.stringify({ name, email, role, allowed_page_ids: pageIds }),
    });
    setSaving(false);
    if (data?.temp_password) {
      onCreated(name, data.temp_password);
      onOpenChange(false);
      setName('');
      setEmail('');
      setRole('admin');
      setPageIds([]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>เพิ่มแอดมิน</DialogTitle>
          <DialogDescription>
            ระบบจะสุ่มรหัสผ่านชั่วคราวให้ และบังคับให้เจ้าตัวตั้งรหัสใหม่ตอนเข้าใช้ครั้งแรก
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="new-name">ชื่อ</Label>
            <Input id="new-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น โบว์" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-email">อีเมล</Label>
            <Input
              id="new-email"
              type="email"
              required
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="bow@example.com"
            />
          </div>
          <div className="grid gap-2">
            <Label>ระดับสิทธิ์</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AdminRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['admin', 'viewer', 'owner'] as AdminRole[]).map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABEL_TH[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTION_TH[role]}</p>
          </div>

          {pages.length > 0 && role !== 'owner' && (
            <div className="grid gap-2">
              <Label>เห็นเพจไหนบ้าง</Label>
              <div className="flex flex-wrap gap-3">
                {pages.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={pageIds.includes(p.id)}
                      onCheckedChange={(v) =>
                        setPageIds((prev) => (v ? [...prev, p.id] : prev.filter((id) => id !== p.id)))
                      }
                    />
                    {p.display_name || p.page_name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <UserPlus />}
              สร้างบัญชี
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* กล่องโชว์รหัสชั่วคราว — โชว์ครั้งเดียว                                */
/* ------------------------------------------------------------------ */
function TempPasswordDialog({
  value,
  onClose,
}: {
  value: { name: string; password: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>รหัสผ่านชั่วคราวของ {value?.name}</DialogTitle>
          <DialogDescription>
            คัดลอกส่งให้เจ้าตัวเลย — ปิดหน้าต่างนี้แล้วจะดูไม่ได้อีก
            (ในฐานข้อมูลเก็บเฉพาะค่าที่เข้ารหัสไว้)
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md border bg-muted px-3 py-3 text-center font-mono text-lg tracking-wider">
            {value?.password}
          </code>
          <Button
            variant="outline"
            size="icon"
            onClick={async () => {
              if (!value) return;
              await navigator.clipboard.writeText(value.password);
              toast.success('คัดลอกแล้ว');
            }}
          >
            <Copy />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>เรียบร้อย</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
