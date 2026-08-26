'use client';
/**
 * หน้าตั้งค่าแจ้งเตือน (รอบ 10)
 * ===========================================================================
 * 🔴 หน้านี้มีหน้าที่ที่สำคัญกว่า "ตั้งค่า" คือ **อธิบายว่าทำไมยังไม่เด้ง**
 *    แจ้งเตือนเป็นของที่พังเงียบที่สุดในระบบ ผู้ใช้จะไม่มีทางรู้ว่าพัง
 *    จนกว่าจะพลาดลูกค้าไปแล้ว หน้านี้จึงต้องบอกสถานะจริงทุกชั้น :
 *      1. เซิร์ฟเวอร์ตั้งกุญแจแล้วหรือยัง
 *      2. เครื่องนี้รองรับไหม (iPhone ต้องติดตั้งลงหน้าจอโฮมก่อน)
 *      3. เครื่องนี้กดอนุญาตแล้วหรือยัง
 *      4. กดทดสอบแล้วมาจริงไหม
 *
 * ⚠️ เบราว์เซอร์ไม่ยอมให้ขอสิทธิ์แจ้งเตือนโดยที่ผู้ใช้ไม่ได้กดปุ่มเอง
 *    จึงห้ามเรียก enablePush() อัตโนมัติตอนเปิดหน้าเด็ดขาด
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, Send, Loader2, Share, PlusSquare, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  checkPushSupport, currentSubscription, disablePush, enablePush, isIos, isStandalone,
} from '@/lib/push-client';

type PrefsView = {
  enabled_events: string[];
  page_ids: string[];
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  sound_enabled: boolean;
  pages: Array<{ id: string; name: string; platform: string }>;
  events: Array<{ key: string; label_th: string }>;
};

export default function NotificationsClient({
  initial, pushConfigured, telegramConfigured, isOwner, canReply,
}: {
  initial: PrefsView;
  pushConfigured: boolean;
  telegramConfigured: boolean;
  isOwner: boolean;
  canReply: boolean;
}) {
  const [prefs, setPrefs] = useState<PrefsView>(initial);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * ⭐ รวมทุกอย่างที่ "รู้ได้เฉพาะบนเบราว์เซอร์" ไว้ในสถานะก้อนเดียว
   *    และตั้งค่ามันใน callback ของ promise ไม่ใช่ในตัว effect ตรง ๆ
   *
   *    เหตุผล 2 ข้อ :
   *      1. เซิร์ฟเวอร์ไม่รู้ว่าเครื่องผู้ใช้เป็นอะไร ถ้าเดาไปก่อนจะ hydrate ไม่ตรงกัน
   *      2. React ห้าม setState ตรง ๆ ในตัว effect เพราะทำให้ render ซ้อนกันหลายรอบ
   */
  const [browser, setBrowser] = useState<{
    support: ReturnType<typeof checkPushSupport> | null;
    installed: boolean;
    ios: boolean;
    deviceOn: boolean | null;
  }>({ support: null, installed: false, ios: false, deviceOn: null });

  const { support, installed, ios, deviceOn } = browser;
  const setDeviceOn = useCallback(
    (on: boolean) => setBrowser((b) => ({ ...b, deviceOn: on })),
    [],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const endpoint = await currentSubscription();
      if (!alive) return;
      setBrowser({
        support: checkPushSupport(),
        installed: isStandalone(),
        ios: isIos(),
        deviceOn: Boolean(endpoint),
      });
    })();
    return () => { alive = false; };
  }, []);

  const save = useCallback(async (next: PrefsView) => {
    setPrefs(next);
    setSaving(true);
    try {
      const res = await fetch('/api/notify/prefs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled_events: next.enabled_events,
          page_ids: next.page_ids,
          quiet_hours_start: next.quiet_hours_start,
          quiet_hours_end: next.quiet_hours_end,
          sound_enabled: next.sound_enabled,
        }),
      });
      const json = (await res.json()) as { ok: boolean; data?: PrefsView; error?: { message_th: string } };
      if (!json.ok) throw new Error(json.error?.message_th ?? 'บันทึกไม่สำเร็จ');
      if (json.data) setPrefs(json.data);
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }, []);

  const toggleEvent = (key: string, on: boolean) => {
    const set = new Set(prefs.enabled_events);
    if (on) set.add(key); else set.delete(key);
    void save({ ...prefs, enabled_events: [...set] });
  };

  const togglePage = (id: string, on: boolean) => {
    /**
     * 🔴 จุดที่พลาดง่ายที่สุดของหน้านี้
     *    รายการว่าง = "รับทุกเพจ" (ไม่ใช่ "ไม่รับเลย")
     *    ถ้าเขียนแบบลบออกจากเซ็ตว่างตรง ๆ ผู้ใช้จะกดปิดเพจแรกแล้ว "ไม่มีอะไรเกิดขึ้น"
     *    เพราะลบของที่ไม่มีอยู่ ผลลัพธ์ก็ยังเป็นเซ็ตว่าง = ยังรับทุกเพจเหมือนเดิม
     *    จึงต้องกาง "ทุกเพจ" ออกมาก่อน แล้วค่อยเอาอันที่ปิดออก
     */
    const base = prefs.page_ids.length === 0 ? prefs.pages.map((p) => p.id) : prefs.page_ids;
    const set = new Set(base);
    if (on) set.add(id); else set.delete(id);

    // เลือกครบทุกเพจ = กลับไปเป็น "ทุกเพจ" เพื่อให้เพจที่เพิ่มใหม่ในอนาคตติดมาเอง
    const next = set.size === prefs.pages.length ? [] : [...set];
    void save({ ...prefs, page_ids: next });
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      const r = await enablePush();
      if (!r.ok) { toast.error(r.message_th); return; }
      setDeviceOn(true);
      toast.success('เปิดแจ้งเตือนบนเครื่องนี้แล้ว — กด "ส่งทดสอบ" เพื่อดูว่ามาจริงไหม');
    } finally { setBusy(false); }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await disablePush();
      setDeviceOn(false);
      toast.success('ปิดแจ้งเตือนบนเครื่องนี้แล้ว');
    } finally { setBusy(false); }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/notify/test', { method: 'POST' });
      const json = (await res.json()) as { ok: boolean; error?: { message_th: string } };
      if (!json.ok) { toast.error(json.error?.message_th ?? 'ส่งไม่สำเร็จ'); return; }
      toast.success('ส่งแล้ว — ถ้าไม่เด้งภายใน 10 วินาที แปลว่าเครื่องนี้ยังไม่พร้อม');
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8">
      {/* ------------------------------------------------------------------ */}
      {/* สถานะเครื่องนี้ — ส่วนสำคัญที่สุดของหน้า                                 */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="size-5" /> แจ้งเตือนบนเครื่องนี้
          </CardTitle>
          <CardDescription>
            เครื่องแต่ละเครื่องต้องเปิดแยกกัน — เปิดบนมือถือแล้ว ไม่ได้แปลว่าคอมจะเด้งด้วย
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!pushConfigured && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>เซิร์ฟเวอร์ยังไม่ได้ตั้งกุญแจแจ้งเตือน</AlertTitle>
              <AlertDescription>
                เจ้าของร้านต้องรัน <code className="rounded bg-muted px-1">npm run vapid</code> แล้วเอาค่าที่ได้ใส่ใน
                .env.local จากนั้นรีสตาร์ตเซิร์ฟเวอร์ — วิธีละเอียดอยู่ที่ docs/NOTIFICATIONS.md
              </AlertDescription>
            </Alert>
          )}

          {/* ⭐ กล่องสอนติดตั้งบน iPhone — ข้อจำกัดของ Apple ไม่ใช่บั๊กของเรา */}
          {ios && !installed && (
            <Alert>
              <Share className="size-4" />
              <AlertTitle>iPhone ต้อง &quot;เพิ่มลงหน้าจอโฮม&quot; ก่อน</AlertTitle>
              <AlertDescription className="flex flex-col gap-1">
                <span>Apple ไม่อนุญาตให้เว็บที่เปิดในแท็บ Safari ส่งแจ้งเตือน ต้องติดตั้งเป็นแอปก่อนเท่านั้น</span>
                <span className="flex items-center gap-1 text-sm">
                  1. กดปุ่ม <Share className="inline size-4" /> (แชร์) ที่แถบล่างของ Safari
                </span>
                <span className="flex items-center gap-1 text-sm">
                  2. เลื่อนลงหา <PlusSquare className="inline size-4" /> &quot;เพิ่มไปยังหน้าจอโฮม&quot;
                </span>
                <span className="text-sm">3. เปิดแอป HubChat จากหน้าจอโฮม แล้วกลับมาหน้านี้อีกครั้ง</span>
              </AlertDescription>
            </Alert>
          )}

          {support && !support.ok && support.reason !== 'ios_needs_install' && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>เครื่องนี้เปิดแจ้งเตือนไม่ได้</AlertTitle>
              <AlertDescription>{support.message_th}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {deviceOn === null ? (
              <Badge variant="secondary" className="gap-1">
                <Loader2 className="size-3 animate-spin" /> กำลังตรวจ
              </Badge>
            ) : deviceOn ? (
              <Badge className="gap-1">
                <CheckCircle2 className="size-3" /> เปิดอยู่บนเครื่องนี้
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <BellOff className="size-3" /> ยังไม่ได้เปิด
              </Badge>
            )}
            {installed && <Badge variant="outline">ติดตั้งเป็นแอปแล้ว</Badge>}
          </div>

          <div className="flex flex-wrap gap-2">
            {deviceOn ? (
              <Button variant="outline" onClick={turnOff} disabled={busy}>
                <BellOff className="size-4" /> ปิดบนเครื่องนี้
              </Button>
            ) : (
              <Button onClick={turnOn} disabled={busy || !pushConfigured || (support ? !support.ok : true)}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
                เปิดแจ้งเตือนบนเครื่องนี้
              </Button>
            )}
            <Button variant="outline" onClick={sendTest} disabled={busy || !deviceOn}>
              <Send className="size-4" /> ส่งทดสอบ
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* เรื่องที่อยากรู้                                                       */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>เรื่องที่อยากให้เตือน</CardTitle>
          <CardDescription>
            {canReply
              ? 'ปิดเรื่องที่ไม่เกี่ยวกับเราได้ จะได้ไม่โดนกวนจนต้องปิดทั้งหมด'
              : '⚠️ บัญชีผู้ดูตอบแชทไม่ได้ จึงไม่ได้รับแจ้งเตือนเรื่องแชท'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {prefs.events.map((ev) => (
            <div key={ev.key} className="flex items-center justify-between gap-3 py-3">
              <Label htmlFor={`ev-${ev.key}`} className="flex-1 font-normal">{ev.label_th}</Label>
              <Switch
                id={`ev-${ev.key}`}
                checked={prefs.enabled_events.includes(ev.key)}
                onCheckedChange={(v) => toggleEvent(ev.key, v)}
                disabled={saving || !canReply}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* เพจ                                                                 */}
      {/* ------------------------------------------------------------------ */}
      {prefs.pages.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>เพจที่อยากรับแจ้งเตือน</CardTitle>
            <CardDescription>ไม่เลือกเลย = รับทุกเพจที่มีสิทธิ์ดู</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {prefs.pages.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-3">
                <Label htmlFor={`pg-${p.id}`} className="flex-1 font-normal">
                  {p.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {p.platform === 'instagram' ? 'Instagram' : 'Facebook'}
                  </span>
                </Label>
                <Switch
                  id={`pg-${p.id}`}
                  checked={prefs.page_ids.length === 0 || prefs.page_ids.includes(p.id)}
                  onCheckedChange={(v) => togglePage(p.id, v)}
                  disabled={saving}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* ช่วงเวลาห้ามรบกวน                                                     */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>ช่วงเวลาห้ามรบกวน</CardTitle>
          <CardDescription>
            ในช่วงนี้จะไม่มีอะไรเด้งบนหน้าจอ แต่ยังส่งเข้ากลุ่ม Telegram ตามปกติ
            เพื่อให้ย้อนดูตอนเช้าได้ว่ามีใครทักมาบ้าง
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="qs">ตั้งแต่</Label>
            <Input
              id="qs" type="time" className="w-32"
              value={prefs.quiet_hours_start ?? ''}
              onChange={(e) => setPrefs({ ...prefs, quiet_hours_start: e.target.value || null })}
              onBlur={() => save(prefs)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="qe">ถึง</Label>
            <Input
              id="qe" type="time" className="w-32"
              value={prefs.quiet_hours_end ?? ''}
              onChange={(e) => setPrefs({ ...prefs, quiet_hours_end: e.target.value || null })}
              onBlur={() => save(prefs)}
            />
          </div>
          <Button
            variant="ghost"
            onClick={() => save({ ...prefs, quiet_hours_start: null, quiet_hours_end: null })}
            disabled={saving}
          >
            ไม่ใช้
          </Button>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Telegram — เจ้าของร้านเท่านั้น                                        */}
      {/* ------------------------------------------------------------------ */}
      {isOwner && <TelegramCard configured={telegramConfigured} />}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function TelegramCard({ configured }: { configured: boolean }) {
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Array<{ chat_id: string; title: string }> | null>(null);

  const test = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/notify/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message_th: string } };
      if (!json.ok) toast.error(json.error?.message_th ?? 'ส่งไม่สำเร็จ');
      else toast.success('ส่งเข้ากลุ่มแล้ว — ไปดูในกลุ่ม Telegram ได้เลย');
    } finally { setBusy(false); }
  };

  const discover = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/notify/telegram');
      const json = (await res.json()) as {
        ok: boolean;
        data?: { chats: Array<{ chat_id: string; title: string }> };
        error?: { message_th: string };
      };
      if (!json.ok) { toast.error(json.error?.message_th ?? 'ค้นหาไม่สำเร็จ'); return; }
      setFound(json.data?.chats ?? []);
      if ((json.data?.chats ?? []).length === 0) {
        toast.info('ยังไม่เจอกลุ่มไหนเลย — ลองพิมพ์อะไรสักคำในกลุ่มที่เชิญบอทไว้ แล้วกดใหม่');
      }
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>กลุ่ม Telegram</CardTitle>
        <CardDescription>
          ตาข่ายกันพลาดชั้นสอง — ถ้ามือถือใครเงียบ อย่างน้อยยังมีในกลุ่มให้ย้อนดู
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          {configured ? (
            <Badge className="gap-1"><CheckCircle2 className="size-3" /> ตั้งค่าแล้ว</Badge>
          ) : (
            <Badge variant="secondary">ยังไม่ได้ตั้งค่า</Badge>
          )}
        </div>

        {!configured && (
          <Alert>
            <AlertTitle>วิธีตั้ง (ทำครั้งเดียว)</AlertTitle>
            <AlertDescription className="flex flex-col gap-1 text-sm">
              <span>1. ทักหา @BotFather ใน Telegram → /newbot → ได้ token มา</span>
              <span>2. ใส่ TELEGRAM_BOT_TOKEN ใน .env.local แล้วรีสตาร์ตเซิร์ฟเวอร์</span>
              <span>3. สร้างกลุ่ม เชิญบอทเข้ากลุ่ม แล้วพิมพ์อะไรสักคำในกลุ่ม</span>
              <span>4. กดปุ่ม &quot;ค้นหากลุ่ม&quot; ข้างล่าง แล้วเอาเลขที่ได้ใส่ TELEGRAM_CHAT_ID</span>
              <span className="text-muted-foreground">⚠️ chat id ของกลุ่มเป็นเลขติดลบเสมอ เช่น -1001234567890</span>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={discover} disabled={busy}>ค้นหากลุ่ม</Button>
          <Button variant="outline" onClick={test} disabled={busy || !configured}>
            <Send className="size-4" /> ส่งทดสอบเข้ากลุ่ม
          </Button>
        </div>

        {found && found.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-2 text-sm">
              {found.map((c) => (
                <div key={c.chat_id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <code className="rounded bg-muted px-2 py-1 text-xs">{c.chat_id}</code>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                เอาเลขนี้ไปใส่ TELEGRAM_CHAT_ID ใน .env.local แล้วรีสตาร์ตเซิร์ฟเวอร์
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
