import { compareCursor } from './cursor';

/**
 * รวมรายการที่ "ดึงมาเป็นชุด ๆ" ให้เป็นก้อนเดียว (รอบ 7)
 * ===========================================================================
 * 🔴 ปัญหาที่แก้ :
 *    อินบ็อกซ์ดึงข้อมูลซ้ำเป็นระยะ (ข้อความทุก 4 วิ / ลิสต์แชททุก 8 วิ)
 *    เดิมได้มาแล้ว "ทับทั้งก้อน" ซึ่งใช้ได้ตราบใดที่หน้าเว็บเห็นแค่ชุดล่าสุด
 *    พอมีปุ่ม "ดูข้อความเก่ากว่านี้" / "โหลดแชทเพิ่ม" ของเก่าที่กดมาจะหายวับ
 *    ภายในไม่กี่วินาที — คือสาเหตุที่ใช้งานไม่เหมือน Business Suite
 *
 * ⚠️ ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ล้วน ๆ ห้ามต่อเน็ต ห้ามอ่านเวลาปัจจุบัน
 *    (แยกออกมาจากไฟล์หน้าเว็บโดยตั้งใจ เพื่อให้ทดสอบตรรกะนี้ได้จริง)
 */

/** ของที่รวมได้ต้องมี id กับเวลา — ใช้ได้ทั้งข้อความและห้องแชท */
type HasKey = { id: string };

/**
 * รวมชุดเก่ากับชุดใหม่ โดยไม่ทำของที่ถืออยู่หาย
 *
 * @param timeOf       อ่านเวลาที่ใช้เรียงของแต่ละรายการ
 * @param newestFirst  true = ผลลัพธ์เรียงใหม่→เก่า (ลิสต์แชท)
 *                     false = เรียงเก่า→ใหม่ (ข้อความในห้อง)
 * @param replaceWindow
 *        true  = ชุดที่ได้มาคือ "ความจริงล่าสุด" ในช่วงเวลาของมัน
 *                รายการที่หายไปจากชุด แปลว่าถูกลบ ต้องเอาออกจากจอด้วย
 *        false = ชุดของเก่าที่กดขอเพิ่ม ห้ามไปลบอะไรทั้งนั้น
 */
export function mergeByTime<T extends HasKey>(
  prev: T[],
  incoming: T[],
  opts: {
    timeOf: (item: T) => string;
    newestFirst: boolean;
    replaceWindow: boolean;
  },
): T[] {
  const { timeOf, newestFirst, replaceWindow } = opts;

  // ⚠️ ชุดว่างตอน replaceWindow แปลว่า "ตอนนี้ไม่มีอะไรเลย" จริง ๆ
  //    (เช่น เปลี่ยนตัวกรองแล้วไม่เจออะไร) จึงต้องล้างของเดิมทิ้ง
  if (incoming.length === 0) return replaceWindow ? [] : prev;

  const incomingIds = new Set(incoming.map((x) => x.id));

  // ขอบของหน้าต่างที่ชุดใหม่ครอบคลุม = รายการที่เก่าที่สุดในชุด
  const edgeRow = newestFirst ? incoming[incoming.length - 1] : incoming[0];
  const edge = { at: timeOf(edgeRow), id: edgeRow.id };

  const kept = prev.filter((x) => {
    if (incomingIds.has(x.id)) return false; // มีตัวใหม่กว่ามาแทนแล้ว
    if (replaceWindow && compareCursor({ at: timeOf(x), id: x.id }, edge) >= 0) return false; // อยู่ในหน้าต่างแต่หายไป = ถูกลบ
    return true;
  });

  return [...kept, ...incoming].sort((a, b) => {
    return compareCursor({ at: timeOf(a), id: a.id }, { at: timeOf(b), id: b.id }) * (newestFirst ? -1 : 1);
  });
}
