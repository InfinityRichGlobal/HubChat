'use client';
/**
 * แผงข้อมูลลูกค้าในห้องแชท (ก้อน 2 ข้อ 1.6 / 1.11)
 * ===========================================================================
 * ⚠️ ตั้งใจเป็น "แผงที่เปิด-ปิดได้" ไม่ใช่คอลัมน์ที่กางค้างไว้
 *    เพราะบนมือถือ (ซึ่งแอดมินใช้จริงเป็นหลัก) ไม่มีที่พอ
 *    และของที่กางค้างจะแย่งที่จากสิ่งที่สำคัญกว่า คือตัวแชทเอง
 *
 * แบ่ง 3 แท็บตามที่แอดมินคิดจริง ๆ :
 *    ข้อมูลลูกค้า → ส่งของไปหาใคร
 *    ออเดอร์      → เคยซื้ออะไร ค้างอะไรอยู่
 *    บันทึก       → มีอะไรต้องระวังไหม
 *
 * 🔴 แท็บ "บันทึก" เป็นข้อมูลภายใน **ห้ามส่งหาลูกค้าเด็ดขาด**
 *    จึงไม่มีปุ่มอะไรในแผงนี้ที่ส่งข้อความออกไปได้เลย
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2, Package, StickyNote, Trash2, User, Copy, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import CustomerAvatar from '@/components/customer-avatar';
import { cn } from '@/lib/utils';
import { customerProfileUrl } from '@/lib/customer-profile';

type WorkspaceOrder = {
  id: string;
  order_no: string;
  status: string;
  total: number;
  payment_status: string;
  shipping_carrier: string | null;
  tracking_no: string | null;
  created_at: string;
};

type WorkspaceNote = {
  id: string;
  body: string;
  admin_name: string | null;
  created_at: string;
};

type Workspace = {
  customer: {
    id: string; name: string | null; username: string | null; profile_pic_url: string | null; psid: string;
    recipient_name: string | null; phone: string | null; address: string | null; postcode: string | null;
    total_orders: number; total_spent: number;
    first_contact_at: string | null; contact_updated_at: string | null;
  };
  page: { id: string; name: string; platform: string };
  orders: WorkspaceOrder[];
  notes: WorkspaceNote[];
};

const STATUS_TH: Record<string, string> = {
  draft: 'ร่าง', confirmed: 'ยืนยันแล้ว', paid: 'จ่ายแล้ว', packed: 'แพ็กแล้ว',
  shipped: 'ส่งแล้ว', completed: 'สำเร็จ', cancelled: 'ยกเลิก', returned: 'ตีกลับ',
};
const PAYMENT_TH: Record<string, string> = {
  unpaid: 'ยังไม่จ่าย', deposit: 'มัดจำแล้ว', paid: 'จ่ายแล้ว',
};
const STATUS_CLASS: Record<string, string> = {
  draft: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  confirmed: 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300',
  paid: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  packed: 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300',
  shipped: 'border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950 dark:text-cyan-300',
  completed: 'border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300',
  cancelled: 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
  returned: 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300',
};

function money(n: number): string {
  return n.toLocaleString('th-TH');
}

function dateTh(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

export default function CustomerDrawer({
  conversationId,
  open,
  onClose,
  onInsertText,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
  /** ⭐ วางข้อความลงช่องพิมพ์ — ไม่ส่งเอง แอดมินต้องกดส่งอีกที */
  onInsertText: (text: string) => void;
}) {
  const [tab, setTab] = useState<'customer' | 'orders' | 'notes'>('customer');
  const [data, setData] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/workspace`, { cache: 'no-store' });
      const json = (await res.json()) as { ok: boolean; data?: Workspace; error?: { message_th: string } };
      if (json.ok && json.data) setData(json.data);
      else toast.error(json.error?.message_th ?? 'อ่านข้อมูลลูกค้าไม่สำเร็จ');
    } catch {
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      await load();
      if (!alive) return;
    })();
    return () => { alive = false; };
  }, [open, load]);

  /**
   * ⭐ ปุ่มลัดทุกตัวเรียกเซิร์ฟเวอร์ให้ประกอบข้อความ
   *    เบราว์เซอร์ไม่ประกอบเอง เพราะราคา/ยอด/เลขพัสดุคือความจริงของร้าน
   */
  async function compose(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/compose`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { text: string; ready: boolean; warning_th: string | null };
        error?: { message_th: string };
      };
      if (!json.ok || !json.data) {
        toast.error(json.error?.message_th ?? 'ประกอบข้อความไม่สำเร็จ');
        return;
      }
      /**
       * 🔴 ขาดข้อมูล = เตือนก่อน ไม่ปล่อยให้วางแล้วกดส่งเลย
       *    ข้อความที่ขาดที่อยู่/เลขพัสดุ ส่งไปแล้วแก้ไม่ได้
       */
      if (!json.data.ready) {
        toast.warning(json.data.warning_th ?? 'ข้อมูลยังไม่ครบ', { duration: 8000 });
        if (!json.data.text) return;
      }
      onInsertText(json.data.text);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    const body = noteDraft.trim();
    if (!body) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const json = (await res.json()) as { ok: boolean; data?: { notes: WorkspaceNote[] }; error?: { message_th: string } };
      if (json.ok && json.data) {
        setData((d) => (d ? { ...d, notes: json.data!.notes } : d));
        setNoteDraft('');
      } else toast.error(json.error?.message_th ?? 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function removeNote(noteId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/notes`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note_id: noteId }),
      });
      const json = (await res.json()) as { ok: boolean; data?: { notes: WorkspaceNote[] } };
      if (json.ok && json.data) setData((d) => (d ? { ...d, notes: json.data!.notes } : d));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const c = data?.customer;
  const displayName = (c?.name ?? '').trim() || (c ? `ลูกค้า ${c.psid.slice(-6)}` : 'ลูกค้า');
  const profileUrl = data && c ? customerProfileUrl(data.page.platform as 'facebook' | 'instagram', c.username) : null;

  const TABS = [
    { key: 'customer' as const, label: 'ข้อมูลลูกค้า', icon: User },
    { key: 'orders' as const, label: `ออเดอร์${data ? ` (${data.orders.length})` : ''}`, icon: Package },
    { key: 'notes' as const, label: `บันทึก${data ? ` (${data.notes.length})` : ''}`, icon: StickyNote },
  ];

  return (
    /**
     * ⚠️ บนมือถือกินเต็มจอ บนจอใหญ่เป็นแผงข้างขวา
     *    ใช้ inset-0 + sm:left-auto เพื่อไม่ต้องเขียนสองชุด
     */
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* หัวแผง */}
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <CustomerAvatar name={displayName} src={c?.profile_pic_url} size="md" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{displayName}</div>
            <div className="text-[11px] text-muted-foreground">{c?.username ? `@${c.username} · ` : ''}{data?.page.name}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>ปิด</Button>
        </div>

        {/* แท็บ */}
        <div className="flex border-b">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-xs',
                tab === t.key ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground',
              )}
            >
              <t.icon className="size-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && !data && (
            <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin" /></div>
          )}

          {/* ---------- ข้อมูลลูกค้า ---------- */}
          {tab === 'customer' && c && (
            <div className="flex flex-col gap-3">
              <dl className="flex flex-col gap-2 text-sm">
                {profileUrl && (
                  <div className="flex items-center gap-3">
                    <dt className="w-24 shrink-0 text-muted-foreground">โปรไฟล์</dt>
                    <dd><Button asChild variant="outline" size="sm" className="h-8"><a href={profileUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" /> เปิด Instagram</a></Button></dd>
                  </div>
                )}
                <Row label="ชื่อผู้รับ" value={c.recipient_name} />
                <Row label="เบอร์" value={c.phone} copyable />
                <Row
                  label="ที่อยู่"
                  value={c.address ? `${c.address}${c.postcode ? ` ${c.postcode}` : ''}` : null}
                  copyable
                />
                <Row label="ซื้อไปแล้ว" value={`${c.total_orders} ออเดอร์ · ${money(c.total_spent)} บาท`} />
                <Row label="ทักครั้งแรก" value={c.first_contact_at ? dateTh(c.first_contact_at) : null} />
                <Row label="แก้ข้อมูลล่าสุด" value={c.contact_updated_at ? dateTh(c.contact_updated_at) : null} />
              </dl>

              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void compose({ kind: 'shipping' })}
              >
                ใส่ข้อมูลจัดส่งในช่องพิมพ์
              </Button>
            </div>
          )}

          {/* ---------- ออเดอร์ ---------- */}
          {tab === 'orders' && data && (
            <div className="flex flex-col gap-2">
              {data.orders.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีออเดอร์</p>
              )}
              {data.orders.map((o) => (
                <div key={o.id} className="rounded-lg border p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium">{o.order_no}</span>
                    <Badge variant="outline" className={cn('text-[10px]', STATUS_CLASS[o.status])}>
                      {STATUS_TH[o.status] ?? o.status}
                    </Badge>
                    <span className="ml-auto text-sm font-medium">{money(o.total)} บาท</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                    <span>{dateTh(o.created_at)}</span>
                    <span>· {PAYMENT_TH[o.payment_status] ?? o.payment_status}</span>
                    {o.tracking_no && <span>· {o.shipping_carrier} {o.tracking_no}</span>}
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <Button
                      variant="outline" size="sm" className="h-7 text-[11px]"
                      disabled={busy}
                      onClick={() => void compose({ kind: 'order', order_id: o.id })}
                    >
                      ใส่สรุปในช่องพิมพ์
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-[11px]" asChild>
                      <a href={`/orders?q=${encodeURIComponent(o.order_no)}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-3" /> เปิด
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ---------- บันทึกภายใน ---------- */}
          {tab === 'notes' && data && (
            <div className="flex flex-col gap-2">
              <p className="rounded-md bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">
                🔒 บันทึกภายใน — ลูกค้าไม่เห็น และระบบไม่ส่งออกไปไม่ว่ากรณีใด
              </p>

              <div className="flex gap-1.5">
                <Input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addNote(); }
                  }}
                  placeholder="เช่น ลูกค้าขอใบกำกับภาษี"
                  maxLength={2000}
                />
                <Button size="sm" disabled={busy || !noteDraft.trim()} onClick={() => void addNote()}>
                  เพิ่ม
                </Button>
              </div>

              {data.notes.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีบันทึก</p>
              )}
              {data.notes.map((n) => (
                <div key={n.id} className="flex items-start gap-2 rounded-lg border p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {n.admin_name ?? 'ไม่ทราบ'} · {dateTh(n.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeNote(n.id)}
                    disabled={busy}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
                    aria-label="ลบบันทึก"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function Row({ label, value, copyable }: { label: string; value: string | null; copyable?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="w-24 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">
        {value ? (
          <span className="flex items-start gap-1">
            <span className="min-w-0 flex-1">{value}</span>
            {copyable && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(value).then(
                    () => toast.success('คัดลอกแล้ว'),
                    () => toast.error('คัดลอกไม่สำเร็จ'),
                  );
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
                aria-label={`คัดลอก${label}`}
              >
                <Copy className="size-3" />
              </button>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </dd>
    </div>
  );
}
