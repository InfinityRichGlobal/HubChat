'use client';
/**
 * รูปโปรไฟล์ลูกค้า พร้อมตัวสำรองเมื่อไม่มีรูป
 * ===========================================================================
 * ⭐ ทำไมต้องมีไฟล์นี้แยก :
 *    "ไม่มีรูป" เป็นเรื่องปกติมาก (ลูกค้าตั้งค่าความเป็นส่วนตัว / สิทธิ์ไม่ครบ)
 *    ถ้าปล่อยให้แต่ละหน้าจัดการเอง จะมีที่ที่ลืมทำ แล้วเลย์เอาต์พังเป็นจุด ๆ
 *
 * 🔴 กฎ :
 *    1. ขนาดต้องคงที่เสมอ ไม่ว่าจะมีรูปหรือไม่มี
 *       (ถ้าขนาดเปลี่ยน แถวในลิสต์จะกระตุกตอนรูปโหลดเสร็จ)
 *    2. รูปโหลดไม่ขึ้นต้องตกไปใช้ตัวอักษร ไม่ใช่โชว์ไอคอนรูปแตก
 *       ลิงก์รูปของ Meta หมดอายุได้ตลอดเวลา
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';

/** สีพื้นหลังของตัวสำรอง — สุ่มจากชื่อ เพื่อให้คนเดิมได้สีเดิมเสมอ */
const TONES = [
  'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700',
];

function toneFor(seed: string): string {
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) sum = (sum + seed.charCodeAt(i)) % 997;
  return TONES[sum % TONES.length];
}

/**
 * ตัวอักษรย่อ
 * ⚠️ ต้องรองรับภาษาไทย — ใช้ [...str] ไม่ใช่ str[0]
 *    เพราะสระ/วรรณยุกต์ไทยเป็นอักขระแยก การตัดด้วย index จะได้สระลอย ๆ มาแทน
 */
export function initialsOf(name: string): string {
  const clean = name.trim();
  if (!clean) return '?';
  const words = clean.split(/\s+/).filter(Boolean);
  const first = [...(words[0] ?? '')][0] ?? '?';
  if (words.length === 1) return first.toUpperCase();
  const second = [...(words[1] ?? '')][0] ?? '';
  return (first + second).toUpperCase();
}

export default function CustomerAvatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  const box =
    size === 'sm' ? 'size-7 text-[10px]' : size === 'lg' ? 'size-12 text-base' : 'size-9 text-xs';

  const showImage = Boolean(src) && !broken;

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium',
        box,
        !showImage && toneFor(name),
        className,
      )}
      aria-hidden="true"
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- รูปมาจากโดเมนของ Meta/R2 ที่เปลี่ยนได้ ไม่เหมาะกับ next/image
        <img
          src={src!}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          loading="lazy"
          // 🔴 ลิงก์รูปของ Meta หมดอายุได้ → ต้องตกไปใช้ตัวอักษร ไม่ใช่โชว์รูปแตก
          onError={() => setBroken(true)}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
