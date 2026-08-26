/**
 * ปุ่ม "ลองดึงชื่ออีกครั้ง" (แก้ D-33)
 * ===========================================================================
 * ⭐ มีไว้เพื่อกรณีเดียวที่สำคัญมาก :
 *    เจ้าของร้านเพิ่งแก้สิทธิ์ Meta เสร็จ แล้วอยากเห็นผลเดี๋ยวนี้
 *    ไม่ต้องรอจังหวะถามใหม่ของระบบ (ครั้งท้าย ๆ ห่างกัน 24 ชั่วโมง)
 *
 * ⚠️ route นี้ไม่แตะชั้น Meta เอง — ส่งต่อให้ server/customers จัดการ
 *    เพราะกฎของโปรเจกต์คือ API route ห้าม import ชั้น Meta เด็ดขาด
 *    (กันไม่ให้มีใครเผลอเปิดทางลัดส่งข้อความข้าม Policy Engine ในอนาคต)
 */
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { refreshProfileForConversation } from '@/server/customers/profile-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;

    const result = await refreshProfileForConversation(admin, id);
    if (!result.ok) return fail(result.code, result.message_th, result.status);

    return ok({ synced: true, name: result.name, has_picture: result.has_picture });
  } catch (err) {
    return toErrorResponse(err);
  }
}
