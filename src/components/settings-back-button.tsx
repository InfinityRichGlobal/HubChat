import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SettingsBackButton({ title }: { title?: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <Button variant="ghost" size="sm" asChild className="-ml-2 gap-1 text-muted-foreground hover:text-foreground">
        <Link href="/settings">
          <ChevronLeft className="size-4" />
          กลับไปหน้าตั้งค่า
        </Link>
      </Button>
      {title && <span className="text-xs text-muted-foreground">/ {title}</span>}
    </div>
  );
}
