'use client';
/** ข้อความแจ้งผลลัพธ์แบบเด้งมุมจอ — shadcn/ui + sonner */
import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    className="toaster group"
    position="top-center"
    richColors
    style={
      {
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
      } as React.CSSProperties
    }
    {...props}
  />
);

export { Toaster };
