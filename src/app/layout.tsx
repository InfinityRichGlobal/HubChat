import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: 'HubChat — รวมแชท FB + IG',
  description: 'รวมแชท Facebook และ Instagram หลายเพจไว้ที่เดียว',
};

/** ตั้งค่าให้เหมาะกับมือถือ — แอดมินไม่ได้นั่งโต๊ะ (หลักคิดข้อ 2 ของสเปก) */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#ffffff',
  viewportFit: 'cover', // กันโดนรอยบากของ iPhone บัง
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className="h-full">
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
