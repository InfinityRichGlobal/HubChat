'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import ImageUploadCrop from '@/components/image-upload-crop';
import SettingsBackButton from '@/components/settings-back-button';
import { Bot, ArrowRight } from 'lucide-react';

type Setting = {
  key: string;
  label_th: string;
  group: string;
  kind: 'secret' | 'general';
  configured: boolean;
  value: string | null;
  hint_last4: string | null;
  updated_at: string | null;
};

type ApiResult = { ok: true; data: { settings: Setting[] } } | { ok: false; error: { message_th: string } };

export default function SystemSettingsClient() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/settings/system', { cache: 'no-store' });
    const result = (await response.json()) as ApiResult;
    if (!result.ok) throw new Error(result.error.message_th);
    setSettings(result.data.settings);
    setValues(Object.fromEntries(result.data.settings.filter((s) => s.kind === 'general').map((s) => [s.key, s.value ?? ''])));
  }, []);

  useEffect(() => {
    let alive = true;
    void fetch('/api/settings/system', { cache: 'no-store' })
      .then((response) => response.json() as Promise<ApiResult>)
      .then((result) => {
        if (!alive) return;
        if (!result.ok) throw new Error(result.error.message_th);
        setSettings(result.data.settings);
        setValues(Object.fromEntries(result.data.settings.filter((s) => s.kind === 'general').map((s) => [s.key, s.value ?? ''])));
      })
      .catch((err: Error) => toast.error(err.message));
    return () => {
      alive = false;
    };
  }, []);

  async function call(key: string, method: 'PUT' | 'DELETE', body: object) {
    setBusy(key);
    try {
      const response = await fetch('/api/settings/system', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { ok: boolean; error?: { message_th?: string } };
      if (!result.ok) throw new Error(result.error?.message_th ?? 'บันทึกไม่สำเร็จ');
      await load();
      toast.success('บันทึกเรียบร้อย');
      if (method === 'PUT' && settings.find((s) => s.key === key)?.kind === 'secret') {
        setValues((old) => ({ ...old, [key]: '' }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  // กรองกลุ่ม AI ออก เพราะย้ายไปหน้า /settings/ai ที่มีความสามารถครอบคลุมกว่าแล้ว
  const groups = [...new Set(settings.map((setting) => setting.group))].filter((group) => group !== 'AI');

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <SettingsBackButton title="ระบบ + ความลับ" />
      <Card>
        <CardHeader>
          <CardTitle>ระบบ + ความลับ</CardTitle>
          <CardDescription>
            ค่าสำคัญของระบบ (Meta, Web Push Notifications, แอปพลิเคชัน) ค่าความลับจะแสดงเพียง 4 ตัวท้ายเพื่อความปลอดภัย
          </CardDescription>
        </CardHeader>
      </Card>

      {/* แบนเนอร์แจ้งการย้าย AI ไปยังหน้าเฉพาะ */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot className="size-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">การตั้งค่า AI (Gemini Flash 3.6 / 3.7)</div>
            <div className="text-xs text-muted-foreground">
              ตั้งค่า API Key, คลังความรู้สำหรับตอบลูกค้า, และทดสอบแชทบอท ได้ที่เมนูจัดการ AI โดยตรง
            </div>
          </div>
        </div>
        <Button asChild size="sm" variant="default" className="shrink-0 gap-1.5">
          <Link href="/settings/ai">
            ไปที่หน้าจัดการ AI <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>

      {groups.map((group) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle className="text-base">{group}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {settings
              .filter((s) => s.group === group)
              .map((setting) => (
                <div key={setting.key} className="min-w-0 rounded-lg border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-all text-sm font-medium">{setting.label_th}</span>
                    <Badge variant={setting.configured ? 'default' : 'secondary'}>
                      {setting.configured ? 'ตั้งค่าแล้ว' : 'ยังไม่ตั้ง'}
                    </Badge>
                    {setting.kind === 'secret' && setting.hint_last4 && (
                      <span className="text-xs text-muted-foreground">••••{setting.hint_last4}</span>
                    )}
                  </div>
                  {setting.key === 'APP_LOGO_URL' && (
                    <div className="mb-3">
                      <ImageUploadCrop
                        value={values[setting.key] || null}
                        onChange={(url) => setValues((old) => ({ ...old, [setting.key]: url ?? '' }))}
                        label="อัปโหลดโลโก้เว็บไซต์ (ครอป 1:1 จัตุรัส)"
                        size={80}
                      />
                    </div>
                  )}
                  {setting.key === 'AVATAR_DISPLAY_MODE' ? (
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between pt-1">
                      <div className="text-xs text-muted-foreground">
                        เลือกรูปแบบรูปภาพประจำตัวลูกค้าในลิสต์แชทและคอมเมนต์
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant={(values[setting.key] ?? 'platform') === 'platform' ? 'default' : 'outline'}
                          size="sm"
                          disabled={busy === setting.key}
                          onClick={() => {
                            setValues((old) => ({ ...old, [setting.key]: 'platform' }));
                            void call(setting.key, 'PUT', { key: setting.key, value: 'platform' });
                          }}
                        >
                          ภาพแพลตฟอร์ม (FB/IG)
                        </Button>
                        <Button
                          variant={(values[setting.key] ?? 'platform') === 'real_profile' ? 'default' : 'outline'}
                          size="sm"
                          disabled={busy === setting.key}
                          onClick={() => {
                            setValues((old) => ({ ...old, [setting.key]: 'real_profile' }));
                            void call(setting.key, 'PUT', { key: setting.key, value: 'real_profile' });
                          }}
                        >
                          ภาพโปรไฟล์จริง
                        </Button>
                      </div>
                    </div>
                  ) : setting.key === 'AVATAR_ORIGIN_BADGE' ? (
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between pt-1">
                      <div className="text-xs text-muted-foreground">
                        แสดงไอคอนโลโก้แพลตฟอร์ม (FB/IG) ขนาดเล็กที่มุมรูปภาพโปรไฟล์
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant={(values[setting.key] ?? 'off') === 'off' ? 'default' : 'outline'}
                          size="sm"
                          disabled={busy === setting.key}
                          onClick={() => {
                            setValues((old) => ({ ...old, [setting.key]: 'off' }));
                            void call(setting.key, 'PUT', { key: setting.key, value: 'off' });
                          }}
                        >
                          ซ่อนไอคอนมุมภาพ (Off)
                        </Button>
                        <Button
                          variant={(values[setting.key] ?? 'off') === 'on' ? 'default' : 'outline'}
                          size="sm"
                          disabled={busy === setting.key}
                          onClick={() => {
                            setValues((old) => ({ ...old, [setting.key]: 'on' }));
                            void call(setting.key, 'PUT', { key: setting.key, value: 'on' });
                          }}
                        >
                          แสดงไอคอนมุมภาพ (On)
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                      <Input
                        type={setting.kind === 'secret' ? 'password' : 'text'}
                        value={values[setting.key] ?? ''}
                        placeholder={setting.kind === 'secret' && setting.configured ? 'เว้นว่าง = ไม่เปลี่ยน' : 'กรอกค่า'}
                        onChange={(event) => setValues((old) => ({ ...old, [setting.key]: event.target.value }))}
                        className="min-w-0"
                      />
                      <Button
                        disabled={busy === setting.key || !(values[setting.key] ?? '').trim()}
                        onClick={() => call(setting.key, 'PUT', { key: setting.key, value: values[setting.key] ?? '' })}
                      >
                        บันทึก
                      </Button>
                      {setting.configured && (
                        <Button
                          variant="destructive"
                          disabled={busy === setting.key}
                          onClick={() => {
                            if (window.prompt(`พิมพ์ ${setting.key} เพื่อยืนยันการลบ`) === setting.key) {
                              void call(setting.key, 'DELETE', { key: setting.key, confirm: setting.key });
                            }
                          }}
                        >
                          ลบ
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
