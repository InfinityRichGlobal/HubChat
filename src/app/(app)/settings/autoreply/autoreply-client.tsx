'use client';

/**
 * หน้าแชทบอทตอบอัตโนมัติ (บอทแชท & บอทคอมเมนต์) — สเปกหัวข้อ 5.5
 * ===========================================================================
 * แท็บ 1: 💬 บอทแชท — กฎตอบแชทตามคีย์เวิร์ด (Messenger / Instagram Direct)
 * แท็บ 2: 📝 บอทคอมเมนต์ — ไลฟ์คอมเมนต์ ตอบใต้โพสต์ ดึงเข้าแชทส่วนตัว พร้อมตัวกรองคำ
 */

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive,
  Bot,
  CornerDownRight,
  Edit2,
  Filter,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Plus,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import SettingsBackButton from '@/components/settings-back-button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { KeywordRule, AutoReplyLog } from '@/server/autoreply/service';
import type { MatchType } from '@/types/db';
import {
  DEFAULT_COMMENT_BOT_SETTINGS,
  type CommentBotSettings,
  type CommentBotRule,
} from '@/types/comment-bot';

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
  initialCommentBotSettings,
  pages,
}: {
  canManage: boolean;
  initialRules: KeywordRule[];
  initialLogs: AutoReplyLog[];
  initialCommentBotSettings?: CommentBotSettings;
  pages: PageInfo[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // แท็บหลัก: 'chat' (บอทแชท) หรือ 'comments' (บอทคอมเมนต์)
  const [activeTab, setActiveTab] = useState<'chat' | 'comments'>('chat');

  // ---------- ข้อมูลบอทแชท ----------
  const [rules, setRules] = useState(initialRules);
  const [editing, setEditing] = useState<KeywordRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // ---------- ข้อมูลบอทคอมเมนต์ ----------
  const [botSettings, setBotSettings] = useState<CommentBotSettings>(
    initialCommentBotSettings ?? DEFAULT_COMMENT_BOT_SETTINGS,
  );
  const [savingBot, setSavingBot] = useState(false);
  const [subscribingWebhook, setSubscribingWebhook] = useState(false);
  const [newKeywordInput, setNewKeywordInput] = useState('');
  const [commentRuleEditing, setCommentRuleEditing] = useState<CommentBotRule | null>(null);
  const [commentRuleCreating, setCommentRuleCreating] = useState(false);

  const reloadRules = useCallback(async () => {
    try {
      const res = await fetch('/api/autoreply', { cache: 'no-store' });
      const json = await res.json();
      if (json.ok) setRules(json.data.rules as KeywordRule[]);
    } catch {
      /* ปล่อยให้ค่าเดิมค้างไว้ */
    }
    startTransition(() => router.refresh());
  }, [router]);

  async function callChatApi(url: string, init: RequestInit, successMsg: string) {
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
      await reloadRules();
      return true;
    } catch (err) {
      console.error('[autoreply] เรียก API ไม่สำเร็จ:', err);
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(null);
    }
  }

  // เชื่อมต่อ Webhook สำหรับคอมเมนต์ (ฟิลด์ feed) ของทุกเพจ Facebook
  async function handleSubscribeWebhook() {
    setSubscribingWebhook(true);
    try {
      const res = await fetch('/api/comments/webhook/subscribe', {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message_th ?? 'เชื่อมต่อ Webhook ไม่สำเร็จ');
        return;
      }
      toast.success(json.data?.message_th ?? 'เชื่อมต่อ Webhook คอมเมนต์สำเร็จแล้ว');
    } catch (err) {
      console.error('[autoreply] เชื่อมต่อ Webhook ไม่สำเร็จ:', err);
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setSubscribingWebhook(false);
    }
  }

  // บันทึกการตั้งค่าบอทคอมเมนต์
  async function handleSaveCommentBot() {
    setSavingBot(true);
    try {
      const res = await fetch('/api/comments/bot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(botSettings),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message_th ?? 'บันทึกการตั้งค่าไม่สำเร็จ');
        return;
      }
      setBotSettings(json.data as CommentBotSettings);
      toast.success('บันทึกการตั้งค่าบอทคอมเมนต์เรียบร้อยแล้ว');
      startTransition(() => router.refresh());
    } catch (err) {
      console.error('[autoreply] บันทึกบอทคอมเมนต์ไม่สำเร็จ:', err);
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setSavingBot(false);
    }
  }

  function handleAddFilterKeyword() {
    const kw = newKeywordInput.trim();
    if (!kw) return;
    if (botSettings.filter_keywords.includes(kw)) {
      toast.info('มีคำนี้อยู่ในรายการแล้ว');
      setNewKeywordInput('');
      return;
    }
    setBotSettings((prev) => ({
      ...prev,
      filter_keywords: [...prev.filter_keywords, kw],
    }));
    setNewKeywordInput('');
  }

  function handleRemoveFilterKeyword(kw: string) {
    setBotSettings((prev) => ({
      ...prev,
      filter_keywords: prev.filter_keywords.filter((k) => k !== kw),
    }));
  }

  function handleSaveCommentRule(rule: CommentBotRule) {
    setBotSettings((prev) => {
      const existingIndex = prev.rules.findIndex((r) => r.id === rule.id);
      if (existingIndex >= 0) {
        const nextRules = [...prev.rules];
        nextRules[existingIndex] = rule;
        return { ...prev, rules: nextRules };
      }
      return { ...prev, rules: [...prev.rules, rule] };
    });
    setCommentRuleEditing(null);
    setCommentRuleCreating(false);
    toast.success('อัปเดตกฎแล้ว (อย่าลืมกดบันทึกเพื่อใช้งานจริง)');
  }

  function handleDeleteCommentRule(ruleId?: string) {
    if (!ruleId) return;
    setBotSettings((prev) => ({
      ...prev,
      rules: prev.rules.filter((r) => r.id !== ruleId),
    }));
    toast.success('ลบกฎแล้ว (อย่าลืมกดบันทึก)');
  }

  function handleToggleCommentRule(ruleId?: string) {
    if (!ruleId) return;
    setBotSettings((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === ruleId ? { ...r, is_active: !r.is_active } : r)),
    }));
  }

  const activeCount = rules.filter((r) => r.is_active).length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <SettingsBackButton title="แชทบอท (ตอบอัตโนมัติ)" />

      {/* ---------- หัวหน้าจอหลัก ---------- */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight">แชทบอท (ตอบอัตโนมัติ)</h1>
        <p className="text-xs text-muted-foreground">
          ตั้ง keyword ให้บอทตอบลูกค้าเองด้วยข้อความ รูป การ์ดสินค้า หรือปุ่ม
        </p>
      </div>

      {/* ---------- แถบแท็บ: บอทแชท | บอทคอมเมนต์ ---------- */}
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab('chat')}
          className={cn(
            'flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2',
            activeTab === 'chat'
              ? 'border-orange-500 text-orange-600 dark:border-orange-400 dark:text-orange-400 font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <MessageSquare className="size-4" />
          บอทแชท
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('comments')}
          className={cn(
            'flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2',
            activeTab === 'comments'
              ? 'border-orange-500 text-orange-600 dark:border-orange-400 dark:text-orange-400 font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <span className="text-base">📝</span>
          บอทคอมเมนต์
        </button>
      </div>

      {/* ================================================================== */}
      {/* 💬 แท็บที่ 1: บอทแชท (ตอบอัตโนมัติในแชท)                                 */}
      {/* ================================================================== */}
      {activeTab === 'chat' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">ตอบอัตโนมัติด้วยคีย์เวิร์ด</h2>
              <p className="text-xs text-muted-foreground">
                เปิดอยู่ {activeCount} จาก {rules.length} กฎ
              </p>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                เพิ่มกฎ
              </Button>
            )}
          </div>

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

          {/* ลิสต์กฎบอทแชท */}
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
                    </p>
                  </div>

                  {canManage && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() =>
                          void callChatApi(
                            `/api/autoreply/${r.id}`,
                            { method: 'PATCH', body: JSON.stringify({ is_active: !r.is_active }) },
                            r.is_active ? 'ปิดกฎแล้ว' : 'เปิดกฎแล้ว',
                          )
                        }
                      >
                        {r.is_active ? 'ปิด' : 'เปิด'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => setEditing(r)}
                      >
                        แก้ไข
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10"
                        disabled={busy !== null}
                        onClick={() => {
                          if (confirm(`ต้องการลบกฎ "${r.name || r.keywords[0]}" ใช่ไหม?`)) {
                            void callChatApi(`/api/autoreply/${r.id}`, { method: 'DELETE' }, 'ลบกฎแล้ว');
                          }
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ประวัติการทำงาน */}
          {initialLogs.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Archive className="size-3.5" />
                ประวัติการตอบล่าสุด ({initialLogs.length} รายการ)
              </div>
              <div className="divide-y rounded-lg border text-xs">
                {initialLogs.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 p-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Badge variant={statusTone(l.status)} className="text-[9px]">
                          {STATUS_LABEL[l.status] ?? l.status}
                        </Badge>
                        <span className="truncate font-medium">{l.matched_keyword ? `คำว่า "${l.matched_keyword}"` : '(ไม่มีคีย์เวิร์ด)'}</span>
                      </div>
                      {(l.policy_reason_th || l.error_text) && (
                        <p className="mt-0.5 text-[11px] text-destructive">{l.policy_reason_th || l.error_text}</p>
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
        </div>
      )}

      {/* ================================================================== */}
      {/* 📝 แท็บที่ 2: บอทคอมเมนต์ (ตอบคอมเมนต์อัตโนมัติ)                       */}
      {/* ================================================================== */}
      {activeTab === 'comments' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs">
            {/* หัวการ์ด */}
            <div className="flex items-start gap-2.5">
              <span className="text-xl">💬</span>
              <div>
                <h2 className="text-base font-semibold text-foreground">คอมเมนต์อัตโนมัติ</h2>
                <p className="text-xs text-muted-foreground">
                  ดึงคอมเมนต์ใต้โพสต์เพจ (Facebook + Instagram) เข้ากล่องแชท พร้อมกดไลก์และตอบให้อัตโนมัติ
                </p>
              </div>
            </div>

            {/* ปุ่มเชื่อมต่อ Webhook สำหรับคอมเมนต์เพจใหม่ */}
            <div className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleSubscribeWebhook()}
                disabled={subscribingWebhook || !canManage}
                className="h-9 gap-1.5 rounded-lg border-orange-400 font-medium text-orange-600 hover:bg-orange-50 dark:border-orange-500/50 dark:text-orange-400 dark:hover:bg-orange-950/30 text-xs"
              >
                {subscribingWebhook ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <span>🔗</span>
                )}
                เชื่อม webhook คอมเมนต์เพจใหม่
              </Button>
            </div>

            {/* กลุ่มสวิตช์ควบคุม */}
            <div className="mt-3 flex flex-col divide-y divide-border">
              {/* 1. กดไลก์อัตโนมัติ */}
              <div className="flex items-center justify-between py-3.5">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span>👍</span> กดไลก์อัตโนมัติ
                </div>
                <Switch
                  checked={botSettings.auto_like}
                  onCheckedChange={(checked) =>
                    setBotSettings((prev) => ({ ...prev, auto_like: checked }))
                  }
                  disabled={!canManage}
                />
              </div>

              {/* 2. ตอบคอมเมนต์อัตโนมัติ */}
              <div className="flex flex-col gap-2.5 py-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>↩️</span> ตอบคอมเมนต์อัตโนมัติ
                  </div>
                  <Switch
                    checked={botSettings.auto_reply_public}
                    onCheckedChange={(checked) =>
                      setBotSettings((prev) => ({ ...prev, auto_reply_public: checked }))
                    }
                    disabled={!canManage}
                  />
                </div>
                {botSettings.auto_reply_public && (
                  <Textarea
                    value={botSettings.public_reply_template}
                    onChange={(e) =>
                      setBotSettings((prev) => ({ ...prev, public_reply_template: e.target.value }))
                    }
                    placeholder="ข้อความตอบคอมเมนต์ (สาธารณะ) — ใช้ {name} แทนชื่อผู้คอมเมนต์ได้ · ถ้ามีกติกา keyword ตรงกัน จะใช้ข้อความจากกติกาแทน"
                    className="min-h-[76px] resize-none text-xs leading-relaxed"
                    disabled={!canManage}
                  />
                )}
              </div>

              {/* 3. ดึงเข้าแชท (ตอบเข้าแชทส่วนตัว) */}
              <div className="flex flex-col gap-2.5 py-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>💌</span> ดึงเข้าแชท (ตอบเข้าแชทส่วนตัว)
                  </div>
                  <Switch
                    checked={botSettings.auto_reply_private}
                    onCheckedChange={(checked) =>
                      setBotSettings((prev) => ({ ...prev, auto_reply_private: checked }))
                    }
                    disabled={!canManage}
                  />
                </div>
                {botSettings.auto_reply_private && (
                  <Textarea
                    value={botSettings.private_reply_template}
                    onChange={(e) =>
                      setBotSettings((prev) => ({ ...prev, private_reply_template: e.target.value }))
                    }
                    placeholder="ข้อความส่งเข้าแชทส่วนตัว (ว่าง = ใช้ข้อความตอบคอมเมนต์)"
                    className="min-h-[76px] resize-none text-xs leading-relaxed"
                    disabled={!canManage}
                  />
                )}
              </div>
            </div>

            {/* กล่องประ: ส่งเมนูสินค้า+โปรฯ หลังดึงเข้าแชท */}
            <div className="mt-4 rounded-xl border border-dashed border-orange-300 bg-orange-50/40 p-4 dark:border-orange-800/60 dark:bg-orange-950/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span>🛍️</span> ส่งเมนูสินค้า+โปรฯ หลังดึงเข้าแชท
                </div>
                <Switch
                  checked={botSettings.auto_send_catalog}
                  onCheckedChange={(checked) =>
                    setBotSettings((prev) => ({ ...prev, auto_send_catalog: checked }))
                  }
                  disabled={!canManage}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                หลังส่งข้อความเข้าแชทส่วนตัวแล้ว บอทจะส่งข้อความต้อนรับ + เมนูสินค้า/โปรโมชั่นให้ลูกค้าทันที
              </p>
            </div>

            {/* ---------- ระบบคัดกรองคำ (Keyword Filter) ---------- */}
            <div className="mt-5 rounded-xl border p-4 bg-muted/20">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Filter className="size-4 text-orange-500" />
                เงื่อนไขการตรวจจับคำ (คัดกรองคอมเมนต์)
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                เลือกว่าจะให้บอทตอบทุกคอมเมนต์ หรือตรวจเฉพาะคอมเมนต์ที่มีคีย์เวิร์ดที่กำหนด
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={botSettings.filter_mode === 'all' ? 'default' : 'outline'}
                  onClick={() => setBotSettings((prev) => ({ ...prev, filter_mode: 'all' }))}
                  className={cn(
                    'text-xs h-8',
                    botSettings.filter_mode === 'all' && 'bg-orange-600 hover:bg-orange-700 text-white',
                  )}
                  disabled={!canManage}
                >
                  ตอบทุกคอมเมนต์ (ไม่ฟิลเตอร์คำ)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={botSettings.filter_mode === 'keyword_only' ? 'default' : 'outline'}
                  onClick={() =>
                    setBotSettings((prev) => ({ ...prev, filter_mode: 'keyword_only' }))
                  }
                  className={cn(
                    'text-xs h-8',
                    botSettings.filter_mode === 'keyword_only' &&
                      'bg-orange-600 hover:bg-orange-700 text-white',
                  )}
                  disabled={!canManage}
                >
                  กรองเฉพาะคำที่กำหนด (ตรวจคีย์เวิร์ด)
                </Button>
              </div>

              {/* แสดงคำกรองเมื่อเลือก keyword_only */}
              {botSettings.filter_mode === 'keyword_only' && (
                <div className="mt-4 flex flex-col gap-2.5">
                  <Label className="text-xs font-medium">คำคีย์เวิร์ดทั่วไปที่ให้บอทตอบ :</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {botSettings.filter_keywords.map((kw) => (
                      <Badge
                        key={kw}
                        variant="secondary"
                        className="gap-1 px-2.5 py-1 text-xs font-normal"
                      >
                        {kw}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => handleRemoveFilterKeyword(kw)}
                            className="ml-1 rounded hover:bg-destructive/20 hover:text-destructive"
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </Badge>
                    ))}
                    {botSettings.filter_keywords.length === 0 && (
                      <span className="text-xs text-muted-foreground">ยังไม่มีคำคีย์เวิร์ด</span>
                    )}
                  </div>

                  {canManage && (
                    <div className="mt-1 flex max-w-sm items-center gap-2">
                      <Input
                        value={newKeywordInput}
                        onChange={(e) => setNewKeywordInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddFilterKeyword();
                          }
                        }}
                        placeholder="พิมพ์คำ เช่น สนใจ, ราคา, สั่งซื้อ แล้วกดเพิ่ม"
                        className="h-8 text-xs"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleAddFilterKeyword}
                        className="h-8 text-xs shrink-0"
                      >
                        <Plus className="size-3.5 mr-1" />
                        เพิ่ม
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* ---------- กฎพิเศษแยกรายคำ (Custom Rules per Keyword) ---------- */}
              <div className="mt-5 border-t pt-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">
                      กฎพิเศษแยกตามคำ (ตรวจคำไหน แล้วทำอะไรกับคำนั้นๆ)
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      ถ้ามีคำที่ตรงกับกฎพิเศษนี้ บอทจะใช้ข้อความเฉพาะของกฎนี้ตอบแทนข้อความกลาง
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCommentRuleEditing(null);
                        setCommentRuleCreating(true);
                      }}
                      className="h-7 text-xs gap-1"
                    >
                      <Plus className="size-3" />
                      เพิ่มกฎเฉพาะคำ
                    </Button>
                  )}
                </div>

                {botSettings.rules.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground text-center py-4 border rounded-lg border-dashed">
                    ยังไม่มีกฎเฉพาะคำ (ระบบจะใช้ข้อความกลางด้านบนตอบ)
                  </p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {botSettings.rules.map((r, idx) => (
                      <div
                        key={r.id || idx}
                        className="flex items-start justify-between gap-2 rounded-lg border p-2.5 bg-background text-xs"
                      >
                        <div className="min-w-0 flex-1 flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground bg-secondary px-2 py-0.5 rounded">
                              {r.keyword}
                            </span>
                            <Badge variant={r.is_active ? 'default' : 'secondary'} className="text-[9px]">
                              {r.is_active ? 'เปิด' : 'ปิด'}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">
                              ({MATCH_LABEL[r.match_type]})
                            </span>
                          </div>
                          {r.public_reply && (
                            <p className="line-clamp-1 text-muted-foreground">
                              ↩️ ตอบใต้โพสต์: {r.public_reply}
                            </p>
                          )}
                          {r.private_reply && (
                            <p className="line-clamp-1 text-muted-foreground">
                              💌 ทักส่วนตัว: {r.private_reply}
                            </p>
                          )}
                        </div>

                        {canManage && (
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => handleToggleCommentRule(r.id)}
                            >
                              {r.is_active ? 'ปิด' : 'เปิด'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                setCommentRuleEditing(r);
                                setCommentRuleCreating(false);
                              }}
                            >
                              <Edit2 className="size-3" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-destructive hover:bg-destructive/10"
                              onClick={() => handleDeleteCommentRule(r.id)}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ปุ่มบันทึกการตั้งค่าบอทคอมเมนต์ */}
            <div className="mt-5">
              <Button
                type="button"
                onClick={() => void handleSaveCommentBot()}
                disabled={savingBot || !canManage}
                className="w-28 bg-orange-600 font-semibold text-white hover:bg-orange-700"
              >
                {savingBot ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
                บันทึก
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- ฟอร์มสร้าง/แก้ไขกฎบอทแชท ---------- */}
      <RuleDialog
        key={editing?.id ?? (creating ? 'new' : 'closed')}
        open={creating || editing !== null}
        rule={editing}
        pages={pages}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={reloadRules}
      />

      {/* ---------- ฟอร์มสร้าง/แก้ไขกฎบอทคอมเมนต์เฉพาะคำ ---------- */}
      <CommentRuleDialog
        key={commentRuleEditing?.id ?? (commentRuleCreating ? 'comment-new' : 'comment-closed')}
        open={commentRuleCreating || commentRuleEditing !== null}
        rule={commentRuleEditing}
        onClose={() => {
          setCommentRuleCreating(false);
          setCommentRuleEditing(null);
        }}
        onSave={handleSaveCommentRule}
      />
    </div>
  );
}

/* ================================================================== */
/* ฟอร์มสร้าง/แก้ไขกฎบอทแชท                                             */
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

  const problem =
    parsedKeywords.length === 0
      ? 'ต้องมีคีย์เวิร์ดอย่างน้อย 1 คำ'
      : replyText.trim().length === 0
        ? 'ต้องมีข้อความตอบกลับ'
        : replyText.trim().length > 1800
          ? 'ข้อความตอบกลับยาวเกิน 1800 ตัวอักษร'
          : null;

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
        priority: Math.max(1, Math.min(1000, Number(priority) || 100)),
        page_ids: pageIds,
      };
      const res = await fetch(rule ? `/api/autoreply/${rule.id}` : '/api/autoreply', {
        method: rule ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json?.error?.message_th ?? 'บันทึกกฎไม่สำเร็จ');
        return;
      }
      toast.success(rule ? 'แก้ไขกฎแล้ว' : 'เพิ่มกฎแล้ว');
      await onSaved();
      onClose();
    } catch {
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? 'แก้ไขกฎตอบแชท' : 'เพิ่มกฎตอบแชทใหม่'}</DialogTitle>
          <DialogDescription className="text-xs">
            เมื่อลูกค้าพิมพ์คำที่ตรงเงื่อนไข ระบบจะตอบข้อความนี้ทันที (ภายในกรอบ 24 ชม.)
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="r-name" className="text-xs">ชื่อกฎ (ไว้จำเอง)</Label>
            <Input
              id="r-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="เช่น เก็บเงินปลายทาง, เวลาเปิดร้าน"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="r-kw" className="text-xs">
              คีย์เวิร์ด <span className="text-muted-foreground">(คั่นด้วยจุลภาค ,)</span>
            </Label>
            <Input
              id="r-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)}
              placeholder="ปลายทาง, cod, เก็บเงินปลายทาง"
            />
          </div>

          {risky.length > 0 && (
            <Alert variant="warning">
              <ShieldAlert className="size-4" />
              <AlertTitle className="text-xs font-semibold">คำสั้นเกินไป เสี่ยงตอบผิดจังหวะ</AlertTitle>
              <AlertDescription className="text-[11px]">
                คำว่า &quot;{risky.join('", "')}&quot; สั้นมากและมักปนในบทสนทนาทั่วไป
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-3">
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

/* ================================================================== */
/* ฟอร์มสร้าง/แก้ไขกฎบอทคอมเมนต์เฉพาะคำ                                   */
/* ================================================================== */

function CommentRuleDialog({
  open,
  rule,
  onClose,
  onSave,
}: {
  open: boolean;
  rule: CommentBotRule | null;
  onClose: () => void;
  onSave: (rule: CommentBotRule) => void;
}) {
  const [keyword, setKeyword] = useState(rule?.keyword ?? '');
  const [matchType, setMatchType] = useState<'contains' | 'exact' | 'starts_with'>(
    rule?.match_type ?? 'contains',
  );
  const [publicReply, setPublicReply] = useState(rule?.public_reply ?? '');
  const [privateReply, setPrivateReply] = useState(rule?.private_reply ?? '');

  const problem =
    keyword.trim().length === 0
      ? 'ต้องระบุคำคีย์เวิร์ด'
      : publicReply.trim().length === 0 && privateReply.trim().length === 0
        ? 'ต้องมีข้อความตอบใต้โพสต์หรือข้อความทักส่วนตัวอย่างน้อย 1 อย่าง'
        : null;

  function handleFormSubmit() {
    if (problem) return;
    onSave({
      id: rule?.id || `crule_${Date.now()}`,
      keyword: keyword.trim(),
      match_type: matchType,
      public_reply: publicReply.trim() || null,
      private_reply: privateReply.trim() || null,
      is_active: rule?.is_active ?? true,
    });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{rule ? 'แก้ไขกฎเฉพาะคำ' : 'เพิ่มกฎเฉพาะคำใหม่'}</DialogTitle>
          <DialogDescription className="text-xs">
            ตรวจพบคำนี้ในคอมเมนต์ จะตอบข้อความเฉพาะของกฎนี้แทนข้อความกลาง
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cr-kw" className="text-xs">คำคีย์เวิร์ดที่ให้ตรวจ</Label>
            <Input
              id="cr-kw"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="เช่น ราคา, สนใจ, สั่งซื้อ"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">วิธีเทียบ</Label>
            <Select
              value={matchType}
              onValueChange={(v) => setMatchType(v as 'contains' | 'exact' | 'starts_with')}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">มีคำนี้อยู่ในข้อความ (แนะนำ)</SelectItem>
                <SelectItem value="exact">ตรงทั้งข้อความเป๊ะ</SelectItem>
                <SelectItem value="starts_with">ขึ้นต้นด้วยคำนี้</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cr-pub" className="text-xs">
              ข้อความตอบใต้โพสต์ (สาธารณะ) — ใช้ {'{name}'} แทนชื่อลูกค้าได้
            </Label>
            <Textarea
              id="cr-pub"
              value={publicReply}
              onChange={(e) => setPublicReply(e.target.value)}
              rows={2}
              placeholder="แจ้งรายละเอียดในแชทแล้วค่า {name} 🥰"
              className="text-xs resize-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cr-priv" className="text-xs">
              ข้อความส่งเข้าแชทส่วนตัว (DM) — ใช้ {'{name}'} แทนชื่อลูกค้าได้
            </Label>
            <Textarea
              id="cr-priv"
              value={privateReply}
              onChange={(e) => setPrivateReply(e.target.value)}
              rows={3}
              placeholder="สวัสดีค่ะคุณ {name} สินค้าราคา ... บาท โปรโมชั่นพิเศษวันนี้ส่งฟรีค่า"
              className="text-xs resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button onClick={handleFormSubmit} disabled={problem !== null}>
            {problem ?? 'ตกลง'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
