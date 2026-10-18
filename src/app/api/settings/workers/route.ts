import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { db } from '@/lib/supabase/admin';
import { getWorkerHeartbeat, heartbeatIsStale } from '@/server/workers/heartbeat';
import { z } from 'zod';
import { getRuntimeSetting } from '@/server/settings/service';
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
    const input = z.union([z.object({ id: z.number().int().positive() }), z.object({ action: z.literal('configure_schedule') })]).parse(await req.json());
    if ('action' in input) {
      const token = await getRuntimeSetting('CRON_SECRET');
      if (!token || token.length < 32) return fail('missing_worker_secret','กรุณาตั้ง CRON_SECRET อย่างน้อย 32 ตัวอักษรในระบบก่อน',422);
      // Use the deployed application's credential; local and production envs may differ.
      const origin = new URL(req.url).origin;
      const configured = await db().rpc('configure_worker_schedule',{p_app_url:origin,p_token:token});
      if (configured.error) return fail('schedule_failed','เชื่อมตารางเวลาไม่สำเร็จ กรุณาตรวจ migration และใช้โดเมน HTTPS ของระบบจริง',409);
      return ok({ configured: true });
    }
    const { id } = input;
    const { data, error } = await db().rpc('retry_failed_webhook_job',{p_id:id});
    if (error) return fail('retry_unavailable','ลองใหม่ไม่ได้ งานอาจถูกลบหรือไม่ได้อยู่ในสถานะล้มเหลว',409);
    return ok({ job_id: data });
  } catch (err) { return toErrorResponse(err); }
}
