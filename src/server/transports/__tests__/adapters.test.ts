/**
 * ชุดทดสอบ transport adapter ทุกตัว
 * ตรวจว่า payload ที่ประกอบส่ง Meta ถูกรูปแบบ และตาข่ายกันพลาดชั้นสุดท้ายทำงานจริง
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { standardAdapter } from '../standard';
import { humanAgentAdapter } from '../human-agent';
import { utilityAdapter } from '../utility';
import { marketingAdapter } from '../marketing';
import { allAdapters, getAdapter, transportChannelSupport } from '../registry';
import { resetPolicyConfigCache } from '@/server/policy/config';
import type { SendContext } from '@/server/policy/types';

const PSID = 'psid-1234';

function ctx(overrides: Partial<SendContext> = {}): SendContext {
  return {
    customer_id: 'cus-1',
    conversation_id: 'conv-1',
    page_id: 'page-1',
    channel: 'messenger',
    message_type: 'inquiry_response',
    triggered_by: 'admin',
    human_typed: true,
    admin_id: 'admin-1',
    content: { text: 'สวัสดีค่ะ' },
    ...overrides,
  };
}

beforeEach(() => resetPolicyConfigCache());

/* ---------------------------------------------------------------- */
describe('STANDARD adapter', () => {
  it('ประกอบข้อความตัวอักษรได้ถูกรูปแบบ', () => {
    const built = standardAdapter.build(ctx(), PSID);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload).toMatchObject({
      recipient: { id: PSID },
      messaging_type: 'RESPONSE',
      message: { text: 'สวัสดีค่ะ' },
    });
    // ต้องไม่มี message tag ติดไปด้วย
    expect(built.payload).not.toHaveProperty('tag');
  });

  it('ส่งรูปด้วย attachment_id ที่อัปโหลดไว้แล้ว (สเปก 6.2)', () => {
    const built = standardAdapter.build(
      ctx({ content: { images: [{ meta_attachment_id: 'att-99' }] } }),
      PSID,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.message).toEqual({
      attachment: { type: 'image', payload: { attachment_id: 'att-99' } },
    });
  });

  it('ไม่มีเนื้อหา → ประกอบไม่ได้', () => {
    const built = standardAdapter.build(ctx({ content: {} }), PSID);
    expect(built.ok).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
describe('🔴 HUMAN_AGENT adapter — ตาข่ายกันพลาดชั้นสุดท้าย', () => {
  it('แอดมินพิมพ์เอง + ตอบคำถาม → ประกอบ payload ได้ พร้อม tag HUMAN_AGENT', () => {
    const built = humanAgentAdapter.build(ctx(), PSID);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload).toMatchObject({
      messaging_type: 'MESSAGE_TAG',
      tag: 'HUMAN_AGENT',
    });
  });

  it('บอทเรียก adapter ตรง ๆ โดยข้าม engine → ยังถูกปฏิเสธ', () => {
    const built = humanAgentAdapter.build(ctx({ triggered_by: 'bot', human_typed: false }), PSID);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason_th).toContain('แอดมินพิมพ์เอง');
  });

  it('scheduler เรียก adapter ตรง ๆ → ยังถูกปฏิเสธ', () => {
    const built = humanAgentAdapter.build(ctx({ triggered_by: 'scheduler', human_typed: false }), PSID);
    expect(built.ok).toBe(false);
  });

  it('ข้อความขายเรียก adapter ตรง ๆ → ยังถูกปฏิเสธ', () => {
    const built = humanAgentAdapter.build(ctx({ message_type: 'promotion' }), PSID);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason_th).toContain('ตอบคำถามลูกค้า');
  });
});

/* ---------------------------------------------------------------- */
describe('UTILITY adapter', () => {
  it('ต้องมีเทมเพลตเสมอ', () => {
    expect(utilityAdapter.build(ctx({ message_type: 'shipping_update' }), PSID).ok).toBe(false);
  });

  it('ประกอบเป็นข้อความเทมเพลต ไม่ใช่ข้อความอิสระ', () => {
    const built = utilityAdapter.build(
      ctx({
        message_type: 'shipping_update',
        content: { template_name: 'shipping_v1', template_params: { tracking_no: 'TH123' } },
      }),
      PSID,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload).toMatchObject({
      messaging_type: 'UTILITY',
      message: { template: { name: 'shipping_v1', parameters: { tracking_no: 'TH123' } } },
    });
  });

  it('ข้อความขายส่งผ่าน UTILITY ไม่ได้', () => {
    const built = utilityAdapter.build(
      ctx({ message_type: 'promotion', content: { template_name: 'shipping_v1' } }),
      PSID,
    );
    expect(built.ok).toBe(false);
  });

  it('ไม่รองรับ Instagram', () => {
    expect(utilityAdapter.channels).not.toContain('instagram');
    expect(utilityAdapter.isEligible(ctx({ channel: 'instagram' })).ok).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
describe('MARKETING adapter', () => {
  it('ประกอบเป็นข้อความเทมเพลต', () => {
    const built = marketingAdapter.build(
      ctx({ message_type: 'promotion', content: { template_name: 'promo_v1' } }),
      PSID,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload).toMatchObject({ messaging_type: 'MARKETING' });
  });

  it('ข้อความตอบคำถามส่งผ่าน MARKETING ไม่ได้', () => {
    const built = marketingAdapter.build(
      ctx({ message_type: 'inquiry_response', content: { template_name: 'promo_v1' } }),
      PSID,
    );
    expect(built.ok).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
describe('ทะเบียน transport', () => {
  it('มีครบ 4 ตัว', () => {
    expect(allAdapters().map((a) => a.transport).sort()).toEqual(
      ['HUMAN_AGENT', 'MARKETING', 'STANDARD', 'UTILITY'],
    );
  });

  it('หา adapter ตาม transport ได้', () => {
    expect(getAdapter('STANDARD')?.transport).toBe('STANDARD');
  });

  it('ตารางรองรับแพลตฟอร์มประกอบจาก adapter จริง', () => {
    const map = transportChannelSupport();
    expect(map.STANDARD).toEqual(['messenger', 'instagram']);
    expect(map.UTILITY).toEqual(['messenger']);
  });

  it('เปิด-ปิดจาก config ได้โดยไม่ต้องแก้โค้ด', () => {
    process.env.POLICY_MESSENGER_STANDARD_ENABLED = 'false';
    resetPolicyConfigCache();
    expect(standardAdapter.enabled('messenger')).toBe(false);

    process.env.POLICY_MESSENGER_STANDARD_ENABLED = 'true';
    resetPolicyConfigCache();
    expect(standardAdapter.enabled('messenger')).toBe(true);

    delete process.env.POLICY_MESSENGER_STANDARD_ENABLED;
    resetPolicyConfigCache();
  });

  it('ไม่มี adapter ตัวไหนใช้ message tag แบบเก่า', () => {
    const built = [
      standardAdapter.build(ctx(), PSID),
      humanAgentAdapter.build(ctx(), PSID),
      utilityAdapter.build(ctx({ message_type: 'order_update', content: { template_name: 't' } }), PSID),
      marketingAdapter.build(ctx({ message_type: 'promotion', content: { template_name: 't' } }), PSID),
    ];
    const json = JSON.stringify(built);
    expect(json).not.toContain('POST_PURCHASE_UPDATE');
    expect(json).not.toContain('ACCOUNT_UPDATE');
    expect(json).not.toContain('CONFIRMED_EVENT_UPDATE');
  });
});
