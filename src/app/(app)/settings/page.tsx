import Link from 'next/link';
import { ChevronRight, Users, ScrollText, Store, MessageSquareText, Bell, Package, Bot, ShieldCheck, Send } from 'lucide-react';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can, ROLE_LABEL_TH, ROLE_DESCRIPTION_TH } from '@/lib/auth/permissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { redirect } from 'next/navigation';

/**
 * หน้าตั้งค่า — สเปกหัวข้อ 5.6
 * รอบนี้เปิดใช้จริงเฉพาะ "แอดมิน + สิทธิ์" (5.7) กับ "ประวัติการใช้งาน"
 * ที่เหลือขึ้นเป็นรายการไว้ให้เห็นภาพว่าจะมาในรอบไหน
 */
export default async function SettingsPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  const admin = result.admin;

  const ready = [
    {
      href: '/send-status', icon: Send, title: 'สถานะการส่ง',
      description: 'ดูว่าส่งแล้ว ถูกกฎบล็อก ล้มเหลว หรือไม่ทราบผล', show: true,
    },
    {
      href: '/settings/system',
      icon: ShieldCheck,
      title: 'ระบบ + ความลับ',
      description: 'ตั้งค่า Meta, ที่เก็บไฟล์ และแจ้งเตือน โดยไม่ต้องแก้ไฟล์บนเซิร์ฟเวอร์',
      show: admin.role === 'owner',
    },
    {
      href: '/settings/pages',
      icon: Store,
      title: 'จัดการเพจ',
      description: 'เชื่อมเพจ Facebook / Instagram ใส่ token และทดสอบการเชื่อมต่อ',
      show: can(admin.role, 'page.manage'),
    },
    {
      href: '/settings/admins',
      icon: Users,
      title: 'แอดมิน + สิทธิ์',
      description: 'เพิ่ม/ปิดใช้งานแอดมิน กำหนดเพจที่เห็น เตะออกทุกอุปกรณ์',
      show: can(admin.role, 'admin.manage'),
    },
    {
      href: '/settings/content',
      icon: MessageSquareText,
      title: 'ชุดคำตอบ + แท็ก',
      description: 'ข้อความสำเร็จรูปที่เรียกด้วย / และแท็กไว้จัดกลุ่มแชท',
      show: can(admin.role, 'content.view'),
    },
    {
      href: '/settings/catalog',
      icon: Package,
      title: 'สินค้า + โปรโมชัน',
      description: 'สี/ราคาสินค้า และรูปแบบโปร (เดี่ยว / แพ็ก / ซื้อ X แถม Y / บ็อกซ์เซ็ต)',
      show: can(admin.role, 'content.view'),
    },
    {
      href: '/settings/autoreply',
      icon: Bot,
      title: 'ตอบอัตโนมัติ (คีย์เวิร์ด)',
      description: '🔴 ส่วนเดียวที่ระบบพิมพ์หาลูกค้าเอง — ตั้งกฎ ดูประวัติ เปิด/ปิดได้ทันที',
      show: can(admin.role, 'content.view'),
    },
    {
      href: '/settings/notifications',
      icon: Bell,
      title: 'แจ้งเตือน',
      description: 'เปิดแจ้งเตือนบนมือถือ เลือกเรื่องที่อยากรู้ ตั้งช่วงเวลาห้ามรบกวน',
      show: true,
    },
    {
      href: '/settings/activity',
      icon: ScrollText,
      title: 'ประวัติการใช้งาน',
      description: 'ใครแก้/ลบอะไร เข้าสู่ระบบจาก IP ไหน เมื่อไหร่',
      show: can(admin.role, 'activity.view'),
    },
  ].filter((i) => i.show);

  /**
   * รอบ 7-10 ทำครบทุกข้อในรายการนี้แล้ว จึงไม่มีหัวข้อ "กำลังจะมา" อีกต่อไป
   * ถ้าจะเพิ่มของใหม่ในอนาคต ให้เอาโครงเดิมจาก git history มาใช้ได้
   */

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>บัญชีของฉัน</CardTitle>
          <CardDescription>{admin.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge>{ROLE_LABEL_TH[admin.role]}</Badge>
            <span className="text-sm text-muted-foreground">{ROLE_DESCRIPTION_TH[admin.role]}</span>
          </div>
        </CardContent>
      </Card>

      {ready.length > 0 && (
        <Card className="py-0">
          <div className="divide-y">
            {ready.map((item) => (
              <Link key={item.href} href={item.href} className="flex items-center gap-3 px-4 py-4 hover:bg-accent/50">
                <item.icon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="text-xs text-muted-foreground">{item.description}</div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </Card>
      )}

    </div>
  );
}
