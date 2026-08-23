import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { can } from '@/lib/auth/permissions';
import { db } from '@/lib/supabase/admin';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * Activity log — สเปกหัวข้อ 5.7
 * ใครแก้/ลบอะไร เข้าสู่ระบบจาก IP ไหน เมื่อไหร่
 */
export const dynamic = 'force-dynamic';

/** แปลชื่อ action เป็นภาษาไทย */
const ACTION_TH: Record<string, string> = {
  'login.success': 'เข้าสู่ระบบสำเร็จ',
  'login.failed': 'เข้าสู่ระบบไม่สำเร็จ',
  'login.blocked': 'ถูกล็อกเพราะลองหลายครั้ง',
  logout: 'ออกจากระบบ',
  'password.changed': 'เปลี่ยนรหัสผ่าน',
  'admin.created': 'สร้างแอดมิน',
  'admin.updated': 'แก้ไขแอดมิน',
  'admin.disabled': 'ปิดใช้งานแอดมิน',
  'admin.enabled': 'เปิดใช้งานแอดมิน',
  'admin.deleted': 'ลบแอดมิน',
  'admin.force_logout': 'เตะออกทุกอุปกรณ์',
  'admin.password_reset': 'ตั้งรหัสชั่วคราวใหม่',
  'page.connected': 'เชื่อมเพจ',
  'page.disconnected': 'ตัดการเชื่อมเพจ',
};

type LogRow = {
  id: string;
  admin_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip_address: string | null;
  created_at: string;
  admins: { name: string; email: string } | null;
};

export default async function ActivityPage() {
  const result = await getCurrentAdmin();
  if (!result.ok) redirect('/login');
  if (!can(result.admin.role, 'activity.view')) redirect('/settings');

  const { data } = await db()
    .from('activity_logs')
    .select('id,admin_id,action,target_type,target_id,ip_address,created_at,admins(name,email)')
    .order('created_at', { ascending: false })
    .limit(200);

  const logs = (data ?? []) as unknown as LogRow[];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>ประวัติการใช้งาน</CardTitle>
          <CardDescription>แสดง 200 รายการล่าสุด</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เวลา</TableHead>
              <TableHead>ใคร</TableHead>
              <TableHead>ทำอะไร</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  ยังไม่มีประวัติ
                </TableCell>
              </TableRow>
            )}
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(log.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">{log.admins?.name ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={log.action.startsWith('login.failed') || log.action.includes('delete') ? 'destructive' : 'secondary'}>
                    {ACTION_TH[log.action] ?? log.action}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {log.ip_address ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
