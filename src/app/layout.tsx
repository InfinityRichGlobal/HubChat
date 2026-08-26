import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import PwaRegister from '@/components/pwa-register';
import ThemeProvider from '@/components/theme-provider';

export const metadata: Metadata = {
  title: 'HubChat — รวมแชท FB + IG',
  description: 'รวมแชท Facebook และ Instagram หลายเพจไว้ที่เดียว',
  manifest: '/manifest.json',
  applicationName: 'HubChat',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  /**
   * ⭐ สามบรรทัดนี้คือเงื่อนไขที่ iPhone ใช้ตัดสินว่า "เป็นแอปจริง" หรือไม่
   *    ถ้าขาด เพิ่มลงหน้าจอโฮมแล้วจะเปิดเป็นแท็บ Safari ธรรมดา
   *    ผลคือ 🔴 ขอสิทธิ์แจ้งเตือนไม่ได้เลยตลอดกาล
   */
  appleWebApp: {
    capable: true,
    title: 'HubChat',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
};

/** ตั้งค่าให้เหมาะกับมือถือ — แอดมินไม่ได้นั่งโต๊ะ (หลักคิดข้อ 2 ของสเปก) */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // สีแถบบนสุดตอนติดตั้งเป็นแอป — ต้องตรงกับ theme_color ใน manifest.json
  themeColor: '#111827',
  viewportFit: 'cover', // กันโดนรอยบากของ iPhone บัง
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className="h-full" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {children}
          <Toaster />
          <PwaRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
