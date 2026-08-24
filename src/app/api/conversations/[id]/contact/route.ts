/**
 * /api/conversations/[id]/contact — ที่อยู่ / เบอร์ของลูกค้า (สเปกหัวข้อ 5.2)
 *
 * GET   : ข้อมูลปัจจุบัน + ผลการดึงจากข้อความที่ส่งมา (ถ้ามี)
 * PATCH : บันทึกค่าที่ "แอดมินตรวจแล้ว"
 *
 * 🔴 ระบบไม่เขียนทับข้อมูลลูกค้าจากตัวดึงอัตโนมัติเองเด็ดขาด
 *    ตัวดึงเป็นแค่ตัวช่วยกรอก แอดมินต้องกดยืนยันเสมอ (สเปกเขียนไว้ตัวหนา)
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { getCustomerContact, InboxAccessError, updateCustomerContact } from '@/server/inbox/service';
import { extractAddress } from '@/server/extract/address';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;

    const current = await getCustomerContact(admin, id);
    // ส่งข้อความที่จะให้ดึงมาทาง query ได้ (มาจากเมนู "ดึงที่อยู่+เบอร์" ของข้อความนั้น)
    const source = req.nextUrl.searchParams.get('from');
    const extracted = source ? extractAddress(source) : null;

    return ok({ current, extracted });
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}

const patchSchema = z.object({
  recipient_name: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  postcode: z.string().trim().max(10).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json());

    await updateCustomerContact(admin, id, body);
    const current = await getCustomerContact(admin, id);
    return ok({ current });
  } catch (err) {
    if (err instanceof InboxAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
