import 'server-only';
/**
 * จัดการรหัสผ่าน (เช็คลิสต์ความปลอดภัยข้อ 4)
 * -------------------------------------------------------------------------
 * ใช้ argon2id — ปัจจุบันถือว่าปลอดภัยกว่า bcrypt
 * ห้ามเก็บรหัสผ่านเป็นข้อความธรรมดาเด็ดขาด แม้แต่ใน log
 */
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/** ค่าความหนักในการ hash — ปรับให้ช้าพอที่เดาสุ่มไม่คุ้ม แต่ login ไม่หน่วง */
const OPTIONS = {
  // 2 = Argon2id (เขียนเป็นตัวเลขเพราะ enum ของ library เป็น const enum ใช้ตรง ๆ กับ isolatedModules ไม่ได้)
  algorithm: 2 as const,
  memoryCost: 19456, // 19 MB
  timeCost: 2,
  parallelism: 1,
} as const;

/** เข้ารหัสรหัสผ่านก่อนเก็บ */
export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, OPTIONS);
}

/**
 * ตรวจรหัสผ่าน
 * ถ้า hash ในฐานข้อมูลเสียหาย ให้ถือว่า "ไม่ผ่าน" ไม่ใช่โยน error ออกไป
 * (กันไม่ให้คนภายนอกเดาได้ว่าบัญชีนี้มีจริงหรือเปล่าจากรูปแบบ error)
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * เกณฑ์รหัสผ่านขั้นต่ำ — เอาแค่พอกันรหัสง่าย ๆ ไม่ตั้งกฎยิบย่อยจนแอดมินหงุดหงิด
 * (แอดมินใช้มือถือ พิมพ์อักขระพิเศษลำบาก จึงเน้น "ยาวพอ" มากกว่า "แปลกพอ")
 */
export function validatePasswordStrength(plain: string): { ok: boolean; reason_th?: string } {
  if (plain.length < 8) return { ok: false, reason_th: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' };
  if (plain.length > 200) return { ok: false, reason_th: 'รหัสผ่านยาวเกินไป' };
  if (/^\d+$/.test(plain)) return { ok: false, reason_th: 'รหัสผ่านห้ามเป็นตัวเลขล้วน' };
  const weak = ['password', '12345678', 'qwerty123', 'admin123', '11111111'];
  if (weak.includes(plain.toLowerCase())) return { ok: false, reason_th: 'รหัสผ่านนี้ง่ายเกินไป' };
  return { ok: true };
}

/** สุ่มรหัสผ่านชั่วคราวให้เจ้าของส่งต่อให้แอดมินคนใหม่ (อ่านออกเสียงง่าย ไม่มีตัวที่สับสน) */
export function generateTempPassword(length = 10): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
