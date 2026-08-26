import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { deleteRuntimeSetting, listSafeSettings, saveRuntimeSetting, updateReadiness } from '@/server/settings/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const saveSchema = z.object({ key: z.string(), value: z.string() });
const readinessSchema = z.object({ key: z.string(), readiness: z.enum(['CONFIGURED', 'TESTED', 'LIVE_VERIFIED']) });
const deleteSchema = z.object({ key: z.string(), confirm: z.string() });

export async function GET() {
  try {
    await requireOwner();
    return ok({ settings: await listSafeSettings() });
  } catch (err) { return toErrorResponse(err); }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireOwner();
    const input = saveSchema.parse(await req.json());
    if (!input.value.trim()) return fail('blank_unchanged', 'ช่องว่างหมายถึงไม่เปลี่ยนค่า', 422);
    await saveRuntimeSetting(admin, input.key, input.value);
    return ok({ saved: true });
  } catch (err) { return toErrorResponse(err); }
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireOwner();
    const input = readinessSchema.parse(await req.json());
    await updateReadiness(admin, input.key, input.readiness);
    return ok({ updated: true });
  } catch (err) { return toErrorResponse(err); }
}

export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireOwner();
    const input = deleteSchema.parse(await req.json());
    if (input.confirm !== input.key) return fail('confirmation_required', 'พิมพ์ชื่อค่าตั้งให้ตรงเพื่อยืนยันการลบ', 422);
    await deleteRuntimeSetting(admin, input.key);
    return ok({ deleted: true });
  } catch (err) { return toErrorResponse(err); }
}
