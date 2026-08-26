/**
 * ชุดทดสอบตัวกรองคำของฟีดคอมเมนต์ (รอบ 9)
 */
import { describe, it, expect } from 'vitest';
import { cleanFilterWords, DEFAULT_FILTER_WORDS, matchFilterWord, normalizeComment } from '../filter';

describe('จับคำกรอง', () => {
  it('เจอคำที่อยู่กลางประโยค', () => {
    expect(matchFilterWord('ราคาเท่าไหร่คะ', DEFAULT_FILTER_WORDS)).toBe('ราคา');
    expect(matchFilterWord('อันนี้สนใจค่ะ', DEFAULT_FILTER_WORDS)).toBe('สนใจ');
  });

  it('ไม่สนตัวพิมพ์เล็กใหญ่', () => {
    expect(matchFilterWord('CF ค่ะ', DEFAULT_FILTER_WORDS)).toBe('cf');
    expect(matchFilterWord('Cf', DEFAULT_FILTER_WORDS)).toBe('cf');
  });

  it('⭐ สระอำที่พิมพ์คนละแบบ ต้องจับได้เหมือนกัน (NFKC)', () => {
    // U+0E33 (สระอำ) กับ นิคหิต + สระอา — ตาเปล่าแยกไม่ออก
    const a = 'สั่งซื้อ';
    const b = 'สั่งซื้อ'.normalize('NFD');
    expect(matchFilterWord(a, ['สั่ง'])).toBe('สั่ง');
    expect(matchFilterWord(b, ['สั่ง'])).toBe('สั่ง');
  });

  it('ไม่เข้าคำไหนเลย = null', () => {
    expect(matchFilterWord('สวยจังเลยค่ะ', DEFAULT_FILTER_WORDS)).toBeNull();
  });

  it('คอมเมนต์ว่าง / null ต้องไม่ระเบิด', () => {
    expect(matchFilterWord('', DEFAULT_FILTER_WORDS)).toBeNull();
    expect(matchFilterWord(null, DEFAULT_FILTER_WORDS)).toBeNull();
    expect(matchFilterWord(undefined, DEFAULT_FILTER_WORDS)).toBeNull();
  });

  it('⭐ ผลต้องเหมือนเดิมทุกครั้ง — คำแรกในรายการชนะ', () => {
    const words = ['สนใจ', 'ราคา'];
    expect(matchFilterWord('ราคาเท่าไหร่ สนใจค่ะ', words)).toBe('สนใจ');
    expect(matchFilterWord('ราคาเท่าไหร่ สนใจค่ะ', words)).toBe('สนใจ');
    // สลับลำดับรายการ = ผลเปลี่ยนตามลำดับที่เจ้าของร้านตั้ง (ตั้งใจ)
    expect(matchFilterWord('ราคาเท่าไหร่ สนใจค่ะ', ['ราคา', 'สนใจ'])).toBe('ราคา');
  });
});

describe('ทำความสะอาดรายการคำกรอง', () => {
  it('🔴 คำว่างต้องถูกตัดทิ้ง ไม่งั้นจะ match ทุกคอมเมนต์', () => {
    const words = cleanFilterWords(['ราคา', '', '   ', 'สนใจ']);
    expect(words).toEqual(['ราคา', 'สนใจ']);
    expect(matchFilterWord('สวยจัง', words)).toBeNull();
  });

  it('ตัดคำซ้ำ', () => {
    expect(cleanFilterWords(['ราคา', 'ราคา', 'RAคา'])).toEqual(['ราคา', 'RAคา']);
  });

  it('ของที่ไม่ใช่อาเรย์ = ใช้ค่าเริ่มต้น', () => {
    expect(cleanFilterWords(null)).toEqual(DEFAULT_FILTER_WORDS);
    expect(cleanFilterWords('ราคา')).toEqual(DEFAULT_FILTER_WORDS);
  });

  it('กันรายการยาวเกินและคำยาวเกิน', () => {
    expect(cleanFilterWords([{ a: 1 }, 123, 'x'.repeat(100), 'ดี'])).toEqual(['ดี']);
    expect(cleanFilterWords(Array.from({ length: 200 }, (_, i) => `w${i}`))).toHaveLength(50);
  });
});

describe('normalize', () => {
  it('ยุบช่องว่างซ้ำและตัดหัวท้าย', () => {
    expect(normalizeComment('  ราคา   เท่าไหร่  ')).toBe('ราคา เท่าไหร่');
  });
});
