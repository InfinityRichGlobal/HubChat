'use client';

/**
 * หน้ากฎตอบอัตโนมัติ (ฝั่งหน้าเว็บ) — สเปกหัวข้อ 5.5
 * ===========================================================================
 * 🔴 หน้านี้คือที่เดียวที่คุม "ระบบพิมพ์หาลูกค้าเอง"
 *    จึงออกแบบให้เห็นสามอย่างพร้อมกันเสมอ :
 *      1. กฎมีอะไรบ้าง และเปิดอยู่กี่ข้อ
 *      2. ลำดับการตรวจ (เลขน้อยตรวจก่อน) — เพราะกฎที่ตรงหลายข้อจะได้ข้อเดียว
 *      3. ประวัติว่าบอทตอบอะไรไปแล้วบ้าง รวมถึงตอนที่ระบบ "ไม่ยอมส่ง"
 *
 * ⚠️ การตรวจความถูกต้องที่นี่เป็นแค่ตัวช่วยผู้ใช้ ตัวจริงอยู่ฝั่งเซิร์ฟเวอร์
 */

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Bot, Loader2, Plus, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { KeywordRule, AutoReplyLog } from '@/server/autoreply/service';
import type { MatchType } from '@/types/db';

type PageInfo = { id: string; display_name: string | null; page_name: string; tag_color: string };

const MATCH_LABEL: Record<MatchType, string> = {
  contains: 'มีคำนี้อยู่ในข้อความ',
  exact: 'ตรงทั้งข้อความเป๊ะ',
  starts_with: 'ขึ้นต้นด้วยคำนี้',
};

const STATUS_LABEL: Record<string, string> = {
  sent: 'ส่งแล้ว',
  blocked: 'ระบบไม่ให้ส่ง',
  failed: 'ส่งไม่สำเร็จ',
  unknown: 'ไม่ทราบผล',
  claimed: 'กำลังทำ',
  no_match: 'ไม่มีกฎตรง',
};

function statusTone(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'sent') return 'default';
  if (status === 'failed' || status === 'unknown') return 'destructive';
  return 'secondary';
}

/* ================================================================== */

export default function AutoReplyClient({
  canManage,
  initialRules,
  initialLogs,
  pages,
}: {
  canManage: boolean;
  initialRules: KeywordRule[];
  initialLogs: AutoReplyLog[];
  pages: PageInfo[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rules, setRules] = useState(initialRules);
  const [editing, setEditing] = useState<KeywordRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/autoreply', { cache: 'no-store' });
      const json = await res.json();
      if (json.ok) setRules(json.data.rules as KeywordRule[]);
    } catch {
      /* ปล่อยให้ค่าเดิมค้างไว้ ดีกว่าล้างจอ */
    }
    startTransition(() => router.refresh());
  }, [router]);

  async function call(url: string, init: RequestInit, successMsg: string) {
    setBusy(url);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message_th ?? 'ทำรายการไม่สำเร็จ');
        return false;
      }
      toast.success(successMsg);
      await reload();
      return true;
    } catch (err) {
      console.error('[autoreply] เรียก API ไม่สำเร็จ:', err);
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const activeCount = rules.filter((r) => r.is_active).length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">ตอบอัตโนมัติด้วยคีย์เวิร์ด</h1>
          <p className="text-sm text-muted-foreground">
            เปิดอยู่ {activeCount} จาก {rules.length} กฎ
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            เพิ่มกฎ
          </Button>
        )}
      </div>

      {/* ---------- คำเตือนที่ต้องอ่านก่อนเปิดใช้ ---------- */}
      <Alert variant="warning">
        <ShieldAlert className="size-4" />
        <AlertTitle className="text-sm">นี่คือส่วนเดียวที่ระบบพิมพ์หาลูกค้าเอง</AlertTitle>
        <AlertDescription className="text-xs">
          ระบบจะตอบก็ต่อเมื่อยังอยู่ในกรอบ 24 ชั่วโมงเท่านั้น — พ้นกรอบแล้วจะไม่ส่ง
          และจะไม่ใช้สิทธิ์ HUMAN_AGENT เด็ดขาด เพราะกฎ Meta อนุญาตเฉพาะข้อความที่คนพิมพ์เอง
          ถ้าตั้งคำที่กว้างเกินไป (เช่น &quot;ค่ะ&quot;) ลูกค้าจะโดนตอบทุกครั้งที่ทักมา
          ซึ่งเข้าข่ายสแปมและทำให้เพจโดนระงับได้
        </AlertDescription>
      </Alert>

      {/* ---------- ลิสต์กฎ ---------- */}
      {rules.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border py-12 text-center">
          <Bot className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">ยังไม่มีกฎ</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            เริ่มจากกฎเดียวที่คำเฉพาะเจาะจง เช่น &quot;เก็บเงินปลายทาง&quot; แล้วค่อยเพิ่มทีหลัง
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((r) => (
            <div key={r.id} className="flex items-start gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{r.name || '(ไม่มีชื่อกฎ)'}</span>
                  <Badge variant={r.is_active ? 'default' : 'secondary'} className="text-[10px]">
                    {r.is_active ? 'เปิด' : 'ปิด'}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">ลำดับ {r.priority}</Badge>
                  {r.hit_count > 0 && (
                    <span className="text-[11px] text-muted-foreground">ตอบไปแล้ว {r.hit_count} ครั้ง</span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap gap-1">
                  {r.keywords.slice(0, 8).map((k) => (
                    <span key={k} className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">{k}</span>
                  ))}
                  {r.keywords.length > 8 && (
                    <span className="text-[11px] text-muted-foreground">+{r.keywords.length - 8}</span>
                  )}
                </div>

                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.reply_text}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {MATCH_LABEL[r.match_type]}
                  {r.page_ids.length > 0 ? ` · เฉพาะ ${r.page_ids.length} เพจ` : ' · ทุกเพจ'}
                </p>
              </div>

              {canManage && (
                <div className="flex shrink-0 flex-col gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setEditing(r)}>แก้ไข</Button>
                  <Button
                    size="sm"
                    variant={r.is_active ? 'secondary' : 'default'}
                    disabled={busy !== null}
                    onClick={() =>
                      void call(
                        `/api/autoreply/${r.id}`,
                        { method: 'PATCH', body: JSON.stringify({ is_active: !r.is_active }) },
                        r.is_active ? 'ปิดกฎแล้ว' : 'เปิดกฎแล้ว',
                      )
                    }
                  >
                    {r.is_active ? 'ปิด' : 'เปิด'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => {
                      if (!confirm(`เก็บกฎ "${r.name || 'ไม่มีชื่อ'}" เข้ากรุ?\n\nกฎจะหยุดทำงานทันที แต่ประวัติการตอบยังอยู่ครบ`)) return;
                      void call(
                        `/api/autoreply/${r.id}`,
                        { method: 'PATCH', body: JSON.stringify({ archive: true }) },
                        'เก็บเข้ากรุแล้ว',
                      );
                    }}
                  >
                    <Archive />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ---------- ประวัติการทำงานจริง ---------- */}
      {initialLogs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h2 className="text-sm font-medium">ประวัติการตอบล่าสุด</h2>
          <p className="text-xs text-muted-foreground">
            รวมครั้งที่ระบบ &quot;ไม่ยอมส่ง&quot; ด้วย — จะได้รู้ว่ากฎไม่ทำงานเพราะอะไร
          </p>
          <div className="flex flex-col divide-y rounded-lg border">
            {initialLogs.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge variant={statusTone(l.status)} className="text-[10px]">
                      {STATUS_LABEL[l.status] ?? l.status}
                    </Badge>
                    {l.matched_keyword && (
                      <span className="truncate text-xs">ตรงคำว่า &quot;{l.matched_keyword}&quot;</span>
                    )}
                  </div>
                  {l.policy_reason_th && l.status !== 'sent' && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{l.policy_reason_th}</p>
                  )}
                  {l.error_text && (
                    <p className="mt-0.5 text-[11px] text-destructive">{l.error_text}</p>
                  )}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {new Date(l.created_at).toLocaleString('th-TH', { hour12: false })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- ฟอร์ม ---------- */}
      <RuleDialog
        key={editing?.id ?? (creating ? 'new' : 'closed')}
        open={creating || editing !== null}
        rule={editing}
        pages={pages}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={reload}
      />
    </div>
  );
}

/* ================================================================== */

function RuleDialog({
  open,
  rule,
  pages,
  onClose,
  onSaved,
}: {
  open: boolean;
  rule: KeywordRule | null;
  pages: PageInfo[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(rule?.name ?? '');
  const [keywords, setKeywords] = useState((rule?.keywords ?? []).join(', '));
  const [replyText, setReplyText] = useState(rule?.reply_text ?? '');
  const [matchType, setMatchType] = useState<MatchType>(rule?.match_type ?? 'contains');
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const [pageIds, setPageIds] = useState<string[]>(rule?.page_ids ?? []);
  const [saving, setSaving] = useState(false);

  const parsedKeywords = keywords
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  // ⚠️ ตรวจฝั่งหน้าเว็บเพื่อช่วยผู้ใช้เท่านั้น เซิร์ฟเวอร์ตรวจซ้ำอยู่แล้ว
  const problem =
    parsedKeywords.length === 0
      ? 'ต้องมีคีย์เวิร์ดอย่างน้อย 1 คำ'
      : replyText.trim().length === 0
        ? 'ต้องมีข้อความตอบกลับ'
        : replyText.trim().length > 1800
          ? 'ข้อความตอบกลับยาวเกิน 1800 ตัวอักษร'
          : null;

  // เตือนคำที่กว้างเกินไป — ไม่บล็อก แต่ต้องให้เห็น
  const risky = parsedKeywords.filter((k) => k.length <= 2);

  async function submit() {
    if (problem || saving) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim() || null,
        keywords: parsedKeywords,
        reply_text: replyText.trim(),
        match_type: matchType,
        priority: Number(priority) || 100,
        page_ids: pageIds,
      };
      const res = await fetch(rule ? `/api/autoreply/${rule.id}` : '/api/autoreply', {
        method: rule ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message_th ?? 'บันทึกไม่สำเร็จ');
        return;
      }
      toast.success(rule ? 'แก้ไขกฎแล้ว' : 'เพิ่มกฎแล้ว');
      await onSaved();
      onClose();
    } catch (err) {
      console.error('[autoreply] บันทึกไม่สำเร็จ:', err);
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? 'แก้ไขกฎ' : 'เพิ่มกฎตอบอัตโนมัติ'}</DialogTitle>
          <DialogDescription>
            ลูกค้าพิมพ์คำที่ตรง → ระบบตอบข้อความนี้ให้ทันที
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="r-name" className="text-xs">ชื่อกฎ (ไว้ให้แอดมินจำ)</Label>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ถามเรื่องเก็บเงินปลายทาง" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="r-kw" className="text-xs">คีย์เวิร์ด (คั่นด้วยจุลภาค)</Label>
            <Input
              id="r-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)}
              placeholder="เก็บเงินปลายทาง, ปลายทาง, cod"
            />
            <p className="text-[11px] text-muted-foreground">{parsedKeywords.length} คำ</p>
            {risky.length > 0 && (
              <p className="text-[11px] text-destructive">
                ⚠️ &quot;{risky.join('", "')}&quot; สั้นมาก อาจตรงกับข้อความทั่วไปจนตอบรัว — ควรใช้คำที่เจาะจงกว่านี้
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label className="text-xs">วิธีเทียบ</Label>
              <Select value={matchType} onValueChange={(v) => setMatchType(v as MatchType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(MATCH_LABEL) as MatchType[]).map((t) => (
                    <SelectItem key={t} value={t}>{MATCH_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-28 flex-col gap-1.5">
              <Label htmlFor="r-pri" className="text-xs">ลำดับ</Label>
              <Input
                id="r-pri" inputMode="numeric" value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
          </div>
          <p className="-mt-1 text-[11px] text-muted-foreground">
            เลขน้อยตรวจก่อน — ถ้าลูกค้าพิมพ์คำที่ตรงหลายกฎ ระบบจะตอบกฎเดียวที่เลขน้อยที่สุด
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="r-reply" className="text-xs">ข้อความตอบกลับ</Label>
            <textarea
              id="r-reply" rows={4} value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder="มีเก็บเงินปลายทางค่ะ ค่าส่ง 40 บาท ส่งของทุกวันจันทร์-เสาร์นะคะ"
            />
            <p className="text-[11px] text-muted-foreground">{replyText.trim().length}/1800</p>
          </div>

          {pages.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">ใช้กับเพจ</Label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setPageIds([])}
                  className={
                    'rounded-full border px-3 py-1 text-xs ' +
                    (pageIds.length === 0 ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent')
                  }
                >
                  ทุกเพจ
                </button>
                {pages.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setPageIds((prev) =>
                        prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                      )
                    }
                    className={
                      'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ' +
                      (pageIds.includes(p.id) ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent')
                    }
                  >
                    <span className="size-2 rounded-full" style={{ backgroundColor: p.tag_color }} />
                    {p.display_name || p.page_name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button onClick={() => void submit()} disabled={problem !== null || saving}>
            {saving && <Loader2 className="animate-spin" />}
            {problem ?? 'บันทึก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
