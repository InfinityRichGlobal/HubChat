import type { Platform } from '@/types/db';

/**
 * คืนลิงก์โปรไฟล์ที่พิสูจน์ที่มาได้เท่านั้น
 *
 * Instagram username มาจาก Meta API โดยตรง จึงเปิด instagram.com ได้จริง
 * ส่วน Facebook PSID เป็นรหัสเฉพาะคู่เพจ-ลูกค้า ไม่ใช่ public profile id
 * การประกอบ facebook.com/<psid> จะได้ลิงก์เสียหรือผิดคน จึงต้องคืน null
 */
export function customerProfileUrl(platform: Platform, username: string | null): string | null {
  if (platform !== 'instagram') return null;
  const clean = username?.trim().replace(/^@/, '');
  if (!clean || !/^[A-Za-z0-9._]+$/.test(clean)) return null;
  return `https://www.instagram.com/${encodeURIComponent(clean)}/`;
}

