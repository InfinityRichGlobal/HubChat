/**
 * ชุดทดสอบกฎการแจ้งเตือน (รอบ 10 — สเปกหัวข้อ 6.7)
 * ===========================================================================
 * 🔴 แจ้งเตือนมากไป = แอดมินปิดทิ้ง แล้วระบบก็ไร้ประโยชน์
 *    ชุดนี้จึงคุมทั้ง "ต้องแจ้ง" และ "ต้องไม่แจ้ง"
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_EVENTS, cleanEvents, dedupeKey, inQuietHours, shouldNotify,
  type NotifyAdmin,
} from '../events';

function admin(over: Partial<NotifyAdmin> = {}): NotifyAdmin {
  return {
    id: over.id ?? 'a1',
    role: over.role ?? 'admin',
    allowed_page_ids: over.allowed_page_ids ?? ['page-a'],
    is_active: over.is_active ?? true,
    enabled_events: over.enabled_events ?? [...ALL_EVENTS],
    page_ids: over.page_ids ?? [],
  };
}

describe('ใครควรได้รับแจ้งเตือน', () => {
  it('ลูกค้าทักใหม่ → ทุกคนที่ดูเพจนั้น', () => {
    expect(shouldNotify(admin(), { event: 'new_chat', page_id: 'page-a' })).toBe(true);
  });

  it('🔴 เพจที่ไม่มีสิทธิ์ → ต้องไม่ได้รับแจ้ง', () => {
    expect(shouldNotify(admin(), { event: 'new_chat', page_id: 'page-b' })).toBe(false);
  });

  it('เจ้าของร้านเห็นทุกเพจ', () => {
    const owner = admin({ role: 'owner', allowed_page_ids: [] });
    expect(shouldNotify(owner, { event: 'new_chat', page_id: 'page-z' })).toBe(true);
  });

  it('🔴 ผู้ดูตอบแชทไม่ได้ จึงไม่ควรได้แจ้งเตือนเรื่องแชท', () => {
    const viewer = admin({ role: 'viewer', allowed_page_ids: ['page-a'] });
    for (const event of ALL_EVENTS) {
      expect(shouldNotify(viewer, { event, page_id: 'page-a' })).toBe(false);
    }
  });

  it('บัญชีที่ปิดใช้งานแล้ว ไม่ได้รับอะไรเลย', () => {
    expect(shouldNotify(admin({ is_active: false }), { event: 'new_chat', page_id: 'page-a' })).toBe(false);
  });

  it('ปิดเหตุการณ์นั้นไว้เอง → ไม่ได้รับ', () => {
    const a = admin({ enabled_events: ['reply'] });
    expect(shouldNotify(a, { event: 'new_chat', page_id: 'page-a' })).toBe(false);
    expect(shouldNotify(a, { event: 'reply', page_id: 'page-a', assigned_admin_id: 'a1' })).toBe(true);
  });

  it('เลือกรับเฉพาะบางเพจ', () => {
    const a = admin({ allowed_page_ids: ['page-a', 'page-b'], page_ids: ['page-b'] });
    expect(shouldNotify(a, { event: 'new_chat', page_id: 'page-a' })).toBe(false);
    expect(shouldNotify(a, { event: 'new_chat', page_id: 'page-b' })).toBe(true);
  });

  it('⭐ "ลูกค้าตอบ" ส่งเฉพาะคนที่รับแชทไว้เท่านั้น', () => {
    const mine = { event: 'reply' as const, page_id: 'page-a', assigned_admin_id: 'a1' };
    expect(shouldNotify(admin({ id: 'a1' }), mine)).toBe(true);
    expect(shouldNotify(admin({ id: 'a2' }), mine)).toBe(false);
  });

  it('🔴 "ลูกค้าตอบ" แต่ยังไม่มีใครรับแชท → ไม่ส่งให้ใครเลย', () => {
    expect(
      shouldNotify(admin(), { event: 'reply', page_id: 'page-a', assigned_admin_id: null }),
    ).toBe(false);
  });

  it('"ใกล้หมด 24 ชม." ส่งเฉพาะคนที่รับแชท', () => {
    expect(
      shouldNotify(admin({ id: 'a1' }), { event: 'window_closing', page_id: 'page-a', assigned_admin_id: 'a1' }),
    ).toBe(true);
    expect(
      shouldNotify(admin({ id: 'a2' }), { event: 'window_closing', page_id: 'page-a', assigned_admin_id: 'a1' }),
    ).toBe(false);
  });

  it('"แชทเงียบ 15 นาที" กับ "คอมเมนต์" ส่งทุกคนที่ดูเพจนั้น', () => {
    expect(shouldNotify(admin({ id: 'a9' }), { event: 'idle_15min', page_id: 'page-a' })).toBe(true);
    expect(shouldNotify(admin({ id: 'a9' }), { event: 'new_comment', page_id: 'page-a' })).toBe(true);
  });
});

describe('กุญแจกันซ้ำ', () => {
  it('เหตุการณ์เดิม คนเดิม ช่องทางเดิม = กุญแจเดิม', () => {
    expect(dedupeKey('new_chat', 'conv-1', 'a1', 'push'))
      .toBe(dedupeKey('new_chat', 'conv-1', 'a1', 'push'));
  });

  it('🔴 คนละคน / คนละช่องทาง / คนละเหตุการณ์ ต้องได้กุญแจคนละอัน', () => {
    const base = dedupeKey('new_chat', 'conv-1', 'a1', 'push');
    expect(dedupeKey('new_chat', 'conv-1', 'a2', 'push')).not.toBe(base);
    expect(dedupeKey('new_chat', 'conv-1', 'a1', 'telegram')).not.toBe(base);
    expect(dedupeKey('reply', 'conv-1', 'a1', 'push')).not.toBe(base);
    expect(dedupeKey('new_chat', 'conv-2', 'a1', 'push')).not.toBe(base);
  });
});

describe('ช่วงเวลาห้ามรบกวน', () => {
  it('⭐ ช่วงข้ามเที่ยงคืน 22:00-08:00 ต้องทำงานถูก', () => {
    expect(inQuietHours('23:30', '22:00', '08:00')).toBe(true);
    expect(inQuietHours('03:00', '22:00', '08:00')).toBe(true);
    expect(inQuietHours('07:59', '22:00', '08:00')).toBe(true);
    expect(inQuietHours('08:00', '22:00', '08:00')).toBe(false);
    expect(inQuietHours('14:00', '22:00', '08:00')).toBe(false);
    expect(inQuietHours('21:59', '22:00', '08:00')).toBe(false);
  });

  it('ช่วงปกติที่ไม่ข้ามคืน', () => {
    expect(inQuietHours('13:00', '12:00', '14:00')).toBe(true);
    expect(inQuietHours('11:00', '12:00', '14:00')).toBe(false);
  });

  it('ไม่ได้ตั้งไว้ = ไม่มีช่วงห้ามรบกวน', () => {
    expect(inQuietHours('03:00', null, null)).toBe(false);
    expect(inQuietHours('03:00', '22:00', undefined)).toBe(false);
  });

  it('ค่าที่อ่านไม่ออก ต้องไม่ทำให้พัง และต้องไม่บล็อกการแจ้งเตือน', () => {
    expect(inQuietHours('ขยะ', '22:00', '08:00')).toBe(false);
    expect(inQuietHours('03:00', 'ขยะ', '08:00')).toBe(false);
    expect(inQuietHours('25:99', '22:00', '08:00')).toBe(false);
  });

  it('ตั้งเวลาเริ่มเท่ากับเวลาจบ = ไม่ห้ามอะไรเลย (ไม่ใช่ห้ามทั้งวัน)', () => {
    expect(inQuietHours('03:00', '08:00', '08:00')).toBe(false);
  });
});

describe('ทำความสะอาดรายการเหตุการณ์', () => {
  it('รับเฉพาะชื่อที่ระบบรู้จัก', () => {
    expect(cleanEvents(['new_chat', 'ของปลอม', 'reply'])).toEqual(['new_chat', 'reply']);
  });

  it('ตัดของซ้ำ', () => {
    expect(cleanEvents(['reply', 'reply'])).toEqual(['reply']);
  });

  it('ของที่ไม่ใช่อาเรย์ = เปิดทุกเหตุการณ์', () => {
    expect(cleanEvents(null)).toEqual(ALL_EVENTS);
  });

  it('อาเรย์ว่าง = ปิดทุกเหตุการณ์ (ตั้งใจปิด ไม่ใช่ค่าเริ่มต้น)', () => {
    expect(cleanEvents([])).toEqual([]);
  });
});
