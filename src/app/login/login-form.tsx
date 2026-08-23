'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, LogIn, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * ฟอร์มเข้าสู่ระบบ
 * - แสดง error เป็นภาษาไทยเสมอ (มาจาก message_th ของ API)
 * - ถ้าโดน rate limit จะบอกว่าต้องรอกี่นาที
 * - ปุ่มโชว์/ซ่อนรหัสผ่าน เพราะพิมพ์บนมือถือแล้วผิดง่าย
 */
export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get('next') || '/inbox';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setRemaining(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        setError(json?.error?.message_th ?? 'เข้าสู่ระบบไม่สำเร็จ');
        if (typeof json?.error?.remaining_attempts === 'number') {
          setRemaining(json.error.remaining_attempts);
        }
        return;
      }

      // ถ้ายังต้องเปลี่ยนรหัสผ่านครั้งแรก API จะบอกให้ไป /change-password
      const target = json.data.must_change_password ? '/change-password' : nextPath;
      router.replace(target);
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">เข้าสู่ระบบ</CardTitle>
        <CardDescription>ระบบรวมแชท Facebook + Instagram</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">อีเมล</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="password">รหัสผ่าน</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground"
                aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>
                {error}
                {remaining !== null && remaining > 0 && (
                  <span className="text-xs">เหลืออีก {remaining} ครั้งก่อนบัญชีจะถูกล็อกชั่วคราว</span>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? <Loader2 className="animate-spin" /> : <LogIn />}
            {loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </Button>

          {/* ไม่มีปุ่มสมัครสมาชิก — เจ้าของเป็นคนสร้างบัญชีให้เท่านั้น */}
          <p className="text-center text-xs text-muted-foreground">
            ลืมรหัสผ่าน? ติดต่อเจ้าของร้านให้ตั้งรหัสชั่วคราวใหม่ให้
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
