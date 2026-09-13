'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  Heart,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Play,
  Loader2,
  MessageSquare,
  Bot,
  Sliders,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Tag,
  Gift,
  Star,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { toast } from 'sonner';
import {
  DEFAULT_ASSIST_CATEGORIES,
  DEFAULT_RELATION_CATEGORIES,
  type AiCategory,
} from '@/types/ai-assist';

type TabKey = 'assist' | 'relation' | 'global';

export default function AssistSettingsClient({ isOwner }: { isOwner: boolean }) {
  const [activeTab, setActiveTab] = useState<TabKey>('assist');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ข้อมูลหมวดหมู่
  const [assistCategories, setAssistCategories] = useState<AiCategory[]>(DEFAULT_ASSIST_CATEGORIES);
  const [relationCategories, setRelationCategories] = useState<AiCategory[]>(DEFAULT_RELATION_CATEGORIES);
  const [globalPrompt, setGlobalPrompt] = useState('');

  // Dialog เพิ่มหมวดหมู่ใหม่
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('💬');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [newCatPrompt, setNewCatPrompt] = useState('');

  // Simulator State สำหรับ AI ช่วยคิด (Reply)
  const [simReplyMsg, setSimReplyMsg] = useState('สวัสดีค่ะ มีโปร 1 แถม 1 ไหมคะ สั่งซื้อยังไง');
  const [simReplyCatId, setSimReplyCatId] = useState<string>('close_sale');
  const [simReplyLoading, setSimReplyLoading] = useState(false);
  const [simReplyOutput, setSimReplyOutput] = useState('');

  // Simulator State สำหรับข้อความสัมพันธ์ (Relationship)
  const [simRelName, setSimRelName] = useState('คุณแพรวา');
  const [simRelCatId, setSimRelCatId] = useState<string>('warm_greeting');
  const [simRelLoading, setSimRelLoading] = useState(false);
  const [simRelOutput, setSimRelOutput] = useState('');

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/assist', { cache: 'no-store' });
      const json = await res.json();
      if (json.ok && json.data) {
        if (Array.isArray(json.data.assistCategories) && json.data.assistCategories.length > 0) {
          setAssistCategories(json.data.assistCategories);
          setSimReplyCatId(json.data.assistCategories[0]?.id || 'close_sale');
        }
        if (Array.isArray(json.data.relationCategories) && json.data.relationCategories.length > 0) {
          setRelationCategories(json.data.relationCategories);
          setSimRelCatId(json.data.relationCategories[0]?.id || 'warm_greeting');
        }
        if (typeof json.data.globalPrompt === 'string') {
          setGlobalPrompt(json.data.globalPrompt);
        }
      }
    } catch {
      toast.error('โหลดการตั้งค่าหมวดหมู่ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // บันทึกหมวดหมู่ AI ช่วยคิด
  async function handleSaveAssist() {
    if (!isOwner) {
      toast.error('ต้องเป็นเจ้าของระบบ (Owner) เท่านั้นจึงจะบันทึกได้');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_assist',
          assistCategories,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success('บันทึกหมวดหมู่ AI ช่วยคิดสำเร็จ');
      } else {
        toast.error(json?.error?.message_th || 'บันทึกไม่สำเร็จ');
      }
    } catch {
      toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    } finally {
      setSaving(false);
    }
  }

  // บันทึกหมวดหมู่ข้อความสัมพันธ์
  async function handleSaveRelation() {
    if (!isOwner) {
      toast.error('ต้องเป็นเจ้าของระบบ (Owner) เท่านั้นจึงจะบันทึกได้');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_relation',
          relationCategories,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success('บันทึกหมวดหมู่ข้อความสัมพันธ์สำเร็จ');
      } else {
        toast.error(json?.error?.message_th || 'บันทึกไม่สำเร็จ');
      }
    } catch {
      toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    } finally {
      setSaving(false);
    }
  }

  // บันทึกคำสั่งสอนส่วนกลาง
  async function handleSaveGlobal() {
    if (!isOwner) {
      toast.error('ต้องเป็นเจ้าของระบบ (Owner) เท่านั้นจึงจะบันทึกได้');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_global',
          globalPrompt,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success('บันทึกคำสั่งสอนส่วนกลางสำเร็จ');
      } else {
        toast.error(json?.error?.message_th || 'บันทึกไม่สำเร็จ');
      }
    } catch {
      toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    } finally {
      setSaving(false);
    }
  }

  // เพิ่มหมวดหมู่ใหม่
  function handleAddCategory() {
    if (!newCatName.trim()) {
      toast.error('กรุณาระบุชื่อหมวดหมู่');
      return;
    }
    if (!newCatPrompt.trim()) {
      toast.error('กรุณาระบุคำสั่งสอนในหมวดหมู่นี้');
      return;
    }

    const newCat: AiCategory = {
      id: `custom_${Date.now()}`,
      name: newCatName.trim(),
      icon: newCatIcon.trim() || '💬',
      description: newCatDesc.trim(),
      prompt: newCatPrompt.trim(),
      is_default: false,
    };

    if (activeTab === 'assist') {
      setAssistCategories((prev) => [...prev, newCat]);
      toast.success(`เพิ่มหมวดหมู่ "${newCat.name}" แล้ว (อย่าลืมกดบันทึก)`);
    } else if (activeTab === 'relation') {
      setRelationCategories((prev) => [...prev, newCat]);
      toast.success(`เพิ่มหมวดหมู่ "${newCat.name}" แล้ว (อย่าลืมกดบันทึก)`);
    }

    setDialogOpen(false);
    setNewCatName('');
    setNewCatDesc('');
    setNewCatPrompt('');
  }

  // ลบหมวดหมู่
  function handleDeleteCategory(id: string, isAssist: boolean) {
    if (!window.confirm('ต้องการลบหมวดหมู่นี้ใช่หรือไม่? (กดบันทึกเพื่อมีผลถาวร)')) return;
    if (isAssist) {
      setAssistCategories((prev) => prev.filter((c) => c.id !== id));
    } else {
      setRelationCategories((prev) => prev.filter((c) => c.id !== id));
    }
    toast.info('ลบหมวดหมู่แล้ว (อย่าลืมกดบันทึก)');
  }

  // รีเซ็ตกลับเป็นค่าเริ่มต้น
  function handleResetDefaults(isAssist: boolean) {
    if (!window.confirm('ต้องการรีเซ็ตหมวดหมู่กลับเป็นค่าเริ่มต้นที่ระบบแนะนำใช่ไหม?')) return;
    if (isAssist) {
      setAssistCategories(DEFAULT_ASSIST_CATEGORIES);
    } else {
      setRelationCategories(DEFAULT_RELATION_CATEGORIES);
    }
    toast.success('รีเซ็ตเป็นค่าเริ่มต้นแล้ว (อย่าลืมกดบันทึก)');
  }

  // ทดสอบจำลองตอบแชท (Simulator Reply)
  async function handleTestSimReply() {
    if (!simReplyMsg.trim()) {
      toast.error('กรุณาพิมพ์ข้อความลูกค้าทดสอบ');
      return;
    }
    const cat = assistCategories.find((c) => c.id === simReplyCatId);
    if (!cat) return;

    setSimReplyLoading(true);
    setSimReplyOutput('');
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'playground',
          userMessage: simReplyMsg.trim(),
          systemPrompt: `คุณคือแอดมินนักขายมืออาชีพของร้านค้าออนไลน์ไทยที่สุภาพ อ่อนหวาน และเชี่ยวชาญการปิดการขาย
หน้าที่ของคุณคือร่างข้อความตอบกลับลูกค้าตามหมวดหมู่: "${cat.name}"
แนวทางการตอบของหมวดนี้: "${cat.prompt}"
${globalPrompt ? `คำสั่งสอนรวม: ${globalPrompt}` : ''}
กฎ: ตอบสุภาพ น่ารัก ลงท้าย ค่ะ/นะคะ กระชับ ไม่เยิ่นเย้อ ชวนปิดการขาย`,
        }),
      });
      const json = await res.json();
      if (json.ok && json.data?.reply) {
        setSimReplyOutput(json.data.reply);
        toast.success(`AI ร่างคำตอบตามหมวด [${cat.name}] เรียบร้อย`);
      } else {
        toast.error(json?.error?.message_th || 'AI ไม่สามารถตอบได้ ตรวจสอบ API Key');
      }
    } catch {
      toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    } finally {
      setSimReplyLoading(false);
    }
  }

  // ทดสอบจำลองข้อความสัมพันธ์ (Simulator Relation)
  async function handleTestSimRelation() {
    const cat = relationCategories.find((c) => c.id === simRelCatId);
    if (!cat) return;

    setSimRelLoading(true);
    setSimRelOutput('');
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'playground',
          userMessage: `ส่งหาลูกค้าชื่อ "${simRelName.trim() || 'ลูกค้า'}"`,
          systemPrompt: `คุณคือแอดมินร้านค้าออนไลน์ไทยที่สุภาพ อ่อนหวาน เอาใจใส่ และจริงใจกับลูกค้า
หน้าที่ของคุณคือเขียนข้อความสร้างความสัมพันธ์ตามหมวดหมู่: "${cat.name}"
แนวทางการเขียน: "${cat.prompt}"
${globalPrompt ? `คำสั่งสอนรวม: ${globalPrompt}` : ''}
กฎ: ทักทายลูกค้าโดยเรียกชื่อ "คุณ${simRelName.trim() || 'ลูกค้า'}" อย่างสุภาพ อบอุ่น เป็นธรรมชาติ ลงท้าย ค่ะ/นะคะ`,
        }),
      });
      const json = await res.json();
      if (json.ok && json.data?.reply) {
        setSimRelOutput(json.data.reply);
        toast.success(`AI ร่างข้อความตามหมวด [${cat.name}] เรียบร้อย`);
      } else {
        toast.error(json?.error?.message_th || 'AI ไม่สามารถสร้างข้อความได้');
      }
    } catch {
      toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    } finally {
      setSimRelLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-20">
      <div className="flex items-center justify-between">
        <SettingsBackButton title="AI ช่วยคิด & สานสัมพันธ์" />
        <Link
          href="/inbox"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          ไปที่ห้องแชทอินบ็อกซ์ <ArrowRight className="size-3" />
        </Link>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
          <Sparkles className="size-7 text-amber-500" />
          เทรนหมวดหมู่ AI ช่วยคิด & ข้อความสัมพันธ์
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ปรับแต่งหมวดหมู่และสอน AI สำหรับปุ่ม <strong className="text-foreground">[✨ AI ช่วยคิด]</strong> และปุ่ม <strong className="text-rose-500">[❤️ สานสัมพันธ์]</strong> ในห้องแชท เพื่อให้แอดมินกดเลือกตอบได้รวดเร็วทันใจ
        </p>
      </div>

      {/* Tab Selector */}
      <div className="flex flex-wrap gap-2 border-b pb-3">
        <Button
          type="button"
          variant={activeTab === 'assist' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('assist')}
          className="gap-2"
        >
          <Sparkles className="size-4 text-amber-500" />
          <span>หมวดหมู่ AI ช่วยคิด (ตอบแชทลูกค้า)</span>
          <Badge variant="secondary" className="ml-1 text-xs">
            {assistCategories.length}
          </Badge>
        </Button>
        <Button
          type="button"
          variant={activeTab === 'relation' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('relation')}
          className="gap-2"
        >
          <Heart className="size-4 text-rose-500" />
          <span>หมวดหมู่ข้อความสัมพันธ์ (คิดถึง/อ้อน/ติดตาม)</span>
          <Badge variant="secondary" className="ml-1 text-xs">
            {relationCategories.length}
          </Badge>
        </Button>
        <Button
          type="button"
          variant={activeTab === 'global' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('global')}
          className="gap-2"
        >
          <Sliders className="size-4" />
          <span>คำสั่งสอนส่วนกลาง (Global Rules)</span>
        </Button>
      </div>

      {/* -------------------- TAB 1: AI ช่วยคิด (Reply Modes) -------------------- */}
      {activeTab === 'assist' && (
        <div className="space-y-6">
          <Alert className="border-amber-500/30 bg-amber-500/5">
            <Sparkles className="size-4 text-amber-500" />
            <AlertTitle className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              การทำงานของปุ่ม [✨ AI ช่วยคิด] ในห้องแชท
            </AlertTitle>
            <AlertDescription className="text-xs text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
              เมื่อแอดมินกดปุ่มนี้ในห้องแชท ระบบจะเปิดเมนูให้เลือกหมวดหมู่คำตอบ โดยจะดึง<strong>ข้อความล่าสุดจากฝั่งลูกค้าเท่านั้น</strong> (ไม่นำข้อความแอดมินมาปน) ร่วมกับข้อมูลสินค้าและโปรโมชั่นจริงในร้าน มาร่างคำตอบลงกล่องพิมพ์ทันที
            </AlertDescription>
          </Alert>

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">รายการหมวดหมู่คำตอบ ({assistCategories.length} หมวด)</h2>
              <p className="text-xs text-muted-foreground">แก้ไขคำสั่งสอน (Prompt) ของแต่ละหมวดได้โดยตรง</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleResetDefaults(true)}
                className="text-xs"
                title="คืนค่าเป็นหมวดหมู่มาตรฐาน"
              >
                <RotateCcw className="size-3.5 mr-1" />
                รีเซ็ตค่าเริ่มต้น
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setNewCatIcon('💬');
                  setDialogOpen(true);
                }}
                className="gap-1.5"
              >
                <Plus className="size-4" />
                เพิ่มหมวดหมู่ใหม่
              </Button>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid gap-4">
            {assistCategories.map((cat, idx) => (
              <Card key={cat.id} className="border transition-shadow hover:shadow-xs">
                <CardHeader className="pb-3 pt-4 px-4 sm:px-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">{cat.icon}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-bold">{cat.name}</CardTitle>
                          {cat.is_default && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              มาตรฐาน
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="text-xs mt-0.5">{cat.description}</CardDescription>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleDeleteCategory(cat.id, true)}
                      title="ลบหมวดหมู่นี้"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 sm:px-6 sm:pb-5 space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                    <span>คำสั่งสอน AI ในหมวดนี้ (Prompt Instructions)</span>
                    <span className="text-[11px] text-muted-foreground/80">มีผลทันทีหลังบันทึก</span>
                  </Label>
                  <Textarea
                    value={cat.prompt}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAssistCategories((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, prompt: val } : item)),
                      );
                    }}
                    rows={2}
                    className="text-xs resize-y"
                    placeholder="ระบุสิ่งที่ต้องการให้ AI ตอบในหมวดนี้..."
                  />

                  {/* Quick Tags */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] text-muted-foreground mr-1">แทรกเทคนิคด่วน:</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = `${cat.prompt} เน้นกระตุ้นโปร 1 แถม 1 อย่างคุ้มค่า`;
                        setAssistCategories((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, prompt: next } : item)),
                        );
                      }}
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] hover:bg-accent transition"
                    >
                      + โปร 1 แถม 1
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = `${cat.prompt} ย้ำว่ามีเก็บเงินปลายทางหน้าบ้านไม่ต้องโอนก่อน`;
                        setAssistCategories((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, prompt: next } : item)),
                        );
                      }}
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] hover:bg-accent transition"
                    >
                      + เน้นเก็บปลายทาง (COD)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = `${cat.prompt} รับประกันของแท้ 100% มีรีวิวแน่น`;
                        setAssistCategories((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, prompt: next } : item)),
                        );
                      }}
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] hover:bg-accent transition"
                    >
                      + การันตีของแท้
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = `${cat.prompt} ตอบสั้นกระชับ 1-2 ประโยค ชัดเจน`;
                        setAssistCategories((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, prompt: next } : item)),
                        );
                      }}
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] hover:bg-accent transition"
                    >
                      + ตอบสั้น 1-2 ประโยค
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveAssist} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              บันทึกหมวดหมู่ AI ช่วยคิด
            </Button>
          </div>

          {/* Simulator Box */}
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-900 dark:text-amber-200">
                <Play className="size-4 text-amber-600" />
                กล่องจำลองทดสอบพลังตอบ (Live Simulator)
              </CardTitle>
              <CardDescription className="text-xs">
                ลองพิมพ์ข้อความจำลองจากลูกค้าและเลือกหมวดหมู่ เพื่อดูว่า AI จะคิดและร่างคำตอบออกมาอย่างไร
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">ข้อความจำลองของลูกค้า</Label>
                <Input
                  value={simReplyMsg}
                  onChange={(e) => setSimReplyMsg(e.target.value)}
                  placeholder="เช่น สวัสดีค่ะ มีสินค้าพร้อมส่งไหมคะ มีโปรอะไรบ้าง"
                  className="mt-1 text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-48">
                  <Label className="text-xs">เลือกหมวดหมู่ที่จะทดสอบ</Label>
                  <Select value={simReplyCatId} onValueChange={setSimReplyCatId}>
                    <SelectTrigger className="mt-1 h-9 text-xs">
                      <SelectValue placeholder="เลือกหมวดหมู่" />
                    </SelectTrigger>
                    <SelectContent>
                      {assistCategories.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.icon} {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  type="button"
                  onClick={handleTestSimReply}
                  disabled={simReplyLoading}
                  className="mt-5 h-9 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs"
                >
                  {simReplyLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  ทดสอบให้ AI ช่วยคิด
                </Button>
              </div>

              {simReplyOutput && (
                <div className="mt-3 rounded-md border bg-background p-3 space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-600" />
                    ผลลัพธ์ที่ AI ร่างลงกล่องพิมพ์:
                  </span>
                  <p className="text-xs whitespace-pre-wrap leading-relaxed text-foreground bg-muted/30 p-2.5 rounded border">
                    {simReplyOutput}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* -------------------- TAB 2: ข้อความสัมพันธ์ (Relationship Modes) -------------------- */}
      {activeTab === 'relation' && (
        <div className="space-y-6">
          <Alert className="border-rose-500/30 bg-rose-500/5">
            <Heart className="size-4 text-rose-500" />
            <AlertTitle className="text-sm font-semibold text-rose-900 dark:text-rose-200">
              การทำงานของปุ่ม [❤️ สานสัมพันธ์] ในห้องแชท
            </AlertTitle>
            <AlertDescription className="text-xs text-rose-800 dark:text-rose-300 mt-1 leading-relaxed">
              ปุ่มไอคอนหัวใจ <strong className="text-rose-600">[❤️]</strong> อยู่ในแถบเครื่องมือแชทข้างไอคอนวิดีโอ ใช้สำหรับส่งข้อความผูกสัมพันธ์ เช่น ทักทายลูกค้าเก่า, อ้อนขอยอดแจกโค้ดลับ, ติดตามผลหลังใช้สินค้า, หรือขอรีวิว โดย AI จะดึงชื่อลูกค้าและแคตตาล็อกมาร่างข้อความให้ทันที แม้ลูกค้าจะไม่ได้พิมพ์อะไรใหม่มา
            </AlertDescription>
          </Alert>

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">รายการหมวดหมู่ข้อความสัมพันธ์ ({relationCategories.length} หมวด)</h2>
              <p className="text-xs text-muted-foreground">แก้ไขคำสั่งสอน (Prompt) สำหรับการดูแลและติดตามลูกค้า</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleResetDefaults(false)}
                className="text-xs"
                title="คืนค่าเป็นหมวดหมู่มาตรฐาน"
              >
                <RotateCcw className="size-3.5 mr-1" />
                รีเซ็ตค่าเริ่มต้น
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setNewCatIcon('❤️');
                  setDialogOpen(true);
                }}
                className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
              >
                <Plus className="size-4" />
                เพิ่มหมวดหมู่ใหม่
              </Button>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid gap-4">
            {relationCategories.map((cat, idx) => (
              <Card key={cat.id} className="border transition-shadow hover:shadow-xs">
                <CardHeader className="pb-3 pt-4 px-4 sm:px-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">{cat.icon}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-bold">{cat.name}</CardTitle>
                          {cat.is_default && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              มาตรฐาน
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="text-xs mt-0.5">{cat.description}</CardDescription>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleDeleteCategory(cat.id, false)}
                      title="ลบหมวดหมู่นี้"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 sm:px-6 sm:pb-5 space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                    <span>คำสั่งสอน AI ในหมวดนี้ (Prompt Instructions)</span>
                    <span className="text-[11px] text-muted-foreground/80">มีผลทันทีหลังบันทึก</span>
                  </Label>
                  <Textarea
                    value={cat.prompt}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRelationCategories((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, prompt: val } : item)),
                      );
                    }}
                    rows={2}
                    className="text-xs resize-y"
                    placeholder="ระบุสิ่งที่ต้องการให้ AI เขียนข้อความในหมวดนี้..."
                  />

                  {/* Quick Tags */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] text-muted-foreground mr-1">แทรกเทคนิคด่วน:</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = `${cat.prompt} ทักทายเรียกชื่อลูกค้าอย่างอบอุ่น`;
                        setRelationCategories((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, prompt: next } : item)),
                        );
                      }}
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] hover:bg-accent transition"
                    >
                      + เรียกชื่อลูกค้า
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = `${cat.prompt} มอบโค้ดส่วนลดลับพิเศษเฉพาะวันนี้`;
                        setRelationCategories((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, prompt: next } : item)),
                        );
                      }}
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] hover:bg-accent transition"
                    >
                      + แจกโค้ดลับพิเศษ
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = `${cat.prompt} ขอบคุณจากใจที่ไว้วางใจสั่งซื้อ`;
                        setRelationCategories((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, prompt: next } : item)),
                        );
                      }}
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] hover:bg-accent transition"
                    >
                      + ขอบคุณความไว้วางใจ
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = `${cat.prompt} ขอความกรุณารีวิวถ่ายรูปคู่สินค้า`;
                        setRelationCategories((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, prompt: next } : item)),
                        );
                      }}
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] hover:bg-accent transition"
                    >
                      + ขอรีวิว 5 ดาว
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveRelation} disabled={saving} className="gap-2 bg-rose-600 hover:bg-rose-700 text-white">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              บันทึกหมวดหมู่ข้อความสัมพันธ์
            </Button>
          </div>

          {/* Simulator Box */}
          <Card className="border-rose-500/30 bg-rose-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-rose-900 dark:text-rose-200">
                <Play className="size-4 text-rose-600" />
                กล่องจำลองทดสอบข้อความสัมพันธ์ (Live Simulator)
              </CardTitle>
              <CardDescription className="text-xs">
                ลองระบุชื่อลูกค้าและเลือกหมวดหมู่ เพื่อดูข้อความที่ AI ร่างขึ้นมาจริง
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">ชื่อลูกค้าที่จะส่งหา</Label>
                <Input
                  value={simRelName}
                  onChange={(e) => setSimRelName(e.target.value)}
                  placeholder="เช่น คุณแพรวา หรือ คุณสมชาย"
                  className="mt-1 text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-48">
                  <Label className="text-xs">เลือกหมวดหมู่ที่จะทดสอบ</Label>
                  <Select value={simRelCatId} onValueChange={setSimRelCatId}>
                    <SelectTrigger className="mt-1 h-9 text-xs">
                      <SelectValue placeholder="เลือกหมวดหมู่" />
                    </SelectTrigger>
                    <SelectContent>
                      {relationCategories.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.icon} {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  type="button"
                  onClick={handleTestSimRelation}
                  disabled={simRelLoading}
                  className="mt-5 h-9 gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs"
                >
                  {simRelLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Heart className="size-3.5" />}
                  ทดสอบสร้างข้อความสัมพันธ์
                </Button>
              </div>

              {simRelOutput && (
                <div className="mt-3 rounded-md border bg-background p-3 space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-rose-600" />
                    ผลลัพธ์ข้อความที่ AI ร่างลงกล่องพิมพ์:
                  </span>
                  <p className="text-xs whitespace-pre-wrap leading-relaxed text-foreground bg-muted/30 p-2.5 rounded border">
                    {simRelOutput}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* -------------------- TAB 3: คำสั่งสอนส่วนกลาง (Global Rules) -------------------- */}
      {activeTab === 'global' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sliders className="size-5 text-primary" />
                คำสั่งสอนส่วนกลางสำหรับ AI ผู้ช่วยแชท (Global Prompt)
              </CardTitle>
              <CardDescription className="text-xs">
                คำสั่งสอนในส่วนนี้จะถูกแนบไปกับทุกหมวดหมู่ (ทั้ง AI ช่วยคิด และข้อความสัมพันธ์) เพื่อคุมโทนเสียง กฎเหล็ก และมารยาทของแอดมิน
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs font-semibold">กฎเหล็กและมารยาทที่ต้องปฏิบัติทุกครั้ง</Label>
                <Textarea
                  value={globalPrompt}
                  onChange={(e) => setGlobalPrompt(e.target.value)}
                  rows={6}
                  placeholder={`ตัวอย่างคำสั่งสอนส่วนกลาง:
- พูดจาด้วยน้ำเสียงสุภาพ อ่อนหวาน นุ่มนวล เสมือนแอดมินหญิงใจดี
- ใช้คำลงท้าย "ค่ะ" หรือ "นะคะ" อย่างเป็นธรรมชาติ
- ห้ามพูดคำหยาบ ห้ามใส่อารมณ์ และห้ามพาดพิงแบรนด์อื่น
- หากลูกค้าสอบถามสินค้าที่ไม่มีในแคตตาล็อก ให้แจ้งว่าสินค้าหมดและแนะนำสินค้าใกล้เคียงอย่างสุภาพ`}
                  className="mt-1.5 text-xs leading-relaxed"
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveGlobal} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  บันทึกคำสั่งสอนส่วนกลาง
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Modal Dialog สำหรับเพิ่มหมวดหมู่ใหม่ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plus className="size-5 text-primary" />
              เพิ่มหมวดหมู่ใหม่ ({activeTab === 'assist' ? 'AI ช่วยคิด' : 'ข้อความสัมพันธ์'})
            </DialogTitle>
            <DialogDescription className="text-xs">
              กำหนดชื่อ ไอคอน และแนวทางเพื่อให้ AI ทราบว่าต้องตอบอย่างไร
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="grid grid-cols-4 gap-2">
              <div className="col-span-1">
                <Label className="text-xs">ไอคอน</Label>
                <Input
                  value={newCatIcon}
                  onChange={(e) => setNewCatIcon(e.target.value)}
                  placeholder="เช่น 💰"
                  className="mt-1 text-center text-base"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs">ชื่อหมวดหมู่</Label>
                <Input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="เช่น ปิดการขายด่วน หรือ อ้อนขอรีวิว"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">คำอธิบายสั้นๆ (แสดงในเมนู)</Label>
              <Input
                value={newCatDesc}
                onChange={(e) => setNewCatDesc(e.target.value)}
                placeholder="เช่น เน้นปิดการขาย ส่งโปรด่วนทันที"
                className="mt-1 text-xs"
              />
            </div>

            <div>
              <Label className="text-xs">คำสั่งสอน AI ในหมวดนี้ (Prompt Instructions)</Label>
              <Textarea
                value={newCatPrompt}
                onChange={(e) => setNewCatPrompt(e.target.value)}
                rows={3}
                placeholder="อธิบายว่าต้องการให้ AI ร่างข้อความสไตล์ไหน มีเทคนิคอย่างไร..."
                className="mt-1 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={handleAddCategory}>
              เพิ่มหมวดหมู่
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
