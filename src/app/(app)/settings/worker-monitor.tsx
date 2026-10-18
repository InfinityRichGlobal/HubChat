'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
type Report = {
  workers: Array<{ name: string; stale: boolean; heartbeat: { last_success_at: string | null; last_error_summary: string | null } | null }>;
  schedule: { available: boolean; jobs: Array<{ name: string; active: boolean; schedule: string }> };
  failed: Array<{ id: number; attempts: number; processed_at: string | null; error_message: string | null; retried_as: number | null }>;
  pending: number;
};
export default function WorkerMonitor() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    try { const res = await fetch('/api/settings/workers',{cache:'no-store'}); const json = await res.json(); if (!res.ok || !json.ok) throw new Error(json.error?.message_th || 'อ่านสถานะคิวไม่สำเร็จ'); setReport(json.data); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'อ่านสถานะคิวไม่สำเร็จ'); }
  },[]);
  useEffect(() => { const initial = setTimeout(() => void load(),0); const timer = setInterval(() => void load(),60000); return () => { clearTimeout(initial); clearInterval(timer); }; },[load]);
  async function retry(id: number) {
    if (inFlight.current) return; inFlight.current=true; setBusy(true);
    try { const res = await fetch('/api/settings/workers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); const json = await res.json(); if (!res.ok || !json.ok) throw new Error(json.error?.message_th || 'ลองใหม่ไม่สำเร็จ'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'ลองใหม่ไม่สำเร็จ'); }
    finally { inFlight.current=false; setBusy(false); }
  }
  return <Card><CardHeader><CardTitle>คิวรับข้อมูลและงานเบื้องหลัง</CardTitle><CardDescription>รับแชทและคอมเมนต์ทันทีหลัง webhook · ตัวกู้คิวตรวจทุก 1 นาที · แจ้งเตือนทุก 5 นาที</CardDescription></CardHeader><CardContent className="space-y-3">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>ตรวจสถานะคิว</Button>
    {!report && !error && <p role="status" className="text-sm">กำลังตรวจสถานะ…</p>}
    {report && <><p className="text-sm">งานรอหรือกำลังประมวลผล {report.pending} รายการ · ตารางเวลา {report.schedule.jobs.filter(j=>j.active).length}/2 งาน</p><div className="grid gap-2 sm:grid-cols-2">{report.workers.map(w=><div key={w.name} className="rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><strong>{w.name==='ingest'?'รับแชท / คอมเมนต์':'แจ้งเตือน'}</strong><Badge variant={w.stale || w.heartbeat?.last_error_summary ? 'destructive':'secondary'}>{w.stale ? 'ไม่พบสัญญาณล่าสุด' : w.heartbeat?.last_error_summary ? 'รอบล่าสุดมีปัญหา':'ทำงานอยู่'}</Badge></div><p className="mt-2 text-xs text-muted-foreground">สำเร็จล่าสุด {w.heartbeat?.last_success_at ? new Date(w.heartbeat.last_success_at).toLocaleString('th-TH'):'ยังไม่มี'}</p>{w.heartbeat?.last_error_summary&&<p className="mt-1 break-words text-xs text-destructive">{w.heartbeat.last_error_summary}</p>}</div>)}</div>
      <details><summary className="cursor-pointer text-sm">งานที่ลองครบแล้วยังล้มเหลว (ล่าสุดไม่เกิน 30 รายการ)</summary><div className="mt-2 space-y-2">{report.failed.length===0?<p className="text-sm text-muted-foreground">ไม่พบงานที่ล้มเหลวถาวร</p>:report.failed.map(job=><div key={job.id} className="flex flex-wrap items-start gap-2 rounded-md border p-3"><div className="min-w-0 flex-1"><p className="text-sm">งาน #{job.id} · ลอง {job.attempts} ครั้ง</p><p className="break-words text-xs text-muted-foreground">{job.error_message}</p></div><Button size="sm" variant="outline" disabled={busy || Boolean(job.retried_as)} onClick={()=>void retry(job.id)}>{job.retried_as ? `เข้าคิว #${job.retried_as} แล้ว`:'ลองใหม่หลังแก้สาเหตุ'}</Button></div>)}</div></details>
    </>}
  </CardContent></Card>;
}
