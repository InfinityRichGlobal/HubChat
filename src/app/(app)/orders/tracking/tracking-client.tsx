'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2,
  Send, SkipForward, Trash2, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ImportRowView, ImportView } from '@/server/tracking/service';
import type { NotificationView } from '@/server/tracking/notify';

/**
 * หน้านำเข้าเลขพัสดุ (ฝั่งหน้าเว็บ) — สเปกหัวข้อ 5.8
 * ===========================================================================
 * 🔴 กฎที่หน้านี้ต้องเคารพ :
 *
 *   1. หน้าเว็บ "ไม่ตัดสินใจ" อะไรทั้งสิ้น
 *      การตรวจไฟล์ / จับคู่ออเดอร์ / ตัดสินว่าส่งได้ไหม อยู่ฝั่งเซิร์ฟเวอร์หมด
 *      ที่เห็นบนจอคือ "ผลที่เซิร์ฟเวอร์ตัดสินมาแล้ว" ไม่ใช่ผลที่หน้าเว็บคำนวณเอง
 *
 *   2. ⭐ ต้องเห็น preview ก่อนเสมอ ห้ามลงเลขพัสดุทันทีที่อัปโหลด
 *      จับคู่ผิด = ลูกค้าได้เลขของคนอื่น = แก้ไม่ได้
 *
 *   3. การแจ้งลูกค้าแยกออกจากการลงเลขพัสดุคนละปุ่ม
 *      ลง 300 ใบ ต้องไม่กลายเป็นยิง 300 ข้อความโดยไม่ตั้งใจ
 */

/* ---------------------------------------------------------------- */

const MATCH_LABEL: Record<string, { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  auto: { text: 'จับคู่ได้', tone: 'ok' },
  manual: { text: 'แอดมินเลือกเอง', tone: 'ok' },
  ambiguous: { text: 'ต้องเลือก', tone: 'warn' },
  unmatched: { text: 'ไม่เจอออเดอร์', tone: 'bad' },
  skipped: { text: 'ข้าม', tone: 'muted' },
};

const APPLY_LABEL: Record<string, { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  pending: { text: 'รอลง', tone: 'muted' },
  applied: { text: 'ลงแล้ว', tone: 'ok' },
  noop: { text: 'เหมือนเดิม', tone: 'muted' },
  skipped: { text: 'ข้าม', tone: 'muted' },
  failed: { text: 'ล้มเหลว', tone: 'bad' },
};

const NOTIFY_LABEL: Record<string, { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  queued: { text: 'รอส่ง', tone: 'muted' },
  claimed: { text: 'กำลังส่ง', tone: 'muted' },
  sent: { text: 'แจ้งแล้ว', tone: 'ok' },
  blocked: { text: 'ส่งไม่ได้', tone: 'warn' },
  failed: { text: 'ล้มเหลว', tone: 'bad' },
  unknown: { text: '⚠️ ไม่ทราบผล', tone: 'bad' },
  skipped: { text: 'ข้าม', tone: 'muted' },
};

function Tone({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: React.ReactNode }) {
  return (
    <Badge
      variant={tone === 'bad' ? 'destructive' : tone === 'ok' ? 'default' : 'secondary'}
      className={cn('shrink-0 text-[10px]', tone === 'warn' && 'bg-amber-500 text-white hover:bg-amber-500')}
    >
      {children}
    </Badge>
  );
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
    // ⚠️ ต้องมีตัวรับเสมอ ไม่งั้นกดแล้วเหมือนไม่มีอะไรเกิดขึ้น
    console.error('[tracking] เรียก API ไม่สำเร็จ:', url, err);
    toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    return null;
  }
}

/* ================================================================== */

export default function TrackingClient({
  isOwner,
  initialImports,
}: {
  isOwner: boolean;
  initialImports: ImportView[];
}) {
  const [imports, setImports] = useState(initialImports);
  const [openId, setOpenId] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    const d = await api<{ imports: ImportView[] }>('/api/tracking/imports');
    if (d) setImports(d.imports);
  }, []);

  if (openId) {
    return (
      <ImportDetail
        importId={openId}
        isOwner={isOwner}
        onBack={() => {
          setOpenId(null);
          void refreshList();
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">นำเข้าเลขพัสดุ</h1>
          <p className="text-sm text-muted-foreground">
            อัปโหลดไฟล์จากขนส่ง → ตรวจการจับคู่ → ลงเลขพัสดุ → แจ้งลูกค้า
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/orders">
            <ArrowLeft />
            กลับหน้าออเดอร์
          </Link>
        </Button>
      </div>

      <UploadCard onUploaded={(id) => setOpenId(id)} onDuplicate={(id) => setOpenId(id)} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">รอบที่เคยนำเข้า</CardTitle>
          <CardDescription>กดเพื่อเปิดดูรายละเอียดและทำต่อจากที่ค้างไว้</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {imports.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">ยังไม่เคยนำเข้าไฟล์ไหนเลย</p>
          )}
          {imports.map((im) => (
            <button
              key={im.id}
              type="button"
              onClick={() => setOpenId(im.id)}
              className="flex flex-col gap-1 rounded-md border p-2.5 text-left hover:bg-accent/50"
            >
              <div className="flex flex-wrap items-center gap-2">
                <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">{im.filename}</span>
                <Tone tone={im.status === 'applied' ? 'ok' : im.status === 'cancelled' ? 'muted' : 'warn'}>
                  {im.status === 'applied' ? 'ลงแล้ว' : im.status === 'cancelled' ? 'ยกเลิก' : 'รอตรวจ'}
                </Tone>
              </div>
              <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                <span>{im.total_rows} แถว</span>
                <span>จับคู่ได้ {im.matched_auto}</span>
                {im.unmatched > 0 && <span className="text-amber-600">ต้องดู {im.unmatched}</span>}
                {im.status === 'applied' && <span>ลงจริง {im.applied_count}</span>}
                {im.notified_count > 0 && <span>แจ้งแล้ว {im.notified_count}</span>}
                {im.blocked_count > 0 && <span className="text-amber-600">แจ้งไม่ได้ {im.blocked_count}</span>}
                <span className="ml-auto">
                  {new Date(im.created_at).toLocaleString('th-TH', { hour12: false })}
                </span>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* ================================================================== */
/* อัปโหลด                                                            */
/* ================================================================== */

function UploadCard({
  onUploaded,
  onDuplicate,
}: {
  onUploaded: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);

      const res = await fetch('/api/tracking/imports', { method: 'POST', body: form });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        /**
         * ⭐ ไฟล์ซ้ำไม่ใช่ความผิดพลาด — พาไปที่รอบเดิมเลย
         *    เจ้าของร้านจะได้ทำต่อจากที่ค้างไว้ ไม่ใช่งงว่าทำไมอัปโหลดไม่ได้
         */
        if (json?.error?.code === 'duplicate_file' && json.error.import_id) {
          toast.info(json.error.message_th);
          onDuplicate(json.error.import_id as string);
          return;
        }
        toast.error(json?.error?.message_th ?? 'อัปโหลดไม่สำเร็จ');
        return;
      }

      const s = json.data.summary as { total: number; auto: number; ambiguous: number; unmatched: number };
      toast.success(
        `อ่านไฟล์แล้ว ${s.total} แถว — จับคู่ได้ ${s.auto} · ต้องเลือก ${s.ambiguous} · ไม่เจอ ${s.unmatched}`,
      );
      onUploaded(json.data.import_id as string);
    } catch (err) {
      console.error('[tracking] อัปโหลดไม่สำเร็จ:', err);
      toast.error('อัปโหลดไม่สำเร็จ — ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">อัปโหลดไฟล์จากขนส่ง</CardTitle>
        <CardDescription>
          รองรับไฟล์ CSV — ระบบจะเดาให้เองว่าคอลัมน์ไหนคืออะไร แล้วให้ตรวจก่อนลงจริงเสมอ
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
            เลือกไฟล์ CSV
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/tracking/template" download>
              <Download />
              โหลดไฟล์ตัวอย่าง
            </a>
          </Button>
        </div>

        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>เคล็ดลับที่ทำให้จับคู่แม่น 100%</AlertTitle>
          <AlertDescription>
            ตอนสร้างใบปะหน้าที่ขนส่ง ให้ใส่ <strong>เลขออเดอร์ของเรา</strong> ลงช่อง
            &quot;อ้างอิง&quot; ของขนส่ง แล้วระบบจะจับคู่ได้ตรงทุกใบโดยไม่ต้องพึ่งเบอร์โทรเลย
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */
/* รายละเอียดรอบนำเข้า                                                 */
/* ================================================================== */

type Detail = { import: ImportView; rows: ImportRowView[]; notifications: NotificationView[] };

const FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'auto', label: 'จับคู่ได้' },
  { key: 'ambiguous', label: 'ต้องเลือก' },
  { key: 'unmatched', label: 'ไม่เจอ' },
  { key: 'problem', label: 'มีปัญหา' },
] as const;

function ImportDetail({
  importId,
  isOwner,
  onBack,
}: {
  importId: string;
  isOwner: boolean;
  onBack: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [busy, setBusy] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [notifyMode, setNotifyMode] = useState<'none' | 'prepare'>('prepare');

  const load = useCallback(async () => {
    const d = await api<Detail>(`/api/tracking/imports/${importId}`);
    if (d) setData(d);
  }, [importId]);

  useEffect(() => {
    /**
     * ⚠️ ห่อด้วย setTimeout(0) โดยตั้งใจ
     *    เรียก setState ตรง ๆ ในตัว effect ทำให้ React เรนเดอร์ซ้อนกันเป็นทอด ๆ
     *    (เจอกฎนี้มาแล้วในกล่องสร้างออเดอร์รอบ 5 — แก้ด้วยวิธีเดียวกัน)
     */
    let alive = true;
    const t = setTimeout(() => {
      if (alive) void load();
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [load]);

  // ⚠️ ต้อง memo ไว้ ไม่งั้นอาเรย์ก้อนใหม่ทุกเรนเดอร์จะทำให้ useMemo ข้างล่างทำงานเปล่า ๆ
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);

  const counts = useMemo(() => {
    const c = { auto: 0, ambiguous: 0, unmatched: 0, skipped: 0, manual: 0, problem: 0 };
    for (const r of rows) {
      if (r.match_status in c) c[r.match_status as keyof typeof c] += 1;
      if (r.problems.length > 0) c.problem += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'problem') return rows.filter((r) => r.problems.length > 0);
    return rows.filter((r) => r.match_status === filter);
  }, [rows, filter]);

  const notifyByOrder = useMemo(
    () => new Map((data?.notifications ?? []).map((n) => [n.order_id, n])),
    [data?.notifications],
  );

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-5xl py-10 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
        กำลังโหลด…
      </div>
    );
  }

  const im = data.import;
  const isApplied = im.status === 'applied';
  const isCancelled = im.status === 'cancelled';
  const queued = data.notifications.filter((n) => n.status === 'queued').length;

  async function apply() {
    setBusy(true);
    try {
      const d = await api<{ result: Record<string, number> }>(
        `/api/tracking/imports/${importId}/apply`,
        { method: 'POST', body: JSON.stringify({ confirm: true, notify_mode: notifyMode }) },
      );
      if (d) {
        const r = d.result;
        toast.success(
          `ลงเลขพัสดุแล้ว ${r.applied_count} ใบ · เหมือนเดิม ${r.noop_count} · ข้าม ${r.skipped_count}` +
            (r.queued_count > 0 ? ` · เตรียมแจ้งลูกค้า ${r.queued_count} ราย` : ''),
        );
        await load();
      }
    } finally {
      setBusy(false);
      setConfirmApply(false);
    }
  }

  /** ดาวน์โหลดแถวที่มีปัญหาไปแก้ในไฟล์ต้นทาง */
  function exportProblems() {
    const bad = rows.filter((r) => r.problems.length > 0 || r.match_status === 'unmatched');
    if (bad.length === 0) {
      toast.info('ไม่มีแถวที่มีปัญหา');
      return;
    }
    const head = ['แถวที่', 'เลขออเดอร์', 'เลขพัสดุ', 'ชื่อผู้รับ', 'เบอร์', 'รหัสไปรษณีย์', 'ปัญหา'];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = bad.map((r) =>
      [
        String(r.row_index),
        r.order_ref_raw ?? '',
        r.tracking_no ?? '',
        r.recipient_name ?? '',
        r.phone_raw ?? '',
        r.postcode ?? '',
        [...r.problems.map((p) => p.message_th), r.note_th ?? ''].filter(Boolean).join(' / '),
      ].map(esc).join(','),
    );
    // BOM เพื่อให้ Excel เปิดแล้วภาษาไทยไม่เพี้ยน
    const blob = new Blob([`﻿${head.map(esc).join(',')}\n${lines.join('\n')}\n`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `แถวที่ต้องแก้-${im.filename}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {/* ---------- หัวเรื่อง ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="กลับ">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{im.filename}</h1>
          <p className="text-[11px] text-muted-foreground">
            {im.total_rows} แถว · อัปโหลดเมื่อ{' '}
            {new Date(im.created_at).toLocaleString('th-TH', { hour12: false })}
          </p>
        </div>
        <Tone tone={isApplied ? 'ok' : isCancelled ? 'muted' : 'warn'}>
          {isApplied ? 'ลงเลขพัสดุแล้ว' : isCancelled ? 'ยกเลิกแล้ว' : 'รอตรวจ'}
        </Tone>
      </div>

      {/* ---------- สรุป ---------- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="จับคู่ได้" value={counts.auto + counts.manual} tone="ok" />
        <Stat label="ต้องเลือกเอง" value={counts.ambiguous} tone="warn" />
        <Stat label="ไม่เจอออเดอร์" value={counts.unmatched} tone="bad" />
        <Stat label="ข้าม" value={counts.skipped} tone="muted" />
      </div>

      {isApplied && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="ลงจริง" value={im.applied_count} tone="ok" />
          <Stat label="เหมือนเดิม" value={im.noop_count} tone="muted" />
          <Stat label="แจ้งลูกค้าแล้ว" value={im.notified_count} tone="ok" />
          <Stat label="แจ้งไม่ได้" value={im.blocked_count} tone="warn" />
        </div>
      )}

      {/* ---------- การจับคู่คอลัมน์ ---------- */}
      {!isApplied && !isCancelled && (
        <MappingCard importId={importId} view={im} onChanged={load} />
      )}

      {/* ---------- ปุ่มหลัก ---------- */}
      {!isApplied && !isCancelled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ลงเลขพัสดุเข้าออเดอร์</CardTitle>
            <CardDescription>
              ตรวจตารางด้านล่างให้เรียบร้อยก่อน — ลงแล้วแก้การจับคู่ย้อนหลังไม่ได้
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label className="text-xs">หลังลงเลขพัสดุแล้วจะทำอะไรต่อ</Label>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={notifyMode === 'prepare'}
                    onChange={() => setNotifyMode('prepare')}
                  />
                  <span>
                    เตรียมข้อความแจ้งลูกค้าไว้ก่อน (แนะนำ)
                    <span className="block text-[11px] text-muted-foreground">
                      ยังไม่ส่ง — จะได้ตรวจจำนวนก่อน แล้วค่อยกดส่งอีกทีหนึ่ง
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={notifyMode === 'none'}
                    onChange={() => setNotifyMode('none')}
                  />
                  <span>
                    ลงเลขพัสดุอย่างเดียว
                    <span className="block text-[11px] text-muted-foreground">
                      ไม่แตะเรื่องแจ้งลูกค้าเลย
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setConfirmApply(true)} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                ลงเลขพัสดุ
              </Button>
              <Button variant="outline" onClick={exportProblems}>
                <Download />
                โหลดแถวที่ต้องแก้
              </Button>
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={async () => {
                  if (!confirm('ยกเลิกรอบนำเข้านี้? ข้อมูลในไฟล์จะไม่ถูกนำไปใช้')) return;
                  const d = await api(`/api/tracking/imports/${importId}`, { method: 'DELETE' });
                  if (d) {
                    toast.success('ยกเลิกรอบนำเข้าแล้ว');
                    onBack();
                  }
                }}
              >
                <Trash2 />
                ยกเลิกรอบนี้
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------- แจ้งลูกค้า ---------- */}
      {isApplied && (
        <NotifyCard
          importId={importId}
          queued={queued}
          notifications={data.notifications}
          onDone={load}
        />
      )}

      {/* ---------- ตัวกรอง ---------- */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? 'default' : 'outline'}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className="ml-1 opacity-70">
              {f.key === 'all'
                ? rows.length
                : f.key === 'problem'
                  ? counts.problem
                  : counts[f.key as keyof typeof counts]}
            </span>
          </Button>
        ))}
      </div>

      {/* ---------- ตาราง ---------- */}
      <div className="flex flex-col gap-2">
        {visible.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">ไม่มีแถวในหมวดนี้</p>
        )}
        {visible.map((r) => (
          <RowCard
            key={r.id}
            row={r}
            importId={importId}
            locked={isApplied || isCancelled}
            notification={r.matched_order_id ? notifyByOrder.get(r.matched_order_id) : undefined}
            onChanged={load}
          />
        ))}
      </div>

      {/* ---------- ยืนยันก่อนลง ---------- */}
      <Dialog open={confirmApply} onOpenChange={setConfirmApply}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันลงเลขพัสดุ</DialogTitle>
            <DialogDescription>ตรวจตัวเลขอีกครั้งก่อนกด — ลงแล้วย้อนกลับไม่ได้</DialogDescription>
          </DialogHeader>

          <ul className="flex flex-col gap-1 py-2 text-sm">
            <li>✅ จะลงเลขพัสดุให้ <strong>{counts.auto + counts.manual}</strong> ใบ</li>
            {counts.ambiguous > 0 && (
              <li className="text-amber-600">
                ⚠️ ยังมี <strong>{counts.ambiguous}</strong> แถวที่ต้องเลือกเอง — แถวพวกนี้จะถูกข้าม
              </li>
            )}
            {counts.unmatched > 0 && (
              <li className="text-destructive">
                ❌ หาออเดอร์ไม่เจอ <strong>{counts.unmatched}</strong> แถว — จะถูกข้าม
              </li>
            )}
            <li className="mt-1 text-[11px] text-muted-foreground">
              {notifyMode === 'prepare'
                ? 'จะเตรียมข้อความแจ้งลูกค้าไว้ แต่ยังไม่ส่ง — ต้องกดส่งอีกครั้งหนึ่ง'
                : 'จะไม่แตะเรื่องแจ้งลูกค้าเลย'}
            </li>
          </ul>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmApply(false)}>
              ยกเลิก
            </Button>
            <Button onClick={() => void apply()} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              ยืนยัน ลงเลขพัสดุ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isOwner && isApplied && (
        <p className="text-[11px] text-muted-foreground">
          💡 ถ้าต้องแก้เลขพัสดุของบางใบย้อนหลัง ให้แก้ทีละใบในหน้าออเดอร์ — ทุกการแก้จะถูกจดประวัติไว้
        </p>
      )}
    </div>
  );
}

function Stat({
  label, value, tone,
}: { label: string; value: number; tone: 'ok' | 'warn' | 'bad' | 'muted' }) {
  return (
    <div className="rounded-md border p-2.5">
      <div
        className={cn(
          'text-xl font-semibold',
          tone === 'ok' && 'text-emerald-600',
          tone === 'warn' && 'text-amber-600',
          tone === 'bad' && value > 0 && 'text-destructive',
        )}
      >
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/* ================================================================== */
/* แถวเดียว                                                           */
/* ================================================================== */

function RowCard({
  row: r,
  importId,
  locked,
  notification,
  onChanged,
}: {
  row: ImportRowView;
  importId: string;
  locked: boolean;
  notification?: NotificationView;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [orderNo, setOrderNo] = useState('');

  const match = MATCH_LABEL[r.match_status] ?? { text: r.match_status, tone: 'muted' as const };
  const applyState = APPLY_LABEL[r.apply_status];

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const d = await api(`/api/tracking/imports/${importId}/rows/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (d) await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">#{r.row_index}</span>
        <span className="font-mono text-xs font-medium">{r.tracking_no ?? '— ไม่มีเลขพัสดุ —'}</span>
        <Tone tone={match.tone}>{match.text}</Tone>
        {locked && applyState && <Tone tone={applyState.tone}>{applyState.text}</Tone>}
        {notification && (
          <Tone tone={NOTIFY_LABEL[notification.status]?.tone ?? 'muted'}>
            {NOTIFY_LABEL[notification.status]?.text ?? notification.status}
          </Tone>
        )}
      </div>

      <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        {r.order_ref_raw && <span>อ้างอิง {r.order_ref_raw}</span>}
        {r.recipient_name && <span>{r.recipient_name}</span>}
        {r.phone_raw && <span>{r.phone_raw}</span>}
        {r.postcode && <span>{r.postcode}</span>}
      </div>

      {r.problems.map((p, i) => (
        <p
          key={i}
          className={cn('text-[11px]', p.level === 'error' ? 'text-destructive' : 'text-amber-600')}
        >
          {p.level === 'error' ? '❌' : '⚠️'} {p.message_th}
        </p>
      ))}

      {r.note_th && <p className="text-[11px] text-muted-foreground">{r.note_th}</p>}
      {r.prev_tracking_no && (
        <p className="text-[11px] text-amber-600">
          เลขเดิมคือ {r.prev_tracking_no} — ถูกเปลี่ยนแล้ว (ประวัติอยู่ในหน้าออเดอร์)
        </p>
      )}
      {notification?.policy_reason_th && notification.status !== 'sent' && (
        <p className="text-[11px] text-amber-600">แจ้งลูกค้าไม่ได้: {notification.policy_reason_th}</p>
      )}

      {/* ---- ให้แอดมินเลือกเอง ---- */}
      {!locked && (r.match_status === 'ambiguous' || r.match_status === 'unmatched') && (
        <div className="mt-1 flex flex-wrap items-end gap-2 border-t pt-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor={`ord-${r.id}`} className="text-[11px]">
              ใส่เลขออเดอร์ที่ถูกต้อง
            </Label>
            <Input
              id={`ord-${r.id}`}
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              placeholder="ORD-260823-001"
              className="h-8 text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || orderNo.trim() === ''}
            onClick={async () => {
              /**
               * ⚠️ หน้าเว็บไม่รู้จัก id ของออเดอร์ จึงต้องถามเซิร์ฟเวอร์ก่อน
               *    และเซิร์ฟเวอร์จะตรวจสิทธิ์เพจซ้ำอีกชั้นตอนบันทึกอยู่ดี
               */
              const d = await api<{ orders: Array<{ id: string; order_no: string }> }>(
                `/api/orders?search=${encodeURIComponent(orderNo.trim())}&limit=5`,
              );
              const hit = d?.orders.find(
                (o) => o.order_no.toUpperCase() === orderNo.trim().toUpperCase(),
              );
              if (!hit) {
                toast.error('หาออเดอร์เลขนี้ไม่เจอ');
                return;
              }
              await act({ action: 'choose', order_id: hit.id });
              toast.success(`ผูกกับ ${hit.order_no} แล้ว`);
            }}
          >
            ผูกออเดอร์
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ action: 'skip' })}>
            <SkipForward />
            ข้ามแถวนี้
          </Button>
        </div>
      )}

      {!locked && r.match_status === 'manual' && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start text-[11px]"
          disabled={busy}
          onClick={() => void act({ action: 'reset' })}
        >
          ล้างการเลือก
        </Button>
      )}
    </div>
  );
}

/* ================================================================== */
/* แจ้งลูกค้า                                                          */
/* ================================================================== */

function NotifyCard({
  importId,
  queued,
  notifications,
  onDone,
}: {
  importId: string;
  queued: number;
  notifications: NotificationView[];
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ignoreQuiet, setIgnoreQuiet] = useState(false);

  const sent = notifications.filter((n) => n.status === 'sent').length;
  const blocked = notifications.filter((n) => n.status === 'blocked').length;
  const unknown = notifications.filter((n) => n.status === 'unknown').length;

  async function run() {
    setBusy(true);
    try {
      const d = await api<{ summary: Record<string, number> & { quiet_hours: boolean } }>(
        `/api/tracking/imports/${importId}/notify`,
        { method: 'POST', body: JSON.stringify({ confirm: true, ignore_quiet_hours: ignoreQuiet }) },
      );
      if (d) {
        const s = d.summary;
        if (s.quiet_hours) {
          toast.info('ตอนนี้อยู่ในช่วง 22:00-08:00 — พักไว้ก่อนเพื่อไม่รบกวนลูกค้า', {
            description: 'คิวยังอยู่ครบ กดส่งพรุ่งนี้เช้าได้เลย หรือติ๊ก "ส่งเดี๋ยวนี้" ถ้าจำเป็นจริง ๆ',
            duration: 10_000,
          });
        } else {
          toast.success(
            `ส่งแล้ว ${s.sent} ราย` +
              (s.blocked > 0 ? ` · ส่งไม่ได้ ${s.blocked}` : '') +
              (s.unknown > 0 ? ` · ไม่ทราบผล ${s.unknown}` : '') +
              (s.remaining > 0 ? ` · เหลืออีก ${s.remaining} กดส่งต่อได้` : ''),
          );
        }
        await onDone();
      }
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">แจ้งลูกค้าว่าจัดส่งแล้ว</CardTitle>
        <CardDescription>
          ทยอยส่ง 10 ข้อความ/นาที ผ่าน Message Policy Engine — ลูกค้าที่ส่งไม่ได้จะถูกจดไว้ให้ตามเอง
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-4 text-sm">
          <span>รอส่ง <strong>{queued}</strong></span>
          <span className="text-emerald-600">แจ้งแล้ว <strong>{sent}</strong></span>
          {blocked > 0 && <span className="text-amber-600">ส่งไม่ได้ <strong>{blocked}</strong></span>}
          {unknown > 0 && <span className="text-destructive">ไม่ทราบผล <strong>{unknown}</strong></span>}
        </div>

        {unknown > 0 && (
          <Alert variant="warning">
            <AlertTriangle className="size-4" />
            <AlertTitle>มี {unknown} รายที่ยิงออกไปแล้วแต่ไม่ทราบผล</AlertTitle>
            <AlertDescription>
              ข้อความอาจถึงลูกค้าไปแล้ว ระบบจึงไม่ส่งซ้ำให้เองโดยเด็ดขาด
              ถ้าจำเป็นต้องส่งใหม่ ให้เปิดดูใน Messenger ก่อน แล้วสั่งทีละใบจากหน้าออเดอร์
            </AlertDescription>
          </Alert>
        )}

        {queued > 0 ? (
          <>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={ignoreQuiet} onCheckedChange={(v) => setIgnoreQuiet(v === true)} />
              ส่งเดี๋ยวนี้แม้อยู่ในช่วง 22:00-08:00
            </label>
            <Button className="self-start" onClick={() => setConfirmOpen(true)} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              ส่งข้อความแจ้งลูกค้า ({queued} ราย)
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            ไม่มีรายการค้างในคิว
            {sent + blocked + unknown === 0 &&
              ' — รอบนี้เลือกไว้ว่า "ลงเลขพัสดุอย่างเดียว" จึงไม่มีการแจ้งลูกค้า'}
          </p>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันส่งข้อความหาลูกค้า</DialogTitle>
            <DialogDescription>
              ข้อความจะออกไปหาลูกค้าจริง ๆ — ตรวจให้แน่ใจว่าเลขพัสดุถูกต้องแล้ว
            </DialogDescription>
          </DialogHeader>

          <ul className="flex flex-col gap-1 py-2 text-sm">
            <li>📤 จะส่งให้ <strong>{queued}</strong> ราย</li>
            <li className="text-[11px] text-muted-foreground">
              ทยอยส่ง 10 ข้อความ/นาที เพื่อไม่ให้ Meta จำกัดการใช้งานของเพจ
            </li>
            <li className="text-[11px] text-muted-foreground">
              รายที่ลูกค้าเงียบเกิน 24 ชม. จะถูกจดว่า &quot;ส่งไม่ได้&quot; แทนการฝืนส่ง
            </li>
            <li className="text-[11px] text-muted-foreground">
              ถ้ารอบเดียวส่งไม่หมด จะบอกจำนวนที่เหลือให้กดส่งต่อ
            </li>
          </ul>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              ยังไม่ส่ง
            </Button>
            <Button onClick={() => void run()} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              ยืนยัน ส่งเลย
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ================================================================== */
/* การจับคู่คอลัมน์                                                    */
/* ================================================================== */

const FIELD_LABEL: Array<{ key: string; label: string; required?: boolean }> = [
  { key: 'tracking_no', label: 'เลขพัสดุ', required: true },
  { key: 'order_ref', label: 'เลขออเดอร์' },
  { key: 'phone', label: 'เบอร์ผู้รับ' },
  { key: 'recipient_name', label: 'ชื่อผู้รับ' },
  { key: 'postcode', label: 'รหัสไปรษณีย์' },
  { key: 'carrier', label: 'ขนส่ง' },
];

/**
 * โชว์ว่าระบบเดาคอลัมน์ไว้ยังไง และให้แก้ได้
 *
 * 🔴 ทำไมต้องมี : ระบบเดาผิดได้ (ไฟล์บางเจ้ามีทั้ง "เบอร์ผู้ส่ง" และ "เบอร์ผู้รับ")
 *    ถ้าเดาผิดแล้วแก้ไม่ได้ เจ้าของร้านจะติดตาย เพราะลายนิ้วมือไฟล์
 *    กันการอัปโหลดไฟล์เดิมซ้ำไว้อยู่แล้ว
 */
function MappingCard({
  importId,
  view,
  onChanged,
}: {
  importId: string;
  view: ImportView;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(
    () => ({ ...(view.column_mapping as Record<string, string>) }),
  );

  const headers = Array.isArray(view.headers) ? view.headers : [];

  async function save() {
    setBusy(true);
    try {
      const d = await api<{ summary: { auto: number; ambiguous: number; unmatched: number } }>(
        `/api/tracking/imports/${importId}/mapping`,
        { method: 'PATCH', body: JSON.stringify(draft) },
      );
      if (d) {
        toast.success(
          `แกะไฟล์ใหม่แล้ว — จับคู่ได้ ${d.summary.auto} · ต้องเลือก ${d.summary.ambiguous} · ไม่เจอ ${d.summary.unmatched}`,
        );
        setOpen(false);
        await onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ระบบอ่านคอลัมน์แบบนี้</CardTitle>
        <CardDescription>
          ถ้าเดาผิด (เช่นไปเอา &quot;เบอร์ผู้ส่ง&quot; แทน &quot;เบอร์ผู้รับ&quot;) กดแก้ได้เลย
          ไม่ต้องอัปโหลดไฟล์ใหม่
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {FIELD_LABEL.map((f) => {
            const col = (view.column_mapping as Record<string, string>)[f.key];
            return (
              <span key={f.key} className={cn(!col && f.required && 'text-destructive')}>
                {f.label}: <strong>{col ?? '— ไม่ได้ใช้ —'}</strong>
              </span>
            );
          })}
        </div>
        <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
          แก้การจับคู่คอลัมน์
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เลือกว่าคอลัมน์ไหนคืออะไร</DialogTitle>
            <DialogDescription>
              บันทึกแล้วระบบจะแกะไฟล์เดิมใหม่ทั้งรอบ และจับคู่ออเดอร์ให้ใหม่
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 py-2">
            {FIELD_LABEL.map((f) => (
              <div key={f.key} className="flex items-center gap-2">
                <Label className="w-28 shrink-0 text-xs">
                  {f.label}
                  {f.required && <span className="text-destructive"> *</span>}
                </Label>
                <select
                  className="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
                >
                  <option value="">— ไม่ใช้ —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              บันทึกแล้วแกะใหม่
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
