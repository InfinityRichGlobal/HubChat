import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** รวม class ของ Tailwind โดยให้ตัวหลังชนะตัวหน้า (มาตรฐานของ shadcn/ui) */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
