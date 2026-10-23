import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { db } from '@/lib/supabase/admin';
import { getComment } from '@/server/comments/service';
import { getCommentPostPermalink, type MetaPage } from '@/server/comments/navigation';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePermission('chat.reply');
    const { id } = await ctx.params;
    const c = await getComment(admin, id);
    if (req.nextUrl.searchParams.get('target') === 'chat') {
      let conversationId = c.conversation_id;
      if (!conversationId && c.from_id) {
        // Never match names/usernames: only a platform identity on the same page.
        const customer = await db().from('customers').select('id').eq('page_id', c.page_id).eq('psid', c.from_id).maybeSingle();
        if (customer.error) throw new Error('ตรวจข้อมูลลูกค้าไม่สำเร็จ');
        if (customer.data) {
          const conv = await db().from('conversations').select('id').eq('customer_id', customer.data.id).maybeSingle();
          if (conv.error) throw new Error('ตรวจห้องแชทไม่สำเร็จ');
          conversationId = conv.data?.id ?? null;
        }
      }
      return ok({ href: conversationId ? `/inbox?c=${encodeURIComponent(conversationId)}` : null });
    }
    const result = await db().from('pages').select('id,platform,page_id,access_token').eq('id', c.page_id).single();
    if (result.error) throw new Error('อ่านข้อมูลเพจไม่สำเร็จ');
    const page = result.data as MetaPage;
    let url = c.post_permalink;
    const direct = req.nextUrl.searchParams.get('target') === 'comment';
    if (page.platform === 'instagram' && !url && c.post_id) {
      url = await getCommentPostPermalink(page, c.post_id);
    }
    if (page.platform === 'facebook') {
      if (!url && c.post_id) url = `https://www.facebook.com/${encodeURIComponent(c.post_id)}`;
      if (url && direct) {
        const parsed = new URL(url);
        parsed.searchParams.set('comment_id', c.comment_id.split('_').at(-1)!);
        url = parsed.toString();
      }
    }
    if (!url) return fail('NOT_FOUND', 'ยังไม่พบลิงก์ต้นทางของคอมเมนต์นี้', 404);
    const parsed = new URL(url);
    const domain = page.platform === 'instagram' ? 'instagram.com' : 'facebook.com';
    if (parsed.protocol !== 'https:' || !(parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) return fail('INVALID_URL', 'ลิงก์ต้นทางไม่ถูกต้อง', 400);
    return NextResponse.redirect(parsed);
  } catch (error) { return toErrorResponse(error); }
}
