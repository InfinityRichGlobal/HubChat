import 'server-only';
import { db } from '@/lib/supabase/admin';

export const WORKER_HEARTBEAT_SELECT =
  'worker_name,last_started_at,last_heartbeat_at,last_success_at,last_error_at,last_error_summary,detail,updated_at';

export type WorkerHeartbeat = {
  worker_name: string;
  last_started_at: string | null;
  last_heartbeat_at: string;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_summary: string | null;
  detail: Record<string, unknown>;
  updated_at: string;
};

export async function heartbeatStarted(workerName: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db().from('worker_heartbeats').upsert({
    worker_name: workerName, last_started_at: now, last_heartbeat_at: now, updated_at: now,
  }, { onConflict: 'worker_name' });
  if (error) throw new Error(`บันทึก heartbeat ${workerName} ไม่สำเร็จ: ${error.message}`);
}

export async function heartbeatFinished(workerName: string, detail: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db().from('worker_heartbeats').upsert({
    worker_name: workerName, last_heartbeat_at: now, last_success_at: now,
    last_error_at: null, last_error_summary: null, detail, updated_at: now,
  }, { onConflict: 'worker_name' });
  if (error) throw new Error(`บันทึกผล heartbeat ${workerName} ไม่สำเร็จ: ${error.message}`);
}

export async function heartbeatFailed(workerName: string, errorValue: unknown): Promise<void> {
  const now = new Date().toISOString();
  const summary = (errorValue instanceof Error ? errorValue.message : String(errorValue)).slice(0, 500);
  const { error } = await db().from('worker_heartbeats').upsert({
    worker_name: workerName, last_heartbeat_at: now, last_error_at: now,
    last_error_summary: summary, updated_at: now,
  }, { onConflict: 'worker_name' });
  if (error) console.error(`[heartbeat] บันทึกสถานะ ${workerName} ไม่สำเร็จ: ${error.message}`);
}

export async function getWorkerHeartbeat(workerName: string): Promise<WorkerHeartbeat | null> {
  const { data, error } = await db().from('worker_heartbeats')
    .select(WORKER_HEARTBEAT_SELECT).eq('worker_name', workerName).maybeSingle();
  if (error) throw new Error(`อ่าน heartbeat ${workerName} ไม่สำเร็จ: ${error.message}`);
  return data as WorkerHeartbeat | null;
}

export function heartbeatIsStale(heartbeat: WorkerHeartbeat | null, now = Date.now()): boolean {
  if (!heartbeat) return true;
  return now - new Date(heartbeat.last_heartbeat_at).getTime() > 30 * 60 * 1000;
}
