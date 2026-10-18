import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { db } from '@/lib/supabase/admin';
import { getWorkerHeartbeat, heartbeatIsStale } from '@/server/workers/heartbeat';
import { z } from 'zod';
export async function GET() {
  try {
    await requirePermission('page.manage');
    const [ingest, notifications, schedule, failed, pending] = await Promise.all([
      getWorkerHeartbeat('ingest'), getWorkerHeartbeat('notifications'), db().rpc('worker_schedule_status'),
      db().from('webhook_queue').select('id,attempts,processed_at,error_message,retried_as').eq('status','failed').order('id',{ascending:false}).limit(30),
      db().from('webhook_queue').select('id',{head:true,count:'exact'}).in('status',['pending','processing']),
    ]);
    if (schedule.error || failed.error || pending.error) throw new Error('อ่านสถานะคิวไม่สำเร็จ');
    return ok({ workers: [ingest, notifications].map((heartbeat,i) => ({ name: i === 0 ? 'ingest' : 'notifications', heartbeat, stale: heartbeatIsStale(heartbeat) })), schedule: schedule.data, failed: failed.data, pending: pending.count });
  } catch (err) { return toErrorResponse(err); }
}
export async function POST(req: Request) {
  try {
    await requirePermission('page.manage');
    const { id } = z.object({ id: z.number().int().positive() }).parse(await req.json());
    const { data, error } = await db().rpc('retry_failed_webhook_job',{p_id:id});
    if (error) return fail('retry_unavailable','ลองใหม่ไม่ได้ งานอาจถูกลบหรือไม่ได้อยู่ในสถานะล้มเหลว',409);
    return ok({ job_id: data });
  } catch (err) { return toErrorResponse(err); }
}
