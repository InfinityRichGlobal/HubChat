'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
export default function CommentNavigation({ id, platform }: { id: string; platform?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function openChat() {
    setBusy(true);
    try {
      const response = await fetch(`/api/comments/${id}/navigation?target=chat`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message_th ?? 'เปิดแชทไม่สำเร็จ');
      if (result.data.href) router.push(result.data.href);
      else toast.info('ยังไม่มีห้องแชทที่จับคู่กับผู้คอมเมนต์นี้ได้ เมื่อลูกค้าทักหรือตอบกลับจึงจะเปิดห้องได้');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'เปิดแชทไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-2">
    <Button variant="outline" size="sm" asChild><a href={`/api/comments/${id}/navigation?target=post`} target="_blank" rel="noreferrer"><ExternalLink className="size-3" />เปิดโพสต์ต้นทาง</a></Button>
    {platform === 'facebook' && <Button variant="outline" size="sm" asChild><a href={`/api/comments/${id}/navigation?target=comment`} target="_blank" rel="noreferrer">ไปที่คอมเมนต์</a></Button>}
    <Button variant="secondary" size="sm" disabled={busy} onClick={() => void openChat()}><MessageCircle className="size-3" />{busy ? 'กำลังหาห้องแชท…' : 'เปิดแชทคนนี้'}</Button>
    {platform === 'instagram' && <p className="w-full text-[11px] text-muted-foreground">Instagram เปิดโพสต์ต้นทาง แล้วเลือกดูคอมเมนต์ในโพสต์</p>}
  </div>;
}
