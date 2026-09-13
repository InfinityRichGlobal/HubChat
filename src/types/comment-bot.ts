import { z } from 'zod';

export const CommentBotRuleSchema = z.object({
  id: z.string().optional(),
  keyword: z.string().trim().min(1).max(100),
  match_type: z.enum(['contains', 'exact', 'starts_with']).default('contains'),
  public_reply: z.string().max(1000).optional().nullable(),
  private_reply: z.string().max(1000).optional().nullable(),
  is_active: z.boolean().default(true),
});

export type CommentBotRule = z.infer<typeof CommentBotRuleSchema>;

export const CommentBotSettingsSchema = z.object({
  reply_mode: z.enum(['ai', 'template']).default('ai'),
  auto_like: z.boolean().default(false),
  auto_reply_public: z.boolean().default(false),
  public_reply_template: z.string().max(1000).default('ขอบคุณที่สนใจนะคะ {name} ทักแชทไปเรียบร้อยแล้วค่า 🥰'),
  public_reply_style: z.enum(['short', 'friendly', 'custom']).default('short'),
  public_reply_instruction: z.string().max(1000).default('ตอบสั้นกระชับ 1-2 ประโยค ชวนคุย ไม่บอกราคาหน้าโพสต์และเชิญชวนทักแชท'),
  auto_reply_private: z.boolean().default(false),
  private_reply_template: z.string().max(1000).default('สวัสดีค่ะ {name} ยินดีให้บริการค่ะ ต้องการสอบถามข้อมูลหรือสั่งซื้อสินค้าชิ้นไหนแจ้งได้เลยนะคะ'),
  private_reply_style: z.enum(['warm_welcome', 'promo', 'custom']).default('warm_welcome'),
  private_reply_instruction: z.string().max(1000).default('ทักทายลูกค้าอย่างอบอุ่น ขอบคุณที่สนใจ แนะนำโปรโมชั่นและสอบถามสินค้าที่ต้องการ'),
  private_reply_image_url: z.string().nullable().optional().default(null),
  private_reply_image_name: z.string().nullable().optional().default(null),
  auto_send_catalog: z.boolean().default(false),
  filter_mode: z.enum(['all', 'keyword_only']).default('all'),
  filter_keywords: z.array(z.string().trim().max(100)).default(['สนใจ', 'ราคา', 'สั่งซื้อ', 'มีของไหม', 'โปร']),
  rules: z.array(CommentBotRuleSchema).default([]),
});

export type CommentBotSettings = z.infer<typeof CommentBotSettingsSchema>;

export const DEFAULT_COMMENT_BOT_SETTINGS: CommentBotSettings = {
  reply_mode: 'ai',
  auto_like: false,
  auto_reply_public: false,
  public_reply_template: 'ขอบคุณที่สนใจนะคะ {name} ทักแชทไปเรียบร้อยแล้วค่า 🥰',
  public_reply_style: 'short',
  public_reply_instruction: 'ตอบสั้นกระชับ 1-2 ประโยค ชวนคุย ไม่บอกราคาหน้าโพสต์และเชิญชวนทักแชท',
  auto_reply_private: false,
  private_reply_template: 'สวัสดีค่ะ {name} ยินดีให้บริการค่ะ ต้องการสอบถามข้อมูลหรือสั่งซื้อสินค้าชิ้นไหนแจ้งได้เลยนะคะ',
  private_reply_style: 'warm_welcome',
  private_reply_instruction: 'ทักทายลูกค้าอย่างอบอุ่น ขอบคุณที่สนใจ แนะนำโปรโมชั่นและสอบถามสินค้าที่ต้องการ',
  private_reply_image_url: null,
  private_reply_image_name: null,
  auto_send_catalog: false,
  filter_mode: 'all',
  filter_keywords: ['สนใจ', 'ราคา', 'สั่งซื้อ', 'มีของไหม', 'โปร'],
  rules: [],
};

export type CommentBotTestResult = {
  matched_rule: CommentBotRule | null;
  passes_filter: boolean;
  filter_reason: string;
  would_like: boolean;
  would_reply_public: boolean;
  public_reply_mode: 'ai' | 'template' | 'rule' | 'none';
  public_reply_text: string | null;
  would_reply_private: boolean;
  private_reply_mode: 'ai' | 'template' | 'rule' | 'none';
  private_reply_text: string | null;
  private_reply_image_url: string | null;
  catalog_attached: boolean;
  catalog_preview: string | null;
};
