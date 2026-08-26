'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type Readiness = 'CONFIGURED' | 'TESTED' | 'LIVE_VERIFIED';
type Setting = {
  key: string; label_th: string; group: string; kind: 'secret' | 'general'; configured: boolean;
  value: string | null; hint_last4: string | null; readiness: Readiness | null; updated_at: string | null;
};

type ApiResult = { ok: true; data: { settings: Setting[] } } | { ok: false; error: { message_th: string } };

export default function SystemSettingsClient() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/settings/system', { cache: 'no-store' });
    const result = await response.json() as ApiResult;
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
    return () => { alive = false; };
  }, []);

  async function call(key: string, method: 'PUT' | 'PATCH' | 'DELETE', body: object) {
    setBusy(key);
    try {
      const response = await fetch('/api/settings/system', {
        method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json() as { ok: boolean; error?: { message_th?: string } };
      if (!result.ok) throw new Error(result.error?.message_th ?? 'บันทึกไม่สำเร็จ');
      await load();
      toast.success('บันทึกแล้ว');
      if (method === 'PUT' && settings.find((s) => s.key === key)?.kind === 'secret') {
        setValues((old) => ({ ...old, [key]: '' }));
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ'); }
    finally { setBusy(null); }
  }

  const groups = [...new Set(settings.map((setting) => setting.group))];
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>ระบบ + ความลับ</CardTitle>
          <CardDescription>
            ค่าลับจะแสดงเพียงสี่ตัวท้าย ช่องว่างหมายถึงไม่เปลี่ยนค่า การลบต้องยืนยันแยกต่างหาก
          </CardDescription>
        </CardHeader>
      </Card>
      {groups.map((group) => (
        <Card key={group}>
          <CardHeader><CardTitle className="text-base">{group}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-5">
            {settings.filter((s) => s.group === group).map((setting) => {
              const next = setting.readiness === 'CONFIGURED' ? 'TESTED' : setting.readiness === 'TESTED' ? 'LIVE_VERIFIED' : null;
              return (
                <div key={setting.key} className="min-w-0 rounded-lg border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-all text-sm font-medium">{setting.label_th}</span>
                    <Badge variant={setting.configured ? 'default' : 'secondary'}>{setting.configured ? 'ตั้งค่าแล้ว' : 'ยังไม่ตั้ง'}</Badge>
                    {setting.readiness && <Badge variant="outline">{setting.readiness}</Badge>}
                    {setting.kind === 'secret' && setting.hint_last4 && <span className="text-xs text-muted-foreground">••••{setting.hint_last4}</span>}
                  </div>
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                    <Input
                      type={setting.kind === 'secret' ? 'password' : 'text'}
                      value={values[setting.key] ?? ''}
                      placeholder={setting.kind === 'secret' && setting.configured ? 'เว้นว่าง = ไม่เปลี่ยน' : 'กรอกค่า'}
                      onChange={(event) => setValues((old) => ({ ...old, [setting.key]: event.target.value }))}
                      className="min-w-0"
                    />
                    <Button disabled={busy === setting.key || !(values[setting.key] ?? '').trim()} onClick={() => call(setting.key, 'PUT', { key: setting.key, value: values[setting.key] ?? '' })}>บันทึก</Button>
                    {next && <Button variant="outline" disabled={busy === setting.key} onClick={() => call(setting.key, 'PATCH', { key: setting.key, readiness: next })}>เป็น {next}</Button>}
                    {setting.configured && <Button variant="destructive" disabled={busy === setting.key} onClick={() => {
                      if (window.prompt(`พิมพ์ ${setting.key} เพื่อยืนยันการลบ`) === setting.key) void call(setting.key, 'DELETE', { key: setting.key, confirm: setting.key });
                    }}>ลบ</Button>}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
