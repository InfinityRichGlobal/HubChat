/**
 * ชุดทดสอบตัวรวมรายการของอินบ็อกซ์ (รอบ 7)
 * ===========================================================================
 * ตรรกะนี้เคยอยู่ในไฟล์หน้าเว็บ ทดสอบไม่ได้ จึงย้ายออกมา
 * ข้อที่สำคัญที่สุดคือ "ของเก่าที่กดโหลดมาแล้วต้องไม่หายตอนดึงข้อมูลรอบถัดไป"
 */
import { describe, it, expect } from 'vitest';
import { mergeByTime } from '../merge';

type Msg = { id: string; created_at: string };

const msgOpts = (replaceWindow: boolean) => ({
  timeOf: (m: Msg) => m.created_at,
  newestFirst: false,
  replaceWindow,
});

const m = (id: string, t: string): Msg => ({ id, created_at: t });

describe('ข้อความในห้องแชท (เรียงเก่า→ใหม่)', () => {
  it('ข้อความใหม่ที่เข้ามาต่อท้าย ของเดิมยังอยู่ครบ', () => {
    const prev = [m('a', '2026-01-01T10:00:00Z'), m('b', '2026-01-01T11:00:00Z')];
    const incoming = [m('b', '2026-01-01T11:00:00Z'), m('c', '2026-01-01T12:00:00Z')];
    const out = mergeByTime(prev, incoming, msgOpts(true));
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('🔴 ของเก่าที่กดโหลดมาต้องไม่หายตอนดึงข้อมูลรอบถัดไป', () => {
    // จำลองของจริง : กด "ดูข้อความเก่ากว่านี้" มา 2 ข้อความ
    const prev = [
      m('old1', '2025-06-01T08:00:00Z'),
      m('old2', '2025-06-01T09:00:00Z'),
      m('new1', '2026-01-01T10:00:00Z'),
    ];
    // แล้วตัวดึงอัตโนมัติทำงาน — คืนมาแค่ชุดล่าสุดเท่านั้น
    const incoming = [m('new1', '2026-01-01T10:00:00Z'), m('new2', '2026-01-01T10:05:00Z')];
    const out = mergeByTime(prev, incoming, msgOpts(true));
    expect(out.map((x) => x.id)).toEqual(['old1', 'old2', 'new1', 'new2']);
  });

  it('ข้อความที่ถูกลบในหน้าต่างล่าสุด ต้องหายออกจากจอด้วย', () => {
    const prev = [m('a', '2026-01-01T10:00:00Z'), m('b', '2026-01-01T11:00:00Z')];
    // b หายไปจากชุดที่ดึงมา = ถูกลบ
    const incoming = [m('a', '2026-01-01T10:00:00Z')];
    const out = mergeByTime(prev, incoming, msgOpts(true));
    expect(out.map((x) => x.id)).toEqual(['a']);
  });

  it('ชุดของเก่าที่กดขอเพิ่ม ห้ามไปลบอะไรทั้งสิ้น', () => {
    const prev = [m('new1', '2026-01-01T10:00:00Z'), m('new2', '2026-01-01T11:00:00Z')];
    const incoming = [m('old1', '2025-01-01T10:00:00Z')];
    const out = mergeByTime(prev, incoming, msgOpts(false));
    expect(out.map((x) => x.id)).toEqual(['old1', 'new1', 'new2']);
  });

  it('เวลาเท่ากันเป๊ะ ต้องได้ลำดับเดิมเสมอ (เกิดบ่อยกับแชทที่ดึงย้อนหลัง)', () => {
    const t = '2026-01-01T10:00:00Z';
    const first = mergeByTime([], [m('b', t), m('a', t), m('c', t)], msgOpts(true));
    const second = mergeByTime([], [m('c', t), m('b', t), m('a', t)], msgOpts(true));
    expect(first.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(second.map((x) => x.id)).toEqual(first.map((x) => x.id));
  });

  it('ชุดที่ดึงมาว่างเปล่าตอนขอของเก่า ต้องไม่ล้างของเดิมทิ้ง', () => {
    const prev = [m('a', '2026-01-01T10:00:00Z')];
    expect(mergeByTime(prev, [], msgOpts(false))).toEqual(prev);
  });

  it('ชุดล่าสุดว่างเปล่า = ห้องนี้ไม่เหลืออะไรแล้วจริง ๆ', () => {
    const prev = [m('a', '2026-01-01T10:00:00Z')];
    expect(mergeByTime(prev, [], msgOpts(true))).toEqual([]);
  });
});

type Conv = { id: string; last_message_at: string };
const convOpts = (replaceWindow: boolean) => ({
  timeOf: (c: Conv) => c.last_message_at,
  newestFirst: true,
  replaceWindow,
});
const cv = (id: string, t: string): Conv => ({ id, last_message_at: t });

describe('ลิสต์แชท (เรียงใหม่→เก่า)', () => {
  it('เรียงห้องที่ขยับล่าสุดขึ้นบนเสมอ', () => {
    const prev = [cv('a', '2026-01-02T00:00:00Z'), cv('b', '2026-01-01T00:00:00Z')];
    const incoming = [cv('b', '2026-01-03T00:00:00Z'), cv('a', '2026-01-02T00:00:00Z')];
    const out = mergeByTime(prev, incoming, convOpts(true));
    expect(out.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('🔴 ห้องเก่าที่กด "โหลดแชทเพิ่ม" มา ต้องไม่หายตอนดึงลิสต์รอบถัดไป', () => {
    const prev = [
      cv('new', '2026-01-10T00:00:00Z'),
      cv('old1', '2025-03-01T00:00:00Z'),
      cv('old2', '2025-02-01T00:00:00Z'),
    ];
    const incoming = [cv('new', '2026-01-10T00:00:00Z')];
    const out = mergeByTime(prev, incoming, convOpts(true));
    expect(out.map((x) => x.id)).toEqual(['new', 'old1', 'old2']);
  });
});
