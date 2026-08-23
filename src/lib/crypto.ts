import 'server-only';
/**
 * เข้ารหัสข้อมูลลับก่อนเก็บลงฐานข้อมูล (เช็คลิสต์ความปลอดภัยข้อ 1)
 * -------------------------------------------------------------------------
 * ใช้กับ pages.access_token เป็นหลัก
 * วิธี : AES-256-GCM — เข้ารหัสแล้วยังตรวจได้ด้วยว่ามีคนแก้ข้อมูลกลางทางไหม
 *
 * รูปแบบที่เก็บลง DB : v1.<iv>.<authTag>.<ciphertext>  (แต่ละส่วนเป็น base64url)
 * ที่ใส่ "v1" ไว้ข้างหน้าเพราะถ้าวันหนึ่งต้องเปลี่ยนวิธีเข้ารหัส
 * จะได้รู้ว่าแถวไหนเป็นของเก่า แล้วค่อย ๆ ย้ายได้โดยไม่พังทั้งระบบ
 */
import crypto from 'node:crypto';
import { serverEnv } from '@/config/env';

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

/** แปลง ENCRYPTION_KEY (base64 หรือ hex) ให้เป็นคีย์ 32 ไบต์ */
function key(): Buffer {
  const raw = serverEnv().ENCRYPTION_KEY.trim();
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    buf = Buffer.from(raw, 'base64');
  }
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY ต้องเป็น 32 ไบต์ (ตอนนี้ได้ ${buf.length} ไบต์) — สร้างใหม่ด้วย: openssl rand -base64 32`,
    );
  }
  return buf;
}

/** เข้ารหัสข้อความ */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12); // GCM ใช้ 12 ไบต์
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

/** ถอดรหัสข้อความ — ถ้าข้อมูลถูกแก้ไขจะโยน error ทันที ไม่คืนค่ามั่ว */
export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('รูปแบบข้อมูลเข้ารหัสไม่ถูกต้อง (อาจถูกแก้ไข หรือมาจากคีย์คนละตัว)');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

/** ปิดบังค่าไว้โชว์ให้เจ้าของดู เช่น EAAG…9f2a — ห้ามส่งค่าจริงออก API */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return '••••';
  return `${plain.slice(0, 4)}••••${plain.slice(-4)}`;
}
