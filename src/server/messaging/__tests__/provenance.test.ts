/**
 * ชุดทดสอบเส้นแบ่งความเชื่อใจของ provenance (รอบ 2.1)
 * ===========================================================================
 * ประเด็นที่ตรวจพบ : เดิมผู้เรียกส่ง `human_typed: true` เข้ามาเองได้
 * แปลว่าโค้ดอัตโนมัติตัวไหนก็อ้างเป็นคนได้ ชุดนี้พิสูจน์ว่าทำแบบนั้นไม่ได้แล้ว
 */
import { describe, it, expect, vi } from 'vitest';

process.env.SESSION_SECRET = 'x'.repeat(40);

/** สวมระบบยืนยันตัวตนปลอม เพื่อทดสอบโรงงานฝั่ง "คน" โดยไม่ต้องมี cookie จริง */
const authState = { admin: null as null | { id: string; role: 'owner' | 'admin' | 'viewer' } };

vi.mock('@/lib/auth/current-admin', () => ({
  requireAdmin: vi.fn(async () => {
    if (!authState.admin) throw new Error('กรุณาเข้าสู่ระบบ');
    return authState.admin;
  }),
}));

import {
  isTrustedProvenance,
  humanAdminReply,
  keywordBotProvenance,
  schedulerProvenance,
  bulkJobProvenance,
  systemAutomationProvenance,
  ProvenanceDeniedError,
} from '../provenance';

describe('ตราประทับ — ของจริงเท่านั้นที่ผ่าน', () => {
  it('ของที่ออกจากโรงงานมีตราประทับ', () => {
    expect(isTrustedProvenance(keywordBotProvenance())).toBe(true);
    expect(isTrustedProvenance(schedulerProvenance())).toBe(true);
    expect(isTrustedProvenance(bulkJobProvenance('admin-1'))).toBe(true);
    expect(isTrustedProvenance(systemAutomationProvenance())).toBe(true);
  });

  it('🔴 object ที่เขียนเลียนแบบเป๊ะ ๆ ไม่มีตราประทับ', () => {
    const forged = {
      kind: 'human_admin_reply',
      triggered_by: 'admin',
      human_authored: true,
      admin_id: 'admin-1',
    };
    expect(isTrustedProvenance(forged)).toBe(false);
  });

  it('🔴 คัดลอกฟิลด์จากของจริงมาใส่ object ใหม่ ก็ยังไม่ผ่าน', () => {
    const real = keywordBotProvenance();
    const copied = { ...real, human_authored: true, kind: 'human_admin_reply' };
    expect(isTrustedProvenance(copied)).toBe(false);
  });

  it('ค่าอื่น ๆ ที่ไม่ใช่ object ก็ไม่ผ่าน', () => {
    expect(isTrustedProvenance(null)).toBe(false);
    expect(isTrustedProvenance('human_admin_reply')).toBe(false);
    expect(isTrustedProvenance(undefined)).toBe(false);
  });

  it('ของจริงแก้ค่าไม่ได้ (ถูก freeze ไว้)', () => {
    const p = keywordBotProvenance();
    expect(() => {
      Object.defineProperty(p, 'human_authored', { value: true });
    }).toThrow();
    expect(p.human_authored).toBe(false);
  });
});

describe('🔴 งานอัตโนมัติทุกชนิดต้องไม่ใช่ "คนพิมพ์เอง"', () => {
  it.each([
    ['บอทคีย์เวิร์ด', keywordBotProvenance()],
    ['scheduler', schedulerProvenance()],
    ['งานส่งเป็นชุด', bulkJobProvenance('admin-1')],
    ['งานอัตโนมัติของระบบ', systemAutomationProvenance()],
  ])('%s → human_authored = false', (_name, p) => {
    expect(p.human_authored).toBe(false);
    expect(p.kind).not.toBe('human_admin_reply');
  });
});

describe('โรงงานฝั่งคน ต้องมี session ของแอดมินจริง', () => {
  it('ไม่มี session → เรียกไม่ผ่าน (งานเบื้องหลังจึงใช้ไม่ได้)', async () => {
    authState.admin = null;
    await expect(humanAdminReply()).rejects.toThrow();
  });

  it('ผู้ดูตอบแชทไม่ได้ → ถูกปฏิเสธ', async () => {
    authState.admin = { id: 'v-1', role: 'viewer' };
    await expect(humanAdminReply()).rejects.toBeInstanceOf(ProvenanceDeniedError);
  });

  it('แอดมินตัวจริง → ได้ของที่มีตราประทับ และเป็นคนพิมพ์เอง', async () => {
    authState.admin = { id: 'a-1', role: 'admin' };
    const p = await humanAdminReply();
    expect(isTrustedProvenance(p)).toBe(true);
    expect(p.kind).toBe('human_admin_reply');
    expect(p.human_authored).toBe(true);
    expect(p.admin_id).toBe('a-1');
  });

  it('ตัวตนมาจาก session ไม่ใช่จากพารามิเตอร์ที่ผู้เรียกส่งมา', () => {
    // โรงงานนี้ไม่รับพารามิเตอร์ใด ๆ โดยตั้งใจ
    expect(humanAdminReply.length).toBe(0);
  });
});
