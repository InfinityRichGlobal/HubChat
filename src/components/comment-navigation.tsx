'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, MessageCircle, MessageSquare, Loader2 } from 'lucide-react';
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
  return <div className="space-y-1.5">
    <div className="flex flex-wrap items-center gap-1.5">
    <Button variant="outline" size="sm" className="h-7 gap-1.5 rounded-lg border-border/70 bg-background px-2.5 text-[11px] font-medium text-muted-foreground shadow-none hover:text-foreground" asChild><a href={`/api/comments/${id}/navigation?target=post`} target="_blank" rel="noreferrer"><ExternalLink className="size-3" />เปิดโพสต์ต้นทาง</a></Button>
    {platform === 'facebook' && <Button variant="outline" size="sm" className="h-7 gap-1.5 rounded-lg border-border/70 bg-background px-2.5 text-[11px] font-medium text-muted-foreground shadow-none hover:text-foreground" asChild><a href={`/api/comments/${id}/navigation?target=comment`} target="_blank" rel="noreferrer"><MessageSquare className="size-3" />ไปที่คอมเมนต์</a></Button>}
    <Button variant="secondary" size="sm" className="h-7 gap-1.5 rounded-lg bg-primary/10 px-2.5 text-[11px] font-medium text-primary shadow-none hover:bg-primary/15" disabled={busy} onClick={() => void openChat()}>{busy ? <Loader2 className="size-3 animate-spin" /> : <MessageCircle className="size-3" />}{busy ? 'กำลังหาห้องแชท…' : 'เปิดแชทคนนี้'}</Button>
    </div>
    {platform === 'instagram' && <p className="text-[11px] leading-relaxed text-muted-foreground">Instagram เปิดโพสต์ต้นทาง แล้วเลือกดูคอมเมนต์ในโพสต์</p>}
  </div>;
}
