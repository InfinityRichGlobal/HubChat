import { z } from 'zod';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { linkOrderMedia, OrderAccessError } from '@/server/orders/service';

const schema = z.object({ media_id: z.string().uuid(), purpose: z.enum(['attachment', 'payment_slip']) });
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const admin = await requirePermission('order.create');
    const { id } = await ctx.params;
    const input = schema.parse(await req.json());
    await linkOrderMedia(admin, id, input.media_id, input.purpose);
    return ok({ linked: true });
  } catch (err) {
    if (err instanceof OrderAccessError) return fail('forbidden', err.message, 403);
    return toErrorResponse(err);
  }
}
