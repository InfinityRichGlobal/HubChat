import 'server-only';
import crypto from 'node:crypto';
import { db } from '@/lib/supabase/admin';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import type { PublicAdmin } from '@/types/db';
import { z } from 'zod';
import { removeObjects } from '@/server/storage/supabase-storage';

export type ParsedSignedRequest = { user_id: string; algorithm: string; issued_at: number };
export function parseSignedRequest(signedRequest: string, appSecret: string): ParsedSignedRequest | null {
  if (signedRequest.length > 16000 || !/^[\w-]+\.[\w-]+$/.test(signedRequest)) return null;
  const [encodedSig, payload] = signedRequest.split('.');
  const sig = Buffer.from(encodedSig, 'base64url');
  const expected = crypto.createHmac('sha256', appSecret).update(payload).digest();
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.algorithm !== 'HMAC-SHA256' || !/^\d{1,50}$/.test(data.user_id) || typeof data.user_id !== 'string' || !Number.isSafeInteger(data.issued_at) || data.issued_at <= 0 || data.issued_at > Date.now() / 1000 + 300) return null;
    return { user_id: data.user_id, algorithm: data.algorithm, issued_at: data.issued_at };
  } catch { return null; }
}

/** A callback identifies an app user, not a page-scoped Messenger customer. Queue verified review. */
export async function registerDeletionRequest(parsed: ParsedSignedRequest, appSecret: string): Promise<string> {
  const requestKey = crypto.createHmac('sha256', appSecret).update(`${parsed.user_id}:${parsed.issued_at}`).digest('hex');
  const { error } = await db().from('data_deletion_requests').upsert({
    request_key: requestKey, confirmation_code: crypto.randomBytes(24).toString('hex'), subject_encrypted: encryptSecret(parsed.user_id),
  }, { onConflict: 'request_key', ignoreDuplicates: true });
  if (error) throw new Error('บันทึกคำขอลบข้อมูลไม่สำเร็จ');
  const { data, error: readError } = await db().from('data_deletion_requests').select('confirmation_code').eq('request_key', requestKey).single();
  if (readError || !data) throw new Error('อ่านรหัสยืนยันไม่สำเร็จ');
  return String(data.confirmation_code);
}

export const DELETION_STATUS: Record<string, string> = {
  pending_review: 'รับคำขอแล้ว กำลังตรวจยืนยันตัวตนและขอบเขตข้อมูล',
  processing: 'กำลังลบข้อมูลที่ตรวจยืนยันแล้ว', failed: 'ดำเนินการยังไม่สำเร็จ เจ้าหน้าที่กำลังตรวจสอบ',
  completed: 'ดำเนินการลบข้อมูลที่ตรวจยืนยันและเชื่อมโยงกับคำขอเรียบร้อยแล้ว',
};
export async function deletionStatus(code: string) {
  if (!/^[a-f0-9]{48}$/.test(code)) return null;
  const { data, error } = await db().from('data_deletion_requests').select('status,created_at,completed_at').eq('confirmation_code', code).maybeSingle();
  if (error) throw new Error('อ่านสถานะไม่สำเร็จ');
  return data ? { ...data, message: DELETION_STATUS[String(data.status)] } : null;
}
export function requireDeletionOwner(admin: PublicAdmin) {
  if (admin.role !== 'owner') throw new Error('เฉพาะเจ้าของระบบเท่านั้น');
}
export async function listDeletionRequests(admin: PublicAdmin) {
  requireDeletionOwner(admin);
  const { data, error } = await db().from('data_deletion_requests').select('id,confirmation_code,subject_encrypted,status,created_at,completed_at,verification_note,result,error_th').order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error('อ่านคำขอไม่สำเร็จ');
  return (data ?? []).map(({ subject_encrypted, ...row }) => ({ ...row, app_user_id: subject_encrypted ? decryptSecret(String(subject_encrypted)) : null }));
}
export const DeleteScopeSchema = z.object({
  request_id: z.string().uuid(), customers: z.array(z.string().uuid()).max(100), comments: z.array(z.string().uuid()).max(100),
  verification_note: z.string().trim().min(10).max(500), confirmed: z.literal(true),
});
/** Storage removal is idempotent; database deletion is atomic and never reports success after an error. */
export async function fulfillDeletion(admin: PublicAdmin, input: unknown) {
  requireDeletionOwner(admin);
  const scope = DeleteScopeSchema.parse(input);
  const prepared = await db().rpc('prepare_data_deletion', { p_request_id: scope.request_id, p_customers: scope.customers, p_comments: scope.comments, p_admin_id: admin.id, p_note: scope.verification_note });
  if (prepared.error) throw new Error(prepared.error.message);
  const manifest = prepared.data as { storage_keys: string[] };
  try {
    for (let i = 0; i < manifest.storage_keys.length; i += 100) {
      await removeObjects(manifest.storage_keys.slice(i, i + 100));
    }
    const result = await db().rpc('finish_data_deletion', { p_request_id: scope.request_id });
    if (result.error) throw new Error('ลบข้อมูลในฐานข้อมูลไม่สำเร็จ สามารถลองคำขอเดิมอีกครั้ง');
    return result.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ลบข้อมูลไม่สำเร็จ';
    await db().from('data_deletion_requests').update({ status: 'failed', error_th: message }).eq('id', scope.request_id).eq('status', 'processing');
    throw err;
  }
}
