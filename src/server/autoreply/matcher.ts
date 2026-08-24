/**
 * ตัวจับคีย์เวิร์ด — สเปกหัวข้อ 5.5
 * ===========================================================================
 * ⚠️ ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ล้วน — ห้ามต่อฐานข้อมูล ห้ามยิงเน็ต ห้ามอ่านเวลา
 *
 * 🔴 ทำไมต้องแยกออกมาและทดสอบหนัก :
 *    นี่คือตัวตัดสินว่า "ระบบจะพิมพ์หาลูกค้าเองหรือไม่"
 *    จับผิด = ลูกค้าได้ข้อความที่ไม่เกี่ยวข้อง หรือได้ข้อความขายทั้งที่แค่ทักมาเฉย ๆ
 *    ซึ่งเป็นเรื่องที่ Meta ถือว่าเป็นสแปม และเป็นเหตุให้เพจโดนระงับได้
 *
 * ⭐ ไม่มี AI ไม่มีการเดา — ตรงตัวอักษรเท่านั้น (สเปกเขียนไว้ชัด)
 *
 * 🔴 ไม่มี regex โดยตั้งใจ :
 *    ถ้าเปิดให้แอดมินใส่ regex เอง จะเปิดช่อง ReDoS ทันที
 *    (pattern อย่าง (a+)+$ ทำให้เซิร์ฟเวอร์ค้างได้ด้วยข้อความสั้น ๆ)
 *    และแอดมินร้านค้าไม่ควรต้องเข้าใจ regex เพื่อตั้งคำตอบอัตโนมัติ
 *    จดไว้ใน DEFERRED_REVIEW ว่าถ้าจะเพิ่มจริงต้องมี timeout + ตัวตรวจ pattern ก่อน
 */
import type { MatchType } from '@/types/db';

export type MatchableRule = {
  id: string;
  /** ว่าง = ใช้กับทุกเพจ */
  page_ids: string[];
  match_type: MatchType;
  keywords: string[];
  reply_text: string | null;
  /** เลขน้อย = ตรวจก่อน (ตามสเปก 0001) */
  priority: number;
  is_active: boolean;
  archived_at: string | null;
  /** ใช้เป็นตัวตัดสินสุดท้ายเมื่อทุกอย่างเท่ากัน */
  created_at: string;
  version: number;
};

export type MatchResult = {
  rule: MatchableRule;
  /** คำที่ทำให้ตรง — เก็บลงล็อกเพื่อให้ตรวจย้อนหลังได้ว่าตรงเพราะอะไร */
  matched_keyword: string;
};

/* ------------------------------------------------------------------------ */
/* การปรับข้อความก่อนเทียบ                                                    */
/* ------------------------------------------------------------------------ */

/**
 * ปรับข้อความให้เทียบกันได้อย่างยุติธรรม
 *
 * ทำอะไรบ้าง :
 *   1. NFKC — รวมอักขระที่ "อ่านออกมาเหมือนกัน" ให้เป็นรูปเดียว
 *
 *      ⚠️ ต้องเป็น NFKC ไม่ใช่ NFC — ตรงนี้เคยเขียนผิดแล้วเทสต์จับได้ :
 *
 *        • สระอำ (ำ U+0E33) กับ นิคหิต+สระอา (ํ + า) มองด้วยตาเหมือนกันเป๊ะ
 *          แต่ NFC ไม่รวมให้ (ยูนิโคดไม่ได้นิยาม canonical decomposition ไว้)
 *          NFKC รวมให้ → ลูกค้าพิมพ์ "คำ" จากคีย์บอร์ดคนละตัวจึงจับตรงเหมือนกัน
 *
 *        • ตัวอักษรเต็มความกว้าง (ＰＲＩＣＥ) ที่คีย์บอร์ดมือถือบางตัวพ่นออกมา
 *          NFC ปล่อยผ่าน NFKC แปลงเป็น PRICE ให้
 *
 *      ⚠️ ใช้ NFKC เพื่อ "เทียบ" เท่านั้น ห้ามเอาผลไปเก็บทับข้อความจริงของลูกค้า
 *         เพราะ NFKC ทำให้ข้อมูลบางอย่างเพี้ยน (เช่น ½ กลายเป็น 1⁄2)
 *
 *   2. ตัดช่องว่างหัวท้าย และยุบช่องว่างซ้ำให้เหลือช่องเดียว
 *   3. toLowerCase — มีผลกับอังกฤษ ส่วนไทยไม่มีตัวพิมพ์ใหญ่เล็กจึงไม่กระทบ
 *
 * ⚠️ ไม่ตัดคำภาษาไทย (word segmentation) โดยตั้งใจ
 *    ภาษาไทยไม่มีช่องว่างระหว่างคำ การตัดคำต้องใช้พจนานุกรม/โมเดล
 *    ซึ่งจะทำให้ไฟล์นี้ไม่บริสุทธิ์และทดสอบครบไม่ได้
 *    'contains' บนสตริงตรง ๆ ทำงานถูกกับไทยอยู่แล้ว เพราะเทียบลำดับอักขระ
 */
export function normalize(input: string | null | undefined): string {
  if (typeof input !== 'string') return '';
  return input.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ------------------------------------------------------------------------ */
/* การเทียบหนึ่งคำ                                                            */
/* ------------------------------------------------------------------------ */

function matchesKeyword(text: string, keyword: string, type: MatchType): boolean {
  // คีย์เวิร์ดว่างต้องไม่ตรงกับอะไรเลย
  // ⚠️ ถ้าไม่กันตรงนี้ '' จะทำให้ contains ตรงกับทุกข้อความในโลก
  //    = ตอบอัตโนมัติทุกครั้งที่ลูกค้าทักมา ซึ่งคือสแปม
  if (keyword.length === 0 || text.length === 0) return false;

  switch (type) {
    case 'exact':
      return text === keyword;
    case 'starts_with':
      return text.startsWith(keyword);
    case 'contains':
      return text.includes(keyword);
    default:
      // enum ใหม่ที่โค้ดยังไม่รู้จัก → ถือว่าไม่ตรง ปลอดภัยกว่าเดา
      return false;
  }
}

/* ------------------------------------------------------------------------ */
/* การจัดลำดับกฎ                                                              */
/* ------------------------------------------------------------------------ */

/**
 * เรียงกฎให้ผลลัพธ์เหมือนเดิมทุกครั้ง
 *
 * 🔴 ทำไมต้องมีตัวตัดสินสำรองถึงสามชั้น :
 *    ฐานข้อมูลไม่รับประกันลำดับแถวถ้าไม่ได้สั่ง order by ที่ unique
 *    ถ้ากฎสองข้อ priority เท่ากันแล้วเราไม่ตัดสินเอง
 *    วันนี้อาจตอบกฎ A พรุ่งนี้ตอบกฎ B ทั้งที่ข้อมูลไม่เปลี่ยนเลย
 *    ซึ่งเป็นบั๊กที่หาไม่เจอเพราะ "บางทีก็ถูก"
 *
 * ลำดับการตัดสิน : priority (น้อยก่อน) → created_at (เก่าก่อน) → id (เรียงตัวอักษร)
 * id เป็น primary key จึงไม่มีทางเท่ากัน = จบทุกกรณีแน่นอน
 */
export function orderRules(rules: MatchableRule[]): MatchableRule[] {
  return [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** กฎนี้ใช้งานได้จริงตอนนี้ไหม */
export function isRuleLive(rule: MatchableRule): boolean {
  return rule.is_active && rule.archived_at === null && (rule.reply_text ?? '').trim().length > 0;
}

/** กฎนี้ใช้กับเพจนี้ไหม — page_ids ว่าง = ทุกเพจ */
export function ruleAppliesToPage(rule: MatchableRule, pageId: string): boolean {
  if (!Array.isArray(rule.page_ids) || rule.page_ids.length === 0) return true;
  return rule.page_ids.includes(pageId);
}

/* ------------------------------------------------------------------------ */
/* ตัวหลัก                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * หากฎที่ควรตอบข้อความนี้ — คืน null ถ้าไม่มีกฎไหนตรง
 *
 * ⚠️ คืนกฎเดียวเสมอโดยตั้งใจ
 *    ถ้าตรงหลายกฎแล้วตอบทุกกฎ ลูกค้าจะได้ข้อความรัวหลายอัน
 *    ซึ่งดูเหมือนระบบพังและเข้าข่ายสแปม
 */
export function findMatchingRule(
  text: string | null | undefined,
  pageId: string,
  rules: MatchableRule[],
): MatchResult | null {
  const normalized = normalize(text);
  // ข้อความว่าง (เช่น ลูกค้าส่งมาแต่รูป หรือ sticker) → ไม่ตอบอัตโนมัติ
  if (normalized.length === 0) return null;

  for (const rule of orderRules(rules)) {
    if (!isRuleLive(rule)) continue;
    if (!ruleAppliesToPage(rule, pageId)) continue;
    if (!Array.isArray(rule.keywords)) continue;

    // เรียงคำในกฎด้วย เพื่อให้ "คำไหนทำให้ตรง" คงที่เสมอเมื่อตรงหลายคำ
    const keywords = [...rule.keywords]
      .map((k) => normalize(k))
      .filter((k) => k.length > 0)
      .sort();

    for (const keyword of keywords) {
      if (matchesKeyword(normalized, keyword, rule.match_type)) {
        return { rule, matched_keyword: keyword };
      }
    }
  }

  return null;
}
