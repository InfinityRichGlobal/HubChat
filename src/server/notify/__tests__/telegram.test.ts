/**
 * ชุดทดสอบการรวบข้อความ Telegram (รอบ 10)
 * ===========================================================================
 * 🔴 Telegram จำกัด ~20 ข้อความ/นาทีต่อกลุ่ม
 *    ถ้าส่งทีละข้อความ วันที่ลูกค้าทักพร้อมกัน 30 คน บอทจะโดนจำกัด
 *    แล้วแจ้งเตือน "หายทั้งหมด" ซึ่งแย่กว่าไม่มีระบบแจ้งเตือนเสียอีก
 */
import { describe, it, expect } from 'vitest';
import { buildBatch, buildBatchMessage, escapeHtml, explainTelegramError } from '../telegram';

describe('รวบข้อความเป็นก้อนเดียว', () => {
  it('⭐ 30 เหตุการณ์ ต้องกลายเป็นข้อความเดียว', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      title: `ลูกค้า ${i}`,
      body: 'สนใจค่ะ',
    }));
    const text = buildBatchMessage(items);
    expect(typeof text).toBe('string');
    expect(text).toContain('30 รายการ');
  });

  it('รายการเดียว = ข้อความสั้น ไม่ต้องขึ้นหัวว่ากี่รายการ', () => {
    const text = buildBatchMessage([{ title: 'ลูกค้าทักใหม่', body: 'สนใจโปรค่ะ' }]);
    expect(text).toContain('ลูกค้าทักใหม่');
    expect(text).toContain('สนใจโปรค่ะ');
    expect(text).not.toContain('รายการ');
  });

  it('ไม่มีอะไรเลย = ข้อความว่าง (ผู้เรียกจะได้ไม่ยิงเปล่า)', () => {
    expect(buildBatchMessage([])).toBe('');
  });

  it('ใส่ลิงก์ให้กดเข้าแอปได้', () => {
    const text = buildBatchMessage([
      { title: 'ลูกค้าทักใหม่', body: 'สนใจค่ะ', link: 'https://app.example/inbox?c=1' },
    ]);
    expect(text).toContain('https://app.example/inbox?c=1');
    expect(text).toContain('เปิดในแอป');
  });

  it('🔴 ข้อความยาวเกินเพดาน ต้องตัด ไม่ใช่ปล่อยให้ Telegram ปฏิเสธทั้งก้อน', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      title: `หัวข้อยาวมาก ${i} ${'ก'.repeat(80)}`,
      body: 'x'.repeat(80),
    }));
    const text = buildBatchMessage(items);
    expect(text.length).toBeLessThanOrEqual(4000);
    // ต้องบอกด้วยว่าเหลืออีกกี่รายการ ไม่ใช่หายเงียบ ๆ
    expect(text).toContain('และอีก');
  });

  it('🔴 อักขระ HTML ต้องถูก escape ไม่งั้น Telegram ปฏิเสธทั้งข้อความ', () => {
    const text = buildBatchMessage([{ title: '<b>ปลอม</b>', body: 'a & b < c' }]);
    expect(text).toContain('&lt;b&gt;');
    expect(text).toContain('&amp;');
  });

  it('escapeHtml ทำงานถูก', () => {
    expect(escapeHtml('<script>&"')).toBe('&lt;script&gt;&amp;"');
  });
});

describe('แปลข้อผิดพลาดของ Telegram', () => {
  it('token ผิด → บอกให้ไปสร้างใหม่ และไม่ต้องลองซ้ำ', () => {
    const r = explainTelegramError(401);
    expect(r.error_th).toContain('BotFather');
    expect(r.retryable).toBe(false);
  });

  it('หากลุ่มไม่เจอ → บอกวิธีแก้ที่ทำตามได้', () => {
    const r = explainTelegramError(400, 'Bad Request: chat not found');
    expect(r.error_th).toContain('ดึงบอทเข้ากลุ่ม');
    expect(r.retryable).toBe(false);
  });

  it('บอทโดนเตะออกจากกลุ่ม → ไม่ต้องลองซ้ำ', () => {
    expect(explainTelegramError(403).retryable).toBe(false);
  });

  it('ชนโควตา → ลองใหม่ได้', () => {
    const r = explainTelegramError(429);
    expect(r.retryable).toBe(true);
    expect(r.error_th).toContain('โควตา');
  });

  it('ข้อผิดพลาดที่ไม่รู้จัก → ลองใหม่ได้ และคงข้อความเดิมของ Telegram ไว้', () => {
    const r = explainTelegramError(500, 'Internal Server Error');
    expect(r.retryable).toBe(true);
    expect(r.error_th).toContain('Internal Server Error');
  });
});

/* ========================================================================== */
/* รอบตรวจซ้ำ — ของที่ล้นเพดานต้องไม่ "หายเงียบ"                                 */
/* ========================================================================== */

describe('🔴 ต้องบอกได้ว่าใส่ลงข้อความไปได้จริงกี่รายการ', () => {
  it('ใส่ได้ครบ → used เท่ากับจำนวนที่ส่งเข้าไป', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ title: `เรื่อง ${i}`, body: 'สั้น' }));
    expect(buildBatch(items).used).toBe(5);
  });

  it('⭐ ยาวเกินเพดาน → used ต้องน้อยกว่าจำนวนจริง (ไม่ใช่โกหกว่าส่งครบ)', () => {
    /**
     * ถ้า used โกหกว่าส่งครบ ผู้เรียกจะตีว่างานทั้งหมดถูกส่งแล้ว
     * แล้วเหตุการณ์ที่ล้นออกไปจะหายตลอดกาล เพราะกุญแจกันซ้ำบล็อกการเข้าคิวใหม่
     */
    const items = Array.from({ length: 300 }, (_, i) => ({
      title: `เรื่องที่ ${i}`,
      body: 'ข้อความยาวพอสมควรเพื่อให้ชนเพดานความยาวของ Telegram ได้จริง ๆ',
    }));
    const { text, used } = buildBatch(items);
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThan(items.length);
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain('รอบถัดไป');
  });

  it('รายการว่าง → used = 0 และไม่มีข้อความ', () => {
    expect(buildBatch([])).toEqual({ text: '', used: 0 });
  });

  it('buildBatchMessage เดิมยังใช้ได้เหมือนเดิม (ไม่ทำของเก่าพัง)', () => {
    const items = [{ title: 'ก', body: 'ข' }];
    expect(buildBatchMessage(items)).toBe(buildBatch(items).text);
  });
});
