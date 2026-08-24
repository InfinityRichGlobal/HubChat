import Link from 'next/link';
import { ChevronRight, Users, ScrollText, Store, MessageSquareText, Bell, Package } from 'lucide-react';
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
      href: '/settings/activity',
      icon: ScrollText,
      title: 'ประวัติการใช้งาน',
      description: 'ใครแก้/ลบอะไร เข้าสู่ระบบจาก IP ไหน เมื่อไหร่',
      show: can(admin.role, 'activity.view'),
    },
  ].filter((i) => i.show);

  const upcoming = [
    { icon: MessageSquareText, title: 'กฎคีย์เวิร์ดตอบอัตโนมัติ', round: 'รอบ 5' },
    { icon: Package, title: 'สินค้า / โปรโมชัน / ค่าส่ง', round: 'รอบ 5' },
    { icon: Bell, title: 'แจ้งเตือน (PWA + Telegram)', round: 'รอบ 7' },
  ];

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

      <Card className="py-0">
        <div className="divide-y">
          {upcoming.map((item) => (
            <div key={item.title} className="flex items-center gap-3 px-4 py-4 opacity-60">
              <item.icon className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 text-sm">{item.title}</div>
              <Badge variant="secondary">{item.round}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
