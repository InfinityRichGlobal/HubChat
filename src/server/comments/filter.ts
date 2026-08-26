/**
 * ตัวกรองคำของฟีดคอมเมนต์ (รอบ 9 — สเปกหัวข้อ 5.5)
 * ===========================================================================
 * ⚠️ ฟังก์ชันบริสุทธิ์ล้วน ๆ
 *
 * ⭐ หน้าที่ของตัวนี้คือ "ชูขึ้นมาให้เห็น" ไม่ใช่ "ตัดสินใจแทน"
 *    คอมเมนต์ที่ไม่เข้าคำกรองยังอยู่ในฟีดครบ แค่ไม่ถูกไฮไลต์
 *    🔴 และไม่ว่าจะเข้าคำไหน ระบบก็ไม่ตอบอัตโนมัติเด็ดขาด (สเปก 5.5)
 *
 * ⚠️ ใช้ NFKC เหมือนตัวจับคีย์เวิร์ดของแชท (รอบ 6)
 *    เพราะภาษาไทยมี "สระอำ" ที่เขียนได้สองแบบและตาเปล่าแยกไม่ออก
 *    ถ้าใช้ NFC จะจับ "สนใจ" ที่พิมพ์คนละแบบไม่เจอ
 */

/** คำกรองเริ่มต้นตามสเปก — เจ้าของร้านแก้ได้ในหน้าตั้งค่า */
export const DEFAULT_FILTER_WORDS = ['ราคา', 'สนใจ', 'cf', 'จอง', 'สั่ง'];

export function normalizeComment(input: string | null | undefined): string {
  if (typeof input !== 'string') return '';
  return input.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * หาคำกรองคำแรกที่เจอในคอมเมนต์
 * คืน null ถ้าไม่เข้าคำไหนเลย
 *
 * ⚠️ เรียงตามลำดับที่เจ้าของร้านใส่มา — คำแรกในรายการชนะ
 *    ทำให้ผลลัพธ์เหมือนเดิมทุกครั้ง ไม่ใช่แล้วแต่ว่าคำไหนอยู่ต้นประโยค
 */
export function matchFilterWord(message: string | null | undefined, words: string[]): string | null {
  const text = normalizeComment(message);
  if (text === '') return null;

  for (const raw of words) {
    const word = normalizeComment(raw);
    if (word === '') continue;
    if (text.includes(word)) return raw.trim();
  }
  return null;
}

/**
 * ทำความสะอาดรายการคำกรองที่มาจากหน้าตั้งค่า
 * ⚠️ ต้องตัดคำว่างและคำซ้ำออก ไม่งั้นคำว่างจะ match ทุกคอมเมนต์
 */
export function cleanFilterWords(input: unknown): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_FILTER_WORDS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const word = raw.trim();
    if (word === '' || word.length > 50) continue;
    const key = normalizeComment(word);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= 50) break;
  }
  return out;
}
