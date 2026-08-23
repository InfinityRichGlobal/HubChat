import 'server-only';
/**
 * ตัวช่วยมาตรฐานสำหรับ API route
 * -------------------------------------------------------------------------
 * ทุก endpoint ตอบรูปแบบเดียวกัน หน้าเว็บจะได้จัดการง่าย :
 *   สำเร็จ  { ok: true,  data: ... }
 *   ล้มเหลว { ok: false, error: { code, message_th } }
 *
 * ข้อความ error ต้องเป็นภาษาไทยที่แอดมินอ่านแล้วรู้ว่าต้องทำอะไรต่อ
 * ไม่ใช่ stack trace
 */
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError } from '@/lib/auth/current-admin';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(code: string, message_th: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: { code, message_th, ...extra } }, { status });
}

/** แปลง error ทุกชนิดให้เป็น response ที่ปลอดภัย — ห้ามให้รายละเอียดภายในหลุดออกไป */
export function toErrorResponse(err: unknown) {
  if (err instanceof AuthError) {
    return fail(err.reason, err.message_th, err.status);
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return fail('invalid_input', `ข้อมูลไม่ถูกต้อง: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(), 422);
  }
  console.error('[api] ข้อผิดพลาดที่ไม่ได้คาดไว้:', err);
  return fail('internal_error', 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง', 500);
}
