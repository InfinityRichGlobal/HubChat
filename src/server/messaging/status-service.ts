import 'server-only';
import { db } from '@/lib/supabase/admin';
import { canSeePage } from '@/lib/auth/permissions';
import type { PublicAdmin } from '@/types/db';
import type { SendStatus } from './store';

export const SEND_STATUS_SELECT =
  'id,conversation_id,page_id,message_type,triggered_by,status,selected_transport,policy_reason_th,network_attempts,claimed_at,finished_at,created_at,updated_at';

export type SendStatusRow = {
  id: string; conversation_id: string | null; page_id: string | null; message_type: string;
  triggered_by: string; status: SendStatus; selected_transport: string | null;
  policy_reason_th: string | null; network_attempts: number; claimed_at: string;
  finished_at: string | null; created_at: string; updated_at: string;
};

async function visiblePageIds(admin: PublicAdmin): Promise<string[]> {
  const { data, error } = await db().from('pages').select('id');
  if (error) throw new Error(`อ่านรายชื่อเพจไม่สำเร็จ: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id)
    .filter((id) => canSeePage(admin.role, admin.allowed_page_ids, id));
}

export async function listSendStatuses(admin: PublicAdmin, status?: SendStatus): Promise<SendStatusRow[]> {
  const pageIds = await visiblePageIds(admin);
  if (pageIds.length === 0) return [];
  let query = db().from('message_sends').select(SEND_STATUS_SELECT)
    .in('page_id', pageIds).order('created_at', { ascending: false }).limit(200);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(`อ่านสถานะการส่งไม่สำเร็จ: ${error.message}`);
  return (data ?? []) as SendStatusRow[];
}

export function statusLabel(status: SendStatus): { label_th: string; retry_safe: boolean } {
  const labels: Record<SendStatus, { label_th: string; retry_safe: boolean }> = {
    claimed: { label_th: 'กำลังส่ง', retry_safe: false },
    blocked_by_policy: { label_th: 'ถูกกฎบล็อก', retry_safe: false },
    succeeded: { label_th: 'ส่งแล้ว', retry_safe: false },
    permanent_failed: { label_th: 'ล้มเหลวถาวร', retry_safe: false },
    retryable_failed: { label_th: 'ล้มเหลวชั่วคราว', retry_safe: true },
    outcome_unknown: { label_th: 'ไม่ทราบผล — ห้ามส่งซ้ำ', retry_safe: false },
  };
  return labels[status];
}
