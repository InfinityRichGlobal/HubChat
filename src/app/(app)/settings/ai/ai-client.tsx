'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Sparkles, Key, Bot, BookOpen, Sliders, Play, Save, Check,
  ExternalLink, Loader2, RefreshCw, AlertCircle, MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import SettingsBackButton from '@/components/settings-back-button';

const DEFAULT_SYSTEM_PROMPT = `คุณคือแอดมินเพจร้านค้าออนไลน์ของไทยที่สุภาพ อ่อนหวาน เป็นมิตร และมืออาชีพมาก
กฎเหล็กในการตอบ:
1. ตอบด้วยภาษาไทยที่สุภาพ น่ารัก อบอุ่น ใช้คำลงท้าย "ค่ะ" หรือ "นะคะ" อย่างเป็นธรรมชาติ
2. หากเป็นคอมเมนต์ใต้โพสต์ Facebook/IG: ห้ามระบุราคาตายตัวหน้าโพสต์ แนะนำให้ลูกค้าทักข้อความ (Inbox) อย่างน่ารัก เพื่อรับโปรโมชั่นพิเศษ
3. ตอบให้กระชับ ชัดเจน 1-2 ประโยค ไม่เวิ่นเว้อ
4. ตอบคำถามโดยอ้างอิงจาก [ข้อมูลร้านค้าและสินค้า] ด้านล่างอย่างเคร่งครัด ห้ามมโนข้อมูลที่ไม่มีอยู่จริง`;

const DEFAULT_KNOWLEDGE_BASE = `# ข้อมูลร้านค้าและบริการ
- ชื่อร้าน: HubChat Official Store
- เวลาทำการ: ตอบแชททุกวัน 08:30 - 22:00 น.
- การจัดส่ง: จัดส่งผ่าน Flash Express และ Kerry จัดส่งวันจันทร์ - เสาร์ ได้รับสินค้าภายใน 1-2 วันทำการ
- ค่าจัดส่ง: สั่งซื้อครบ 500 บาท ส่งฟรี (ยอดไม่ถึงคิดค่าส่ง 40 บาท)
- การชำระเงิน: โอนผ่านบัญชีธนาคาร หรือเก็บเงินปลายทาง (COD +20 บาท)
- การรับประกัน: เปลี่ยนสินค้าใหม่ฟรีภายใน 7 วันหากสินค้ามีปัญหาหรือชำรุดจากการผลิต`;

type AiSettingsData = {
  hasApiKey: boolean;
  hintLast4: string | null;
  systemPrompt: string;
  knowledge: string;
  model: string;
  temperature: number;
  autoReplyComments: boolean;
  enableCommentSuggest: boolean;
  enableChatAssist: boolean;
};

export default function AiSettingsClient({ isOwner }: { isOwner: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [testingPlayground, setTestingPlayground] = useState(false);

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [hintLast4, setHintLast4] = useState<string | null>(null);

  const [model, setModel] = useState('gemini-3.6-flash');
  const [temperature, setTemperature] = useState(0.7);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [knowledge, setKnowledge] = useState('');

  const [autoReplyComments, setAutoReplyComments] = useState(false);
  const [enableCommentSuggest, setEnableCommentSuggest] = useState(true);
  const [enableChatAssist, setEnableChatAssist] = useState(true);

  // Playground state
  const [testInput, setTestInput] = useState('สวัสดีค่ะ มีสินค้าพร้อมส่งไหมคะ มีโปรโมชั่นอะไรบ้าง');
  const [testOutput, setTestOutput] = useState('');

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/settings', { cache: 'no-store' });
      const json = await res.json();
      if (json.ok && json.data) {
        const d = json.data as AiSettingsData;
        setHasApiKey(d.hasApiKey);
        setHintLast4(d.hintLast4);
        setModel(d.model || 'gemini-3.6-flash');
        setTemperature(d.temperature ?? 0.7);
        setSystemPrompt(d.systemPrompt || DEFAULT_SYSTEM_PROMPT);
        setKnowledge(d.knowledge || DEFAULT_KNOWLEDGE_BASE);
        setAutoReplyComments(d.autoReplyComments);
        setEnableCommentSuggest(d.enableCommentSuggest);
        setEnableChatAssist(d.enableChatAssist);
      }
    } catch (err) {
      toast.error('โหลดการตั้งค่า AI ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function handleSave() {
    if (!isOwner) {
      toast.error('เฉพาะเจ้าของร้าน (Owner) เท่านั้นที่สามารถบันทึกการตั้งค่า AI ได้');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        systemPrompt,
        knowledge,
        model,
        temperature,
        autoReplyComments,
        enableCommentSuggest,
        enableChatAssist,
      };
      if (apiKeyInput.trim()) {
        payload.apiKey = apiKeyInput.trim();
      }

      const res = await fetch('/api/ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success('บันทึกการตั้งค่า AI เรียบร้อยแล้ว');
        setApiKeyInput('');
        await loadSettings();
      } else {
        toast.error(json.error?.message_th || 'บันทึกไม่สำเร็จ');
      }
    } catch (err) {
      toast.error('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestKey() {
    setTestingKey(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test_key',
          apiKey: apiKeyInput.trim() || undefined,
          model,
        }),
      });
      const json = await res.json();
      if (json.ok && json.data?.ok) {
        toast.success(json.data.message_th);
      } else {
        toast.error(json.data?.message_th || json.error?.message_th || 'ทดสอบไม่สำเร็จ');
      }
    } catch {
      toast.error('ไม่สามารถทดสอบการเชื่อมต่อได้');
    } finally {
      setTestingKey(false);
    }
  }

  async function handlePlaygroundTest() {
    if (!testInput.trim()) {
      toast.error('กรุณาพิมพ์ข้อความทดสอบ');
      return;
    }
    setTestingPlayground(true);
    setTestOutput('');
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'playground',
          userMessage: testInput.trim(),
          systemPrompt,
          knowledgeBase: knowledge,
          model,
          temperature,
        }),
      });
      const json = await res.json();
      if (json.ok && json.data?.reply) {
        setTestOutput(json.data.reply);
      } else {
        toast.error(json.error?.message_th || 'AI ไม่สามารถตอบได้');
      }
    } catch {
      toast.error('เกิดข้อผิดพลาดในการทดสอบ');
    } finally {
      setTestingPlayground(false);
    }
  }

  const [savingExample, setSavingExample] = useState(false);

  async function handleSaveExample() {
    if (!testInput.trim() || !testOutput.trim()) {
      toast.error('กรุณาระบุทั้งข้อความลูกค้าและคำตอบก่อนบันทึก');
      return;
    }
    setSavingExample(true);
    try {
      const addition = `\n\n- คำถามลูกค้า: ${testInput.trim()}\n  แนวทางคำตอบ: ${testOutput.trim()}`;
      const updatedKnowledge = (knowledge || '').trim() + addition;
      setKnowledge(updatedKnowledge);

      if (isOwner) {
        const payload: Record<string, unknown> = {
          systemPrompt,
          knowledge: updatedKnowledge,
          model,
          temperature,
        };
        const res = await fetch('/api/ai/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.ok) {
          toast.success('บันทึกตัวอย่างคำตอบลงคลังความรู้เรียบร้อยแล้ว');
        } else {
          toast.success('เพิ่มตัวอย่างลงในช่องคลังความรู้แล้ว (กรุณากดบันทึกด้านบน)');
        }
      } else {
        toast.success('เพิ่มตัวอย่างลงในช่องคลังความรู้แล้ว (กรุณากดบันทึกด้านบน)');
      }
    } catch {
      toast.error('บันทึกตัวอย่างไม่สำเร็จ');
    } finally {
      setSavingExample(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 pb-12">
      <SettingsBackButton title="AI & บอทเทรน" />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Sparkles className="size-5 text-primary" />
            AI & เทรนบอทแอดมิน (Google Gemini)
          </h1>
          <p className="text-sm text-muted-foreground">
            กำหนดบุคลิก กฎของร้าน คลังความรู้สินค้า และทดสอบการตอบของ AI แอดมิน
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-1.5 shadow-sm">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          บันทึกการตั้งค่า
        </Button>
      </div>

      {/* 1. API Key & Model */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="size-4 text-primary" />
              1. Google Gemini API Key
            </CardTitle>
            <Badge variant={hasApiKey ? 'default' : 'destructive'} className="gap-1">
              {hasApiKey ? <Check className="size-3" /> : <AlertCircle className="size-3" />}
              {hasApiKey ? (hintLast4 ? `ตั้งค่าแล้ว (••••${hintLast4})` : 'ตั้งค่าแล้ว') : 'ยังไม่ได้ตั้งค่า'}
            </Badge>
          </div>
          <CardDescription>
            ใช้ Google Gemini API (ฟรีโควต้า 15 คำขอ/นาที) รับคีย์ได้ฟรีทันทีที่{' '}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2 hover:opacity-80"
            >
              Google AI Studio <ExternalLink className="size-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={hasApiKey ? 'เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยนคีย์' : 'วางคีย์ AIzaSy... ที่นี่'}
              className="font-mono text-sm"
            />
            <Button
              variant="outline"
              onClick={handleTestKey}
              disabled={testingKey || (!hasApiKey && !apiKeyInput.trim())}
              className="shrink-0 gap-1.5"
            >
              {testingKey ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              ทดสอบคีย์
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-model" className="text-xs font-semibold">โมเดล AI (Model)</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger id="ai-model">
                  <SelectValue placeholder="เลือกโมเดล" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini-3.6-flash">Gemini 3.6 Flash (แนะนำ - โมเดลล่าสุด เร็ว ฉลาด ประหยัด)</SelectItem>
                  <SelectItem value="gemini-3.7-flash">Gemini 3.7 Flash (ฉลาดรอบด้าน รองรับมัลติโมดัล)</SelectItem>
                  <SelectItem value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (เร็ว ประหยัดโควต้า)</SelectItem>
                  <SelectItem value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview (การคิดวิเคราะห์เชิงลึก)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ai-temp" className="text-xs font-semibold">ความสร้างสรรค์ (Temperature: {temperature})</Label>
                <span className="text-[11px] text-muted-foreground">
                  {temperature <= 0.4 ? 'ตรงไปตรงมา ไม่มโน' : temperature <= 0.7 ? 'ธรรมชาติ กำลังดี' : 'สร้างสรรค์ ลื่นไหล'}
                </span>
              </div>
              <input
                id="ai-temp"
                type="range"
                min="0.1"
                max="1.0"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="h-2 w-full cursor-pointer accent-primary"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. System Instruction (เทรนบุคลิกบอท) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4 text-primary" />
              2. คำสั่งสอนบุคลิกบอท (System Instruction)
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              โหลดตัวอย่าง
            </Button>
          </div>
          <CardDescription>
            กำหนดบทบาท น้ำเสียง หางเสียง (ค่ะ/นะคะ) ข้อห้ามตอบราคาหน้าโพสต์ และข้อปฏิบัติของแอดมิน
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={7}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="ใส่คำสั่งสอนบุคลิกบอทที่นี่..."
            className="font-mono text-xs leading-relaxed"
          />
        </CardContent>
      </Card>

      {/* 3. Knowledge Base (คลังความรู้ร้านค้าและสินค้า) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="size-4 text-primary" />
              3. คลังความรู้ร้านค้าและสินค้า (Knowledge Base)
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setKnowledge(DEFAULT_KNOWLEDGE_BASE)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              โหลดตัวอย่าง
            </Button>
          </div>
          <CardDescription>
            ข้อมูลที่ต้องการให้ AI จดจำและใช้อ้างอิง เช่น รายละเอียดสินค้า ราคา โปรโมชั่น นโยบายจัดส่ง เคลมสินค้า และคำถามพบบ่อย (FAQ)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={8}
            value={knowledge}
            onChange={(e) => setKnowledge(e.target.value)}
            placeholder="ใส่ข้อมูลสินค้าและนโยบายร้านค้าที่นี่ เพื่อให้ AI ใช้อ้างอิงตอบลูกค้า..."
            className="font-mono text-xs leading-relaxed"
          />
        </CardContent>
      </Card>

      {/* 4. จุดใช้งาน AI — ลิงก์ไปหน้าตั้งค่าบอท */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sliders className="size-4 text-primary" />
            4. จุดใช้งาน AI ในระบบ
          </CardTitle>
          <CardDescription>
            เปิด/ปิดและตั้งค่าละเอียดของแต่ละบอทได้ที่หน้าตั้งค่าบอท
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Link
            href="/settings/autoreply?tab=chat"
            className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-blue-500" />
              <div className="flex flex-col">
                <span className="text-sm font-medium">💬 บอทแชท + ผู้ช่วย AI</span>
                <span className="text-xs text-muted-foreground">ตอบแชทอัตโนมัติ & แนะนำคำตอบในอินบ็อกซ์</span>
              </div>
            </div>
            <ExternalLink className="size-4 text-muted-foreground" />
          </Link>
          <Link
            href="/settings/autoreply?tab=comments"
            className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-orange-500" />
              <div className="flex flex-col">
                <span className="text-sm font-medium">📝 บอทคอมเมนต์</span>
                <span className="text-xs text-muted-foreground">กดไลก์ ตอบคอมเมนต์ ดึงเข้าแชท ส่งเมนูสินค้า</span>
              </div>
            </div>
            <ExternalLink className="size-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      {/* 5. Playground ทดสอบการตอบของ AI ทันที */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-primary">
            <Play className="size-4 fill-current" />
            5. ห้องทดลองเทรนบอท (AI Playground)
          </CardTitle>
          <CardDescription>
            ทดลองพิมพ์ข้อความจำลอง → ดูคำตอบ AI → แก้ไขให้ถูกต้อง → บันทึกเป็นตัวอย่างลงคลังความรู้
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="test-input" className="text-xs font-semibold">ข้อความจำลองของลูกค้า:</Label>
            <div className="flex gap-2">
              <Input
                id="test-input"
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="พิมพ์ข้อความลูกค้า เช่น สนใจสินค้าตัวนี้ มีโปรอะไรบ้าง"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handlePlaygroundTest();
                }}
              />
              <Button
                onClick={handlePlaygroundTest}
                disabled={testingPlayground || !testInput.trim()}
                className="shrink-0 gap-1.5"
              >
                {testingPlayground ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                ลองให้บอทตอบ
              </Button>
            </div>
          </div>

          {testOutput && (
            <div className="mt-2 rounded-lg border bg-background p-3.5 shadow-xs">
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <Bot className="size-3.5" />
                  คำตอบจาก AI ({model}):
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={handlePlaygroundTest}
                  disabled={testingPlayground}
                >
                  <RefreshCw className={`size-3 ${testingPlayground ? 'animate-spin' : ''}`} />
                  ตอบใหม่
                </Button>
              </div>
              <Textarea
                value={testOutput}
                onChange={(e) => setTestOutput(e.target.value)}
                className="min-h-[80px] text-sm leading-relaxed"
                placeholder="แก้ไขคำตอบให้ถูกต้องตามที่ต้องการ"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  ✏️ แก้ไขคำตอบด้านบนให้ถูกต้อง แล้วกด &quot;บันทึกเป็นตัวอย่าง&quot; เพื่อสอน AI
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  onClick={handleSaveExample}
                  disabled={savingExample}
                >
                  {savingExample ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                  บันทึกเป็นตัวอย่าง
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
