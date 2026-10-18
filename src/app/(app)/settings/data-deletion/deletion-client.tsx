'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

type DeletionRequest = { id: string; status: string; created_at: string; confirmation_code: string; app_user_id: string | null; error_th: string | null };
type Candidate = { id: string; page_id: string; name?: string | null; recipient_name?: string | null; phone?: string | null; from_name?: string | null; message?: string | null };
const labels: Record<string, string> = { pending_review: 'รอตรวจตัวตน', processing: 'กำลังลบ', failed: 'ลบยังไม่สำเร็จ', completed: 'ดำเนินการแล้ว' };
async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error?.message_th || 'โหลดข้อมูลไม่สำเร็จ');
  return body.data;
}
export default function DeletionClient() {
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<DeletionRequest | null>(null);
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<{ customers: Candidate[]; comments: Candidate[] }>({ customers: [], comments: [] });
  const [choices, setChoices] = useState<{ customers: Record<string, Candidate>; comments: Record<string, Candidate> }>({ customers: {}, comments: {} });
  const [note, setNote] = useState('');
  const [verified, setVerified] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setRequests((await api('/api/settings/data-deletion')).requests); }
    catch (e) { setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try { const result = await api(`/api/settings/data-deletion?q=${encodeURIComponent(q)}`, { signal: controller.signal }); if (!controller.signal.aborted) setCandidates(result); }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'ค้นหาไม่สำเร็จ'); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q]);
  function select(request: DeletionRequest) {
    setSelected(request); setChoices({ customers: {}, comments: {} }); setNote(''); setVerified(false); setQ(''); setError('');
  }
  async function submit() {
    if (!selected || sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try {
      await api('/api/settings/data-deletion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: selected.id, customers: Object.keys(choices.customers), comments: Object.keys(choices.comments), verification_note: note, confirmed: true }) });
      setSelected(null); setConfirm(false); await refresh();
    } catch (e) { setConfirm(false); await refresh(); setError(e instanceof Error ? e.message : 'ลบไม่สำเร็จ'); }
    finally { sending.current = false; setBusy(false); }
  }
  const count = Object.keys(choices.customers).length + Object.keys(choices.comments).length;
  return <div className="space-y-4">
    <div><h1 className="text-2xl font-bold">คำขอลบข้อมูล</h1><p className="mt-1 text-sm text-muted-foreground">ตรวจตัวตนก่อนเลือกข้อมูล รหัสผู้ใช้ของแอป Meta อาจเป็นคนละรหัสกับลูกค้าในแชท</p></div>
    <Button variant="outline" onClick={() => void refresh()} disabled={loading || busy}>รีเฟรชคำขอ</Button>
    {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
    {loading ? <p role="status">กำลังโหลดคำขอ…</p> : requests.length === 0 ? <Card><CardContent className="py-8 text-center text-muted-foreground">ยังไม่มีคำขอลบข้อมูล</CardContent></Card> : <div className="space-y-2">{requests.map(r => <button key={r.id} disabled={busy} onClick={() => select(r)} className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-left ${selected?.id === r.id ? 'border-primary bg-muted' : ''}`}>
      <span className="min-w-0"><span className="block text-sm">{new Date(r.created_at).toLocaleString('th-TH')}</span><span className="break-all text-xs text-muted-foreground">รหัสยืนยัน {r.confirmation_code}</span></span><Badge variant={r.status === 'failed' ? 'destructive' : 'secondary'}>{labels[r.status]}</Badge>
    </button>)}</div>}
    {selected && selected.status !== 'completed' && <Card><CardHeader><CardTitle>ตรวจขอบเขตคำขอ</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="break-all text-sm">รหัสผู้ใช้ของแอป Meta: <span className="font-mono">{selected.app_user_id || 'ไม่พบรหัสที่แสดงได้'}</span></p>
      {selected.error_th && <p className="text-sm text-destructive">{selected.error_th}</p>}
      <p className="text-sm text-muted-foreground">ลบข้อมูลลูกค้าที่เลือก พร้อมแชท ออเดอร์ ประวัติส่ง ไฟล์ที่ผูกไว้ และคอมเมนต์ที่เลือกหรือเชื่อมโยงกับลูกค้า ตรวจคอมเมนต์ที่ไม่ผูกลูกค้าและสำเนาข้อมูลภายนอกเพิ่มเติมก่อนยืนยัน</p>
      {selected.status === 'pending_review' ? <>
        <Input value={q} onChange={e => setQ(e.target.value)} aria-label="ค้นหาข้อมูลที่จะลบ" placeholder="ค้นหาชื่อ เบอร์โทร หรือข้อความคอมเมนต์ (อย่างน้อย 2 ตัวอักษร)" />
        {(['customers', 'comments'] as const).map(kind => <section key={kind} className="space-y-2"><h2 className="text-sm font-semibold">{kind === 'customers' ? 'ลูกค้าและประวัติที่เกี่ยวข้อง' : 'คอมเมนต์เพิ่มเติม'}</h2><div className="max-h-56 overflow-y-auto rounded-md border p-2">{candidates[kind].length === 0 && <p className="text-sm text-muted-foreground">ไม่พบข้อมูลตามคำค้น</p>}{candidates[kind].map(c => <label key={c.id} className="flex cursor-pointer items-start gap-2 border-b p-2 last:border-0"><input type="checkbox" checked={Boolean(choices[kind][c.id])} onChange={e => setChoices(prev => { const group = { ...prev[kind] }; if (e.target.checked) group[c.id] = c; else delete group[c.id]; return { ...prev, [kind]: group }; })} /><span className="min-w-0 text-sm"><span>{c.name || c.recipient_name || c.from_name || 'ไม่ทราบชื่อ'}</span><span className="block break-words text-xs text-muted-foreground">{c.phone || c.message}</span><span className="block break-all text-xs text-muted-foreground">เพจ {c.page_id}</span></span></label>)}</div></section>)}
        <p className="text-sm">เลือก {count} รายการ · คำค้นใหม่จะเก็บรายการที่เลือกไว้</p>
        {count > 0 && <div className="flex flex-wrap gap-1">{Object.values(choices.customers).concat(Object.values(choices.comments)).map(c => <Badge key={c.id} variant="outline">{c.name || c.recipient_name || c.from_name || c.id}</Badge>)}</div>}
        <Button variant="ghost" size="sm" onClick={() => setChoices({ customers: {}, comments: {} })}>ล้างรายการที่เลือก</Button>
      </> : <p className="text-sm">การลองใหม่จะใช้ข้อมูลชุดเดิมที่ตรวจยืนยันไว้ หากยังทำงานอยู่ ระบบจะกันการทำซ้อน</p>}
      <label className="block space-y-1 text-sm"><span>หลักฐานการตรวจตัวตนและขอบเขต (อย่างน้อย 10 ตัวอักษร ไม่ใส่รหัสผ่านหรือเลขเอกสาร)</span><Textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} /><span>ตรวจยืนยันตัวตนและข้อมูลที่เกี่ยวข้องแล้ว{count === 0 && selected.status === 'pending_review' ? ' รวมถึงตรวจแล้วว่าไม่มีข้อมูลเชื่อมโยงกับผู้ขอ' : ''}</span></label>
      <Button variant="destructive" disabled={!verified || note.trim().length < 10 || busy} onClick={() => setConfirm(true)}>ตรวจยืนยันก่อนดำเนินการ</Button>
    </CardContent></Card>}
    <Dialog open={confirm} onOpenChange={open => { if (!busy) setConfirm(open); }}><DialogContent><DialogHeader><DialogTitle>ยืนยันดำเนินการคำขอลบข้อมูล</DialogTitle><DialogDescription>ข้อมูลที่เลือกและประวัติที่เกี่ยวข้องจะถูกลบถาวร รวมถึงแชท ออเดอร์ และไฟล์ กู้คืนผ่านหน้าระบบไม่ได้ หากไม่พบข้อมูล ระบบจะบันทึกผลการตรวจตามขอบเขตที่คุณยืนยัน</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>กลับไปตรวจ</Button><Button variant="destructive" disabled={busy} onClick={() => void submit()}>{busy ? 'กำลังดำเนินการ…' : 'ยืนยันดำเนินการ'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
