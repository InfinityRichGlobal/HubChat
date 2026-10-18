import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { db } from '@/lib/supabase/admin';
import { searchPattern } from '@/lib/pagination';
import { listDeletionRequests, fulfillDeletion, DeleteScopeSchema } from '@/server/compliance/data-deletion';
export const maxDuration = 60;
export async function GET(req: Request) {
  try {
    const admin = await requirePermission('admin.manage');
    const q = new URL(req.url).searchParams.get('q');
    if (q !== null) {
      if (q.trim().length < 2) return ok({ customers: [], comments: [] });
      const pattern = searchPattern(q);
      const [customers, comments] = await Promise.all([
        db().from('customers').select('id,page_id,name,recipient_name,phone').or(`name.ilike.${pattern},recipient_name.ilike.${pattern},phone.ilike.${pattern}`).order('id').limit(50),
        db().from('comments').select('id,page_id,from_name,message').or(`from_name.ilike.${pattern},message.ilike.${pattern}`).order('id').limit(50),
      ]);
      if (customers.error || comments.error) throw new Error('search failed');
      return ok({ customers: customers.data, comments: comments.data });
    }
    return ok({ requests: await listDeletionRequests(admin) });
  } catch (err) { return toErrorResponse(err); }
}
export async function POST(req: Request) {
  try {
    const admin = await requirePermission('admin.manage');
    const input = DeleteScopeSchema.parse(await req.json());
    try { return ok(await fulfillDeletion(admin, input)); }
    catch (err) { console.error('[data-deletion] Fulfillment failed', err); return fail('deletion_failed', 'ยังลบข้อมูลไม่สำเร็จ กรุณาตรวจสถานะคำขอ หากงานยังทำอยู่ให้รอ หากค้างเกิน 10 นาทีให้ลองคำขอเดิมอีกครั้ง', 409); }
  } catch (err) { return toErrorResponse(err); }
}
