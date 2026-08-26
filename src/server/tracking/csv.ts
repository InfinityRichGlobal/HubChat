/**
 * อ่านไฟล์ CSV จากขนส่ง (รอบ 8)
 * ===========================================================================
 * ⚠️ ฟังก์ชันบริสุทธิ์ล้วน ๆ — รับข้อความ คืนตาราง ไม่แตะอะไรข้างนอกเลย
 *
 * 🔴 ทำไมเขียนเอง ไม่ใช้ไลบรารี :
 *    ไฟล์จากขนส่งไทยมีของแปลกครบทุกอย่าง — BOM จาก Excel, ตัวคั่นเป็น
 *    เซมิโคลอนหรือแท็บ, ขึ้นบรรทัดใหม่ในเซลล์ที่ครอบด้วยเครื่องหมายคำพูด
 *    การพึ่งไลบรารีเพิ่มของที่ต้องดูแลโดยไม่ได้แก้เรื่องพวกนี้ให้เลย
 *    และ "ไฟล์พังต้องไม่ทำให้ระบบล้ม" เป็นข้อกำหนดที่ต้องคุมเอง
 *
 * ⚠️ ไม่รองรับ .xlsx โดยตั้งใจในรอบนี้ — ดู DEFERRED_REVIEW D-64
 */

export type CsvTable = {
  headers: string[];
  rows: string[][];
  /** ตัวคั่นที่เดาได้ — เก็บไว้บอกแอดมินตอนไฟล์หน้าตาผิดคาด */
  delimiter: string;
};

export class CsvError extends Error {
  constructor(public message_th: string) {
    super(message_th);
    this.name = 'CsvError';
  }
}

/** เพดานกันไฟล์ยักษ์ทำเซิร์ฟเวอร์ค้าง */
export const MAX_CSV_ROWS = 5000;
export const MAX_CSV_BYTES = 5 * 1024 * 1024;

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'];

/**
 * เดาตัวคั่นจากบรรทัดแรก
 * ใช้ "นับจำนวนครั้งที่โผล่นอกเครื่องหมายคำพูด" ตัวไหนมากสุดชนะ
 */
export function detectDelimiter(firstLine: string): string {
  let best = ',';
  let bestCount = 0;

  for (const d of CANDIDATE_DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i += 1) {
      const ch = firstLine[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && ch === d) {
        count += 1;
      }
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * แกะ CSV ตามแนว RFC 4180
 * - "" ข้างในเครื่องหมายคำพูด = เครื่องหมายคำพูดหนึ่งตัว
 * - ขึ้นบรรทัดใหม่ในเซลล์ได้ ถ้าอยู่ในเครื่องหมายคำพูด
 * - รองรับ CRLF และ LF
 */
export function parseCsv(input: string): CsvTable {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new CsvError('ไฟล์ว่าง อ่านอะไรไม่ได้เลย');
  }

  // ตัด BOM ที่ Excel ใส่มาให้ ไม่งั้นหัวคอลัมน์แรกจะมีอักขระล่องหนติดอยู่
  const text = input.replace(/^﻿/, '');

  const firstLineEnd = text.search(/\r?\n/);
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const delimiter = detectDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAnyChar = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      sawAnyChar = true;
      continue;
    }

    if (ch === delimiter) {
      row.push(field);
      field = '';
      sawAnyChar = true;
      continue;
    }

    if (ch === '\r') continue; // CRLF — ปล่อยให้ \n เป็นคนจบบรรทัด

    if (ch === '\n') {
      row.push(field);
      field = '';
      // บรรทัดว่างล้วน ๆ ข้ามไป (ไฟล์จากขนส่งมักมีบรรทัดว่างท้ายไฟล์)
      if (!(row.length === 1 && row[0].trim() === '')) rows.push(row);
      row = [];
      sawAnyChar = false;
      if (rows.length > MAX_CSV_ROWS + 1) {
        throw new CsvError(`ไฟล์มีมากกว่า ${MAX_CSV_ROWS} แถว — แบ่งไฟล์ก่อนแล้วค่อยนำเข้า`);
      }
      continue;
    }

    field += ch;
    sawAnyChar = true;
  }

  // เก็บบรรทัดสุดท้ายที่ไม่มี \n ปิดท้าย
  if (sawAnyChar || field !== '' || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0].trim() === '')) rows.push(row);
  }

  if (inQuotes) {
    throw new CsvError('ไฟล์มีเครื่องหมายคำพูด (") ที่เปิดแล้วไม่ได้ปิด — ไฟล์น่าจะเสียหาย');
  }

  if (rows.length === 0) {
    throw new CsvError('ไฟล์ว่าง อ่านอะไรไม่ได้เลย');
  }

  const headers = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  if (headers.every((h) => h === '')) {
    throw new CsvError('แถวแรกของไฟล์ไม่มีชื่อคอลัมน์ — ต้องมีหัวตารางเสมอ');
  }

  const body = rows.slice(1);
  if (body.length > MAX_CSV_ROWS) {
    throw new CsvError(`ไฟล์มีมากกว่า ${MAX_CSV_ROWS} แถว — แบ่งไฟล์ก่อนแล้วค่อยนำเข้า`);
  }

  return { headers, rows: body, delimiter };
}

/** จับคู่หัวคอลัมน์กับค่าในแถว — แถวที่สั้นกว่าหัวตารางถือว่าช่องที่ขาดเป็นค่าว่าง */
export function rowToObject(headers: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < headers.length; i += 1) {
    const key = headers[i];
    if (key === '') continue;
    out[key] = (row[i] ?? '').trim();
  }
  return out;
}
