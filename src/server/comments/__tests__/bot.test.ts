import { describe, it, expect } from 'vitest';
import {
  CommentBotSettingsSchema,
  DEFAULT_COMMENT_BOT_SETTINGS,
  type CommentBotSettings,
} from '@/types/comment-bot';

describe('CommentBotSettingsSchema', () => {
  it('มีค่าเริ่มต้นที่ถูกต้องและปลอดภัย', () => {
    const parsed = CommentBotSettingsSchema.parse({});
    expect(parsed.reply_mode).toBe('ai');
    expect(parsed.auto_like).toBe(false);
    expect(parsed.auto_reply_public).toBe(false);
    expect(parsed.auto_reply_private).toBe(false);
    expect(parsed.auto_send_catalog).toBe(false);
    expect(parsed.filter_mode).toBe('all');
    expect(parsed.public_reply_template).toContain('{name}');
    expect(parsed.filter_keywords).toContain('สนใจ');
  });

  it('ยอมรับการตั้งค่าที่ถูกต้อง', () => {
    const custom: CommentBotSettings = {
      reply_mode: 'ai',
      auto_like: true,
      auto_reply_public: true,
      public_reply_template: 'สวัสดีค่ะคุณ {name}',
      public_reply_style: 'short',
      public_reply_instruction: 'ตอบสั้นกระชับ 1-2 ประโยค ชวนคุย ไม่บอกราคาหน้าโพสต์และเชิญชวนทักแชท',
      auto_reply_private: true,
      private_reply_template: 'ทักแชทแล้วค่ะคุณ {name}',
      private_reply_style: 'warm_welcome',
      private_reply_instruction: 'ทักทายลูกค้าอย่างอบอุ่น ขอบคุณที่สนใจ แนะนำโปรโมชั่นและสอบถามสินค้าที่ต้องการ',
      private_reply_image_url: null,
      private_reply_image_name: null,
      auto_send_catalog: true,
      filter_mode: 'keyword_only',
      filter_keywords: ['สนใจ', 'โปรโมชั่น'],
      rules: [
        {
          id: 'rule-1',
          keyword: 'ราคา',
          match_type: 'contains',
          public_reply: 'แจ้งราคาในแชทแล้วนะคะ',
          private_reply: 'ราคา 490 บาทค่ะ',
          is_active: true,
        },
      ],
    };
    const parsed = CommentBotSettingsSchema.parse(custom);
    expect(parsed.reply_mode).toBe('ai');
    expect(parsed.auto_like).toBe(true);
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0].keyword).toBe('ราคา');
  });

  it('ตัด whitespace ออกจากคำคีย์เวิร์ด', () => {
    const custom = {
      filter_keywords: ['  สนใจ  ', ' โปร '],
      rules: [
        {
          keyword: '  ราคา  ',
          match_type: 'exact' as const,
        },
      ],
    };
    const parsed = CommentBotSettingsSchema.parse(custom);
    expect(parsed.filter_keywords[0]).toBe('สนใจ');
    expect(parsed.rules[0].keyword).toBe('ราคา');
  });
});
