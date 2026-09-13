'use client';

/**
 * หน้าแชทบอทตอบอัตโนมัติ (บอทแชท & บอทคอมเมนต์) — สเปกหัวข้อ 5.5
 * ===========================================================================
 * แท็บ 1: 💬 บอทแชท — กฎตอบแชทตามคีย์เวิร์ด (Messenger / Instagram Direct)
 * แท็บ 2: 📝 บอทคอมเมนต์ — ไลฟ์คอมเมนต์ ตอบใต้โพสต์ ดึงเข้าแชทส่วนตัว พร้อมตัวกรองคำ
 */

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Archive,
  ArrowRight,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  CornerDownRight,
  Edit2,
  Filter,
  ImageIcon,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Send,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  type CommentBotTestResult,
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
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // แท็บหลัก: 'chat' (บอทแชท) หรือ 'comments' (บอทคอมเมนต์)
  const initialTab = searchParams.get('tab') === 'comments' ? 'comments' : 'chat';
  const [activeTab, setActiveTab] = useState<'chat' | 'comments'>(initialTab);

  // ข้อมูล AI สำหรับแสดงผลในหน้าบอทคอมเมนต์และบอทแชท
  const [aiInfo, setAiInfo] = useState<{
    hasApiKey: boolean;
    model: string;
    hasKnowledge: boolean;
    enableChatAssist: boolean;
  } | null>(null);

  // ---------- ผู้ช่วย AI ในห้องแชท (Chat AI Assistant) ----------
  const [chatAssistEnabled, setChatAssistEnabled] = useState(true);
  const [savingChatAssist, setSavingChatAssist] = useState(false);
  const [chatSimInput, setChatSimInput] = useState('สวัสดีค่ะ มีสินค้าพร้อมส่งไหมคะ มีโปรโมชั่นอะไรบ้าง');
  const [chatSimOutput, setChatSimOutput] = useState('');
  const [testingChatSim, setTestingChatSim] = useState(false);

  // ---------- ทดสอบบอทคอมเมนต์ (Simulator) ----------
  const [testCommentText, setTestCommentText] = useState('สนใจสั่งซื้อค่ะ ราคาเท่าไหร่คะ มีเก็บเงินปลายทางไหม');
  const [testCommenterName, setTestCommenterName] = useState('คุณลูกค้า');
  const [testingCommentBot, setTestingCommentBot] = useState(false);
  const [commentBotTestResult, setCommentBotTestResult] = useState<CommentBotTestResult | null>(null);

  useEffect(() => {
    fetch('/api/ai/settings', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (json.ok && json.data) {
          const isAssistOn = json.data.enableChatAssist ?? true;
          setAiInfo({
            hasApiKey: json.data.hasApiKey,
            model: json.data.model || 'gemini-3.6-flash',
            hasKnowledge: Boolean(json.data.knowledge?.trim()),
            enableChatAssist: isAssistOn,
          });
          setChatAssistEnabled(isAssistOn);
        }
      })
      .catch(() => {});
  }, []);

  async function handleToggleChatAssist(nextVal: boolean) {
    setChatAssistEnabled(nextVal);
    setSavingChatAssist(true);
    try {
      const res = await fetch('/api/ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enableChatAssist: nextVal }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(nextVal ? 'เปิดผู้ช่วย AI ในห้องแชทแล้ว' : 'ปิดผู้ช่วย AI ในห้องแชทแล้ว');
        setAiInfo((prev) => (prev ? { ...prev, enableChatAssist: nextVal } : null));
      } else {
        toast.error('บันทึกไม่สำเร็จ');
        setChatAssistEnabled(!nextVal);
      }
    } catch {
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
      setChatAssistEnabled(!nextVal);
    } finally {
      setSavingChatAssist(false);
    }
  }

  async function handleSimulateChatAssist() {
    if (!chatSimInput.trim()) {
      toast.error('กรุณาระบุข้อความจำลองของลูกค้า');
      return;
    }
    setTestingChatSim(true);
    setChatSimOutput('');
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'playground',
          userMessage: chatSimInput.trim(),
        }),
      });
      const json = await res.json();
      if (json.ok && json.data?.reply) {
        setChatSimOutput(json.data.reply);
      } else {
        toast.error(json?.error?.message_th || 'AI ไม่สามารถตอบได้');
      }
    } catch {
      toast.error('เกิดข้อผิดพลาดในการทดสอบ');
    } finally {
      setTestingChatSim(false);
    }
  }

  async function handleRunCommentBotTest() {
    if (!testCommentText.trim()) {
      toast.error('กรุณาระบุข้อความคอมเมนต์จำลอง');
      return;
    }
    setTestingCommentBot(true);
    setCommentBotTestResult(null);
    try {
      const res = await fetch('/api/comments/bot-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment_text: testCommentText.trim(),
          commenter_name: testCommenterName.trim() || undefined,
          settings: botSettings,
        }),
      });
      const json = await res.json();
      if (json.ok && json.data) {
        setCommentBotTestResult(json.data as CommentBotTestResult);
        toast.success('รันเทสบอทคอมเมนต์สำเร็จ');
      } else {
        toast.error(json?.error?.message_th || 'รันเทสไม่สำเร็จ');
      }
    } catch {
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setTestingCommentBot(false);
    }
  }

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
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [showManualUrlInput, setShowManualUrlInput] = useState(false);
  const [manualUrlText, setManualUrlText] = useState('');

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
          {/* 🧠 ผู้ช่วย AI ในห้องแชท (Chat AI Assistant) */}
          <Card className="border-blue-200/60 bg-blue-50/20 dark:border-blue-900/40 dark:bg-blue-950/10">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400">
                    <Brain className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      ผู้ช่วย AI ในห้องแชท (Inbox AI Assistant)
                      <Badge variant={chatAssistEnabled ? 'default' : 'secondary'} className="text-[10px]">
                        {chatAssistEnabled ? 'เปิดใช้งาน' : 'ปิดอยู่'}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      ให้ Google Gemini ช่วยแอดมินคิดและร่างข้อความตอบลูกค้าในกล่องแชทอินบ็อกซ์
                    </CardDescription>
                  </div>
                </div>
                {canManage && (
                  <Switch
                    checked={chatAssistEnabled}
                    disabled={savingChatAssist}
                    onCheckedChange={(val) => void handleToggleChatAssist(val)}
                  />
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0">
              {chatAssistEnabled ? (
                <>
                  <div className="rounded-lg border bg-background/80 p-3 text-xs flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <Sparkles className="size-3.5 text-blue-500" />
                        <span>หลักการทำงานของผู้ช่วย AI ในห้องแชท:</span>
                      </div>
                      <Link
                        href="/settings/ai"
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                      >
                        <span>ตั้งค่าคลังความรู้ & โมเดล AI</span>
                        <ArrowRight className="size-3" />
                      </Link>
                    </div>
                    <ul className="list-disc list-inside space-y-1.5 text-muted-foreground pl-1">
                      <li>
                        <strong className="text-foreground">โหมดร่างข้อความแนะนำ (Recommend Draft):</strong> AI จะนำข้อความล่าสุดของลูกค้า + ข้อมูลสินค้าในคลังความรู้ มาร่างคำตอบแนะนำในกล่องพิมพ์ให้แอดมินตรวจดู
                      </li>
                      <li>
                        <strong className="text-foreground">ควบคุมบอทรายห้อง (1:1 Bot Toggle):</strong> มีปุ่ม <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground"><Bot className="size-3" /> บอท: เปิด/ปิด</span> ในแถบเครื่องมือข้างไอคอนวิดีโอในทุกห้องแชท
                      </li>
                      <li>
                        <strong className="text-foreground">ค่าเริ่มต้นปลอดภัย (Default Off):</strong> แชทใหม่ที่เข้ามาจะปิดบอทตอบอัตโนมัติไว้ก่อนเสมอ เพื่อให้แอดมินคุยเอง ป้องกันบอทตอบผิดพลาด และแอดมินสามารถกดเปิดบอทได้ทุกเมื่อที่ต้องการ
                      </li>
                      <li>
                        <strong className="text-foreground">สมองที่ใช้:</strong> {aiInfo?.model ?? 'gemini-3.6-flash'} {aiInfo?.hasKnowledge ? '(มีคลังความรู้สินค้าแล้ว)' : '(ยังไม่มีคลังความรู้สินค้า)'}
                      </li>
                    </ul>
                  </div>

                  {/* จำลองคำตอบ AI ในแชท */}
                  <div className="rounded-lg border bg-background p-3 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Play className="size-3 text-blue-500" />
                        ทดลองให้ AI ร่างคำตอบในแชท:
                      </span>
                      {chatSimOutput && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[11px] gap-1 px-2"
                          onClick={() => void handleSimulateChatAssist()}
                          disabled={testingChatSim}
                        >
                          <RefreshCw className={cn("size-2.5", testingChatSim && "animate-spin")} />
                          ลองใหม่
                        </Button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={chatSimInput}
                        onChange={(e) => setChatSimInput(e.target.value)}
                        placeholder="พิมพ์ข้อความลูกค้า เช่น สนใจสินค้าตัวนี้ มีโปรส่งฟรีไหมคะ"
                        className="text-xs h-8"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleSimulateChatAssist();
                        }}
                      />
                      <Button
                        size="sm"
                        className="h-8 shrink-0 text-xs gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={() => void handleSimulateChatAssist()}
                        disabled={testingChatSim || !chatSimInput.trim()}
                      >
                        {testingChatSim ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                        ทดสอบ
                      </Button>
                    </div>

                    {chatSimOutput && (
                      <div className="mt-1 rounded-md bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200/50 p-2.5 text-xs">
                        <span className="font-semibold text-blue-700 dark:text-blue-300 block mb-1">
                          💬 ร่างข้อความที่ AI แนะนำให้แอดมิน:
                        </span>
                        <p className="whitespace-pre-wrap leading-relaxed text-foreground">
                          {chatSimOutput}
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground py-1">
                  เมื่อปิดการทำงาน แอดมินจะพิมพ์ตอบลูกค้าด้วยตนเองหรือใช้เทมเพลต Quick Reply ปกติ โดยไม่มีปุ่มให้ AI แนะนำคำตอบ
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-start justify-between gap-2 pt-2 border-t">
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

            {/* โหมดสมองการตอบ (AI vs Template) */}
            <div className="mt-4 rounded-xl border bg-muted/20 p-3.5 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-orange-500" />
                  <span className="text-sm font-semibold text-foreground">สมองในการคิดคำตอบ:</span>
                </div>
                {aiInfo && (
                  <Badge variant={aiInfo.hasApiKey ? 'default' : 'destructive'} className="text-[10px] gap-1 h-5">
                    {aiInfo.hasApiKey ? (
                      <>
                        <Check className="size-2.5" />
                        เชื่อมต่อ {aiInfo.model}
                      </>
                    ) : (
                      'ยังไม่ตั้ง Gemini API Key'
                    )}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBotSettings((prev) => ({ ...prev, reply_mode: 'ai' }))}
                  disabled={!canManage}
                  className={cn(
                    'flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all',
                    botSettings.reply_mode === 'ai'
                      ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/20 text-foreground ring-1 ring-orange-500'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                    <span>🤖</span>
                    <span>ใช้สมอง AI (Gemini) อัจฉริยะ</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-400 text-orange-600 dark:text-orange-400">แนะนำ</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    ตอบคำถามลูกค้าตามคลังความรู้สินค้าและนโยบายร้านจริงอย่างสุภาพ ไม่ตอบซ้ำเป็นหุ่นยนต์
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setBotSettings((prev) => ({ ...prev, reply_mode: 'template' }))}
                  disabled={!canManage}
                  className={cn(
                    'flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all',
                    botSettings.reply_mode === 'template'
                      ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/20 text-foreground ring-1 ring-orange-500'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                    <span>📝</span>
                    <span>ใช้ข้อความตายตัว (Template)</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    ตอบด้วยข้อความตายตัวเดิมทุกคอมเมนต์ตามแม่แบบที่ระบุด้านล่าง
                  </p>
                </button>
              </div>

              {botSettings.reply_mode === 'ai' && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-orange-200/60 bg-background p-2.5 text-xs text-muted-foreground">
                  <span className="text-[11px]">
                    {aiInfo?.hasKnowledge
                      ? '✨ AI พร้อมใช้งาน: อ้างอิงคำตอบจากคลังความรู้สินค้าของร้าน'
                      : '⚠️ ยังไม่มีข้อมูลในคลังความรู้: AI จะตอบทั่วไปอย่างสุภาพ'}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    asChild
                    className="h-6 text-[11px] text-primary hover:text-primary gap-1"
                  >
                    <Link href="/settings/ai">
                      <Brain className="size-3" />
                      ปรับแต่งคลังความรู้ AI
                      <ArrowRight className="size-3" />
                    </Link>
                  </Button>
                </div>
              )}
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
              <div className="flex flex-col gap-3 py-4 border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span>↩️</span> ตอบคอมเมนต์อัตโนมัติ (Public Reply)
                    </div>
                    <p className="text-xs text-muted-foreground">
                      โพสต์ตอบกลับใต้คอมเมนต์ของลูกค้าหน้าโพสต์เพจ
                    </p>
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
                  <div className="mt-1 flex flex-col gap-3.5 rounded-xl border bg-muted/20 p-3.5">
                    {/* สไตล์การตอบใต้โพสต์ */}
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        🎯 สไตล์การตอบคอมเมนต์ใต้โพสต์:
                      </Label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() =>
                            setBotSettings((prev) => ({
                              ...prev,
                              public_reply_style: 'short',
                              public_reply_instruction:
                                'ตอบสั้นกระชับ 1-2 ประโยค ชวนคุย ไม่บอกราคาหน้าโพสต์และเชิญชวนทักแชท',
                            }))
                          }
                          className={cn(
                            'flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left text-xs transition',
                            botSettings.public_reply_style === 'short'
                              ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/30 text-foreground ring-1 ring-orange-500 font-medium'
                              : 'border-border bg-card text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <span className="font-semibold text-foreground">⚡ สั้นกระชับ 1-2 ประโยค</span>
                          <span className="text-[11px] text-muted-foreground">ชวนคุย ไม่บอกราคาหน้าโพสต์ ชวนทักแชท</span>
                        </button>

                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() =>
                            setBotSettings((prev) => ({
                              ...prev,
                              public_reply_style: 'friendly',
                              public_reply_instruction:
                                'ตอบด้วยความสุภาพ อ่อนหวาน ใช้คำว่า ค่ะ/นะคะ ขอบคุณที่สนใจและชวนลูกค้าทักแชทเพื่อดูข้อมูลเพิ่มเติม',
                            }))
                          }
                          className={cn(
                            'flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left text-xs transition',
                            botSettings.public_reply_style === 'friendly'
                              ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/30 text-foreground ring-1 ring-orange-500 font-medium'
                              : 'border-border bg-card text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <span className="font-semibold text-foreground">🥰 สุภาพอ่อนหวาน ชวนคุย</span>
                          <span className="text-[11px] text-muted-foreground">ตอบสุภาพ อบอุ่น ขอบคุณลูกค้าอย่างจริงใจ</span>
                        </button>

                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() =>
                            setBotSettings((prev) => ({
                              ...prev,
                              public_reply_style: 'custom',
                            }))
                          }
                          className={cn(
                            'flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left text-xs transition',
                            botSettings.public_reply_style === 'custom'
                              ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/30 text-foreground ring-1 ring-orange-500 font-medium'
                              : 'border-border bg-card text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <span className="font-semibold text-foreground">⚙️ กำหนดเอง (Custom)</span>
                          <span className="text-[11px] text-muted-foreground">พิมพ์คำสั่งสอน AI ตอบคอมเมนต์ตามต้องการ</span>
                        </button>
                      </div>
                    </div>

                    {/* คำสั่งสอน AI เฉพาะตอบคอมเมนต์ */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Sparkles className="size-3 text-orange-500" />
                          คำสั่งสอน AI เฉพาะตอบคอมเมนต์ (Public Training Instruction):
                        </Label>
                      </div>
                      <Textarea
                        value={botSettings.public_reply_instruction}
                        onChange={(e) =>
                          setBotSettings((prev) => ({
                            ...prev,
                            public_reply_instruction: e.target.value,
                            public_reply_style: 'custom',
                          }))
                        }
                        placeholder="พิมพ์คำสั่งเฉพาะ เช่น ตอบสั้นกระชับ 1-2 ประโยค ชวนคุย ไม่บอกราคาหน้าโพสต์และเชิญชวนทักแชท..."
                        className="min-h-[70px] text-xs leading-relaxed bg-background"
                        disabled={!canManage}
                      />
                      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        <span>💡 ตัวอย่างด่วน:</span>
                        <button
                          type="button"
                          className="underline hover:text-foreground"
                          onClick={() =>
                            setBotSettings((prev) => ({
                              ...prev,
                              public_reply_instruction:
                                'ตอบสั้นกระชับ 1-2 ประโยค ชวนคุย ไม่บอกราคาหน้าโพสต์และเชิญชวนทักแชท',
                              public_reply_style: 'short',
                            }))
                          }
                        >
                          [สั้นกระชับไม่บอกราคา]
                        </button>
                        <span>·</span>
                        <button
                          type="button"
                          className="underline hover:text-foreground"
                          onClick={() =>
                            setBotSettings((prev) => ({
                              ...prev,
                              public_reply_instruction:
                                'แจ้งลูกค้าว่าส่งรายละเอียดและโปรโมชั่นพิเศษเข้าไปในข้อความส่วนตัวแล้ว ให้กดเช็คดูได้เลยค่ะ',
                              public_reply_style: 'custom',
                            }))
                          }
                        >
                          [แจ้งว่าส่งข้อความส่วนตัวแล้ว]
                        </button>
                      </div>
                    </div>

                    {/* ข้อความแม่แบบสำรอง (Template / Fallback) */}
                    <div className="flex flex-col gap-1.5 border-t pt-3">
                      <Label className="text-xs font-medium text-foreground">
                        📝 ข้อความแม่แบบสำรอง (Template / Fallback กรณีไม่ใช้ AI หรือ AI ขัดข้อง):
                      </Label>
                      <Textarea
                        value={botSettings.public_reply_template}
                        onChange={(e) =>
                          setBotSettings((prev) => ({
                            ...prev,
                            public_reply_template: e.target.value,
                          }))
                        }
                        placeholder="ขอบคุณที่สนใจนะคะ {name} ทักแชทไปเรียบร้อยแล้วค่า 🥰"
                        className="min-h-[60px] text-xs leading-relaxed bg-background"
                        disabled={!canManage}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        ใช้ {'{name}'} แทนชื่อผู้คอมเมนต์ได้ · หากมีกติกาคำตรงกับกฎพิเศษ บอทจะใช้ข้อความของกฎนั้นก่อน
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. ดึงเข้าแชท (ตอบเข้าแชทส่วนตัว) */}
              <div className="flex flex-col gap-3 py-4 border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span>💌</span> ดึงเข้าแชท (ตอบเข้าแชทส่วนตัว / Private Reply)
                    </div>
                    <p className="text-xs text-muted-foreground">
                      ส่งข้อความหาลูกค้าเข้ากล่องแชท Messenger ทันทีที่คอมเมนต์
                    </p>
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
                  <div className="mt-1 flex flex-col gap-3.5 rounded-xl border bg-muted/20 p-3.5">
                    {/* สไตล์การทักแชทส่วนตัว */}
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        🎯 สไตล์ข้อความทักเข้าแชทส่วนตัว:
                      </Label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() =>
                            setBotSettings((prev) => ({
                              ...prev,
                              private_reply_style: 'warm_welcome',
                              private_reply_instruction:
                                'ทักทายลูกค้าอย่างอบอุ่น ขอบคุณที่สนใจ แนะนำโปรโมชั่นและสอบถามสินค้าที่ต้องการ',
                            }))
                          }
                          className={cn(
                            'flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left text-xs transition',
                            botSettings.private_reply_style === 'warm_welcome'
                              ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/30 text-foreground ring-1 ring-orange-500 font-medium'
                              : 'border-border bg-card text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <span className="font-semibold text-foreground">🌸 ทักทายต้อนรับอบอุ่น</span>
                          <span className="text-[11px] text-muted-foreground">ต้อนรับอย่างเป็นกันเองและถามความสนใจ</span>
                        </button>

                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() =>
                            setBotSettings((prev) => ({
                              ...prev,
                              private_reply_style: 'promo',
                              private_reply_instruction:
                                'ต้อนรับสู่แชทร้าน แนะนำโปรโมชั่นส่วนลดพิเศษประจำสัปดาห์ ส่งโค้ดส่วนลด และสอบถามสินค้าที่สนใจ',
                            }))
                          }
                          className={cn(
                            'flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left text-xs transition',
                            botSettings.private_reply_style === 'promo'
                              ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/30 text-foreground ring-1 ring-orange-500 font-medium'
                              : 'border-border bg-card text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <span className="font-semibold text-foreground">🎁 แนะนำโปรเด็ด & คูปอง</span>
                          <span className="text-[11px] text-muted-foreground">แจกโปรโมชั่นทันทีที่ลูกค้าเปิดแชทเข้ามา</span>
                        </button>

                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() =>
                            setBotSettings((prev) => ({
                              ...prev,
                              private_reply_style: 'custom',
                            }))
                          }
                          className={cn(
                            'flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left text-xs transition',
                            botSettings.private_reply_style === 'custom'
                              ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-950/30 text-foreground ring-1 ring-orange-500 font-medium'
                              : 'border-border bg-card text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <span className="font-semibold text-foreground">⚙️ กำหนดเอง (Custom)</span>
                          <span className="text-[11px] text-muted-foreground">พิมพ์คำสั่งสอน AI ทักเข้าแชทตามต้องการ</span>
                        </button>
                      </div>
                    </div>

                    {/* คำสั่งสอน AI เฉพาะทักแชท */}
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Sparkles className="size-3 text-orange-500" />
                        คำสั่งสอน AI เฉพาะดึงเข้าแชท (Private Training Instruction):
                      </Label>
                      <Textarea
                        value={botSettings.private_reply_instruction}
                        onChange={(e) =>
                          setBotSettings((prev) => ({
                            ...prev,
                            private_reply_instruction: e.target.value,
                            private_reply_style: 'custom',
                          }))
                        }
                        placeholder="พิมพ์คำสั่งเฉพาะ เช่น ทักทายลูกค้าอย่างอบอุ่น ขอบคุณที่สนใจ แนะนำโปรโมชั่นและสอบถามสินค้าที่ต้องการ..."
                        className="min-h-[70px] text-xs leading-relaxed bg-background"
                        disabled={!canManage}
                      />
                    </div>

                    {/* แนบรูปภาพเข้าแชทส่วนตัว */}
                    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-orange-300 bg-background/60 p-3 dark:border-orange-900/50">
                      <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <ImageIcon className="size-3.5 text-orange-500" />
                        แนบรูปภาพสินค้า/โปรโมชั่นเมื่อทักแชท (Private Reply Attachment):
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        ส่งรูปภาพนี้เข้าไปในแชทของลูกค้าพร้อมกับข้อความเปิดบทสนทนา (เช่น ป้ายโปรโมชั่น, เมนู, รูปสินค้าขายดี)
                      </p>

                      {botSettings.private_reply_image_url ? (
                        <div className="mt-1 flex items-center gap-3 rounded-lg border bg-card p-2.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={botSettings.private_reply_image_url}
                            alt="ภาพแนบ"
                            className="size-16 rounded-md object-cover border shrink-0 bg-muted"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-foreground truncate">
                              {botSettings.private_reply_image_name || 'รูปภาพแนบในแชท'}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {botSettings.private_reply_image_url}
                            </p>
                            <div className="mt-1.5 flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setMediaPickerOpen(true)}
                                disabled={!canManage}
                              >
                                เปลี่ยนรูปภาพ
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-destructive hover:bg-destructive/10"
                                onClick={() =>
                                  setBotSettings((prev) => ({
                                    ...prev,
                                    private_reply_image_url: null,
                                    private_reply_image_name: null,
                                  }))
                                }
                                disabled={!canManage}
                              >
                                ลบรูปภาพ
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1 flex flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs gap-1.5 border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300"
                              onClick={() => setMediaPickerOpen(true)}
                              disabled={!canManage}
                            >
                              <ImageIcon className="size-3.5" />
                              เลือกรูปภาพจากคลังสื่อ
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => setShowManualUrlInput((v) => !v)}
                            >
                              🔗 วาง URL ลิงก์รูปภาพเอง
                            </Button>
                          </div>

                          {showManualUrlInput && (
                            <div className="flex items-center gap-2 pt-1 max-w-md">
                              <Input
                                value={manualUrlText}
                                onChange={(e) => setManualUrlText(e.target.value)}
                                placeholder="วาง URL รูปภาพ เช่น https://.../promo.jpg"
                                className="h-8 text-xs"
                              />
                              <Button
                                type="button"
                                size="sm"
                                className="h-8 text-xs shrink-0"
                                onClick={() => {
                                  if (manualUrlText.trim()) {
                                    setBotSettings((prev) => ({
                                      ...prev,
                                      private_reply_image_url: manualUrlText.trim(),
                                      private_reply_image_name: 'รูปภาพภายนอก',
                                    }));
                                    setManualUrlText('');
                                    setShowManualUrlInput(false);
                                    toast.success('ตั้งค่ารูปภาพแนบแล้ว');
                                  }
                                }}
                              >
                                ใส่รูปนี้
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ข้อความแม่แบบสำรอง (Template / Fallback) */}
                    <div className="flex flex-col gap-1.5 border-t pt-3">
                      <Label className="text-xs font-medium text-foreground">
                        📝 ข้อความแม่แบบสำรองสำหรับแชทส่วนตัว (Template / Fallback):
                      </Label>
                      <Textarea
                        value={botSettings.private_reply_template}
                        onChange={(e) =>
                          setBotSettings((prev) => ({
                            ...prev,
                            private_reply_template: e.target.value,
                          }))
                        }
                        placeholder="สวัสดีค่ะ {name} ยินดีให้บริการค่ะ ต้องการสอบถามข้อมูลหรือสั่งซื้อสินค้าชิ้นไหนแจ้งได้เลยนะคะ"
                        className="min-h-[60px] text-xs leading-relaxed bg-background"
                        disabled={!canManage}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        ใช้ {'{name}'} แทนชื่อลูกค้าได้
                      </p>
                    </div>
                  </div>
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

            {/* 🧪 ห้องทดสอบบอทคอมเมนต์ (Comment Bot Simulator) */}
            <div className="mt-6 rounded-xl border border-orange-200 bg-orange-50/20 dark:border-orange-900/40 dark:bg-orange-950/10 p-4">
              <div className="flex flex-col gap-1 mb-3">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-orange-500/15 text-orange-600 dark:text-orange-400">
                    <Sparkles className="size-3.5" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">
                    🧪 ทดสอบบอทคอมเมนต์ (Dry-run Simulator)
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  พิมพ์คอมเมนต์จำลองเพื่อทดสอบดูว่าบอทจะ กดไลก์, ตอบใต้โพสต์, หรือดึงเข้าแชทอย่างไร ตามกฎที่ตั้งไว้ด้านบน (ไม่ส่งจริงไปที่เพจ)
                </p>
              </div>

              <div className="flex flex-col gap-3 rounded-lg border bg-background p-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] text-muted-foreground">ชื่อลูกค้าจำลอง:</Label>
                    <Input
                      value={testCommenterName}
                      onChange={(e) => setTestCommenterName(e.target.value)}
                      placeholder="เช่น น้องบีม"
                      className="text-xs h-8"
                    />
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <Label className="text-[11px] text-muted-foreground">ข้อความคอมเมนต์:</Label>
                    <div className="flex gap-2">
                      <Input
                        value={testCommentText}
                        onChange={(e) => setTestCommentText(e.target.value)}
                        placeholder="พิมพ์คอมเมนต์ เช่น สนใจค่ะ มีโปรส่งฟรีไหมคะ"
                        className="text-xs h-8"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRunCommentBotTest();
                        }}
                      />
                      <Button
                        size="sm"
                        className="h-8 shrink-0 text-xs gap-1 bg-orange-600 hover:bg-orange-700 text-white"
                        onClick={() => void handleRunCommentBotTest()}
                        disabled={testingCommentBot || !testCommentText.trim()}
                      >
                        {testingCommentBot ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                        รันเทส
                      </Button>
                    </div>
                  </div>
                </div>

                {commentBotTestResult && (
                  <div className="mt-2 flex flex-col gap-2.5 rounded-lg border p-3 bg-muted/20 text-xs">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="font-semibold text-foreground flex items-center gap-1.5">
                        <CheckCircle2 className="size-3.5 text-emerald-600" />
                        ผลการจำลองการตอบของบอท:
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {commentBotTestResult.filter_reason}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="flex items-center gap-2 rounded-md border p-2 bg-background">
                        <span className="text-base">👍</span>
                        <div>
                          <p className="font-medium text-[11px]">กดไลก์อัตโนมัติ</p>
                          <Badge variant={commentBotTestResult.would_like ? 'default' : 'secondary'} className="text-[9px] mt-0.5">
                            {commentBotTestResult.would_like ? 'กดไลก์' : 'ไม่กดไลก์'}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 rounded-md border p-2 bg-background">
                        <span className="text-base">↩️</span>
                        <div>
                          <p className="font-medium text-[11px]">ตอบใต้โพสต์</p>
                          <Badge variant={commentBotTestResult.would_reply_public ? 'default' : 'secondary'} className="text-[9px] mt-0.5">
                            {commentBotTestResult.would_reply_public
                              ? `ตอบ (${commentBotTestResult.public_reply_mode})`
                              : 'ไม่ตอบ'}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 rounded-md border p-2 bg-background">
                        <span className="text-base">💌</span>
                        <div>
                          <p className="font-medium text-[11px]">ดึงเข้าแชทส่วนตัว</p>
                          <Badge variant={commentBotTestResult.would_reply_private ? 'default' : 'secondary'} className="text-[9px] mt-0.5">
                            {commentBotTestResult.would_reply_private
                              ? `ทักแชท (${commentBotTestResult.private_reply_mode})`
                              : 'ไม่ทัก'}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    {/* Preview ข้อความตอบใต้โพสต์ */}
                    {commentBotTestResult.would_reply_public && commentBotTestResult.public_reply_text && (
                      <div className="rounded-md border bg-background p-2.5">
                        <span className="font-semibold text-foreground flex items-center gap-1 text-[11px] mb-1">
                          💬 ข้อความที่จะโพสต์ตอบใต้คอมเมนต์:
                          <Badge variant="outline" className="text-[9px]">
                            {commentBotTestResult.public_reply_mode === 'ai' ? 'คิดโดย Gemini AI' : 'ใช้แม่แบบ Template'}
                          </Badge>
                        </span>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                          {commentBotTestResult.public_reply_text}
                        </p>
                      </div>
                    )}

                    {/* Preview ข้อความทักแชทส่วนตัว */}
                    {commentBotTestResult.would_reply_private && (
                      <div className="rounded-md border bg-background p-2.5 flex flex-col gap-2">
                        <span className="font-semibold text-foreground flex items-center gap-1 text-[11px]">
                          💌 ข้อความที่จะส่งเข้าแชท Messenger (Private Reply):
                          <Badge variant="outline" className="text-[9px]">
                            {commentBotTestResult.private_reply_mode === 'ai' ? 'คิดโดย Gemini AI' : 'ใช้แม่แบบ Template'}
                          </Badge>
                        </span>
                        {commentBotTestResult.private_reply_text && (
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                            {commentBotTestResult.private_reply_text}
                          </p>
                        )}
                        {commentBotTestResult.private_reply_image_url && (
                          <div className="flex items-center gap-2.5 rounded-md border bg-muted/30 p-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={commentBotTestResult.private_reply_image_url}
                              alt="ภาพแนบในแชท"
                              className="size-14 rounded-md object-cover border shrink-0 bg-muted"
                            />
                            <div className="min-w-0 flex-1">
                              <span className="text-[11px] font-semibold text-foreground block">
                                🖼️ ภาพที่แนบส่งเข้าแชท:
                              </span>
                              <span className="text-[10px] text-muted-foreground truncate block">
                                {commentBotTestResult.private_reply_image_url}
                              </span>
                            </div>
                          </div>
                        )}
                        {commentBotTestResult.catalog_attached && commentBotTestResult.catalog_preview && (
                          <div className="mt-1 pt-2 border-t text-[11px] text-muted-foreground whitespace-pre-wrap">
                            <span className="font-medium text-foreground block mb-0.5">🛍️ แนบเมนูสินค้า/โปรฯ อัตโนมัติ:</span>
                            {commentBotTestResult.catalog_preview}
                          </div>
                        )}
                      </div>
                    )}
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

      {/* ---------- ไดอะล็อกเลือกรูปภาพจากคลังสื่อสำหรับ Private Reply ---------- */}
      <MediaImagePickerDialog
        open={mediaPickerOpen}
        onClose={() => setMediaPickerOpen(false)}
        onSelect={(url, name) => {
          setBotSettings((prev) => ({
            ...prev,
            private_reply_image_url: url,
            private_reply_image_name: name,
          }));
          toast.success('แนบรูปภาพเข้าแชทส่วนตัวแล้ว');
        }}
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

/* ================================================================== */
/* ไดอะล็อกเลือกรูปภาพจากคลังสื่อ (สำหรับ Private Reply)                   */
/* ================================================================== */

type MediaLibraryItem = {
  id: string;
  preview_url: string;
  public_url: string;
  mime: string;
  original_name?: string;
};

function MediaImagePickerDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string, name: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MediaLibraryItem[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/media-library?for_picker=1', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (json.ok && json.data?.items) {
          const imageItems = (json.data.items as MediaLibraryItem[]).filter((it) =>
            it.mime?.startsWith('image/'),
          );
          setItems(imageItems);
        }
      })
      .catch(() => {
        toast.error('โหลดคลังสื่อไม่สำเร็จ');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-4">
        <DialogHeader className="pb-2 text-left">
          <DialogTitle className="text-base">เลือกรูปภาพจากคลังสื่อ</DialogTitle>
          <DialogDescription className="text-xs">
            แตะรูปภาพที่ต้องการแนบไปกับข้อความทักแชทส่วนตัว (Private Reply)
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-[250px] max-h-[480px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground text-xs">
              <Loader2 className="size-6 animate-spin text-orange-500" />
              <span>กำลังโหลดรูปภาพ...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-xs text-muted-foreground">
              <ImageIcon className="size-10 mb-2 opacity-40" />
              <p>ยังไม่มีรูปภาพในคลังสื่อ</p>
              <Link href="/media" className="mt-2 text-primary hover:underline font-medium">
                ไปที่หน้าคลังสื่อเพื่ออัปโหลดรูปภาพ
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5 p-1">
              {items.map((item) => {
                const imgUrl = item.public_url || item.preview_url;
                const name = item.original_name || 'รูปภาพคลังสื่อ';
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelect(imgUrl, name);
                      onClose();
                    }}
                    className="group relative aspect-square overflow-hidden rounded-lg border bg-muted hover:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all text-left"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.preview_url || item.public_url}
                      alt={name}
                      className="size-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[10px] text-white truncate font-medium">{name}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="pt-2 border-t flex items-center justify-between sm:justify-between">
          <Button variant="ghost" size="sm" asChild className="text-xs text-muted-foreground">
            <Link href="/media">
              จัดการคลังสื่อ
              <ArrowRight className="size-3 ml-1" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
