'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';

/** ฟอร์มตั้งรหัสผ่านใหม่ */
export default function ChangePasswordForm({ forced, name }: { forced: boolean; name: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (next !== confirm) {
      setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.error?.message_th ?? 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
        return;
      }
      toast.success('เปลี่ยนรหัสผ่านเรียบร้อย');
      router.replace('/inbox');
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">ตั้งรหัสผ่านใหม่</CardTitle>
        <CardDescription>
          {forced
            ? `สวัสดีคุณ${name} — เข้าใช้ครั้งแรกต้องตั้งรหัสผ่านของตัวเองก่อน`
            : 'เปลี่ยนรหัสผ่านของบัญชีคุณ'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="current">{forced ? 'รหัสผ่านชั่วคราวที่ได้รับ' : 'รหัสผ่านปัจจุบัน'}</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="next">รหัสผ่านใหม่</Label>
            <Input
              id="next"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">อย่างน้อย 8 ตัวอักษร ห้ามเป็นตัวเลขล้วน</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm">ยืนยันรหัสผ่านใหม่</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? <Loader2 className="animate-spin" /> : <KeyRound />}
            บันทึกรหัสผ่านใหม่
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            เปลี่ยนแล้วระบบจะออกจากระบบทุกอุปกรณ์อื่นโดยอัตโนมัติ
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
