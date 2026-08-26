'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function DemoClient() {
  const [busy, setBusy] = useState<'seed' | 'reset' | null>(null);
  const router = useRouter();

  async function run(action: 'seed' | 'reset') {
    if (action === 'reset' && !confirm('ลบเฉพาะข้อมูลทดลองทั้งหมด? ข้อมูลจริงจะไม่ถูกแตะ')) return;
    setBusy(action);
    try {
      const res = await fetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error?.message_th ?? 'ทำรายการไม่สำเร็จ');
      toast.success(action === 'seed' ? 'สร้างข้อมูลทดลองครบแล้ว' : 'ลบข้อมูลทดลองแล้ว');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>ข้อมูลทดลองทั้งระบบ</CardTitle><CardDescription>สร้างเพจ ลูกค้า แชท สินค้า โปรโมชัน ออเดอร์ และชุดคำตอบ เพื่อทดลองก่อนเชื่อม Facebook จริง</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button onClick={() => void run('seed')} disabled={busy !== null}>{busy === 'seed' ? <Loader2 className="animate-spin" /> : <Database />} สร้าง/สร้างใหม่</Button>
        <Button variant="destructive" onClick={() => void run('reset')} disabled={busy !== null}>{busy === 'reset' ? <Loader2 className="animate-spin" /> : <RotateCcw />} รีเซ็ตข้อมูลทดลอง</Button>
        <p className="w-full text-xs text-muted-foreground">ปุ่มรีเซ็ตลบเฉพาะรายการที่มีรหัส DEMO เท่านั้น ข้อมูลจริงของร้านจะไม่ถูกลบ</p>
      </CardContent>
    </Card>
  );
}
