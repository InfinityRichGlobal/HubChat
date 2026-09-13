import { z } from 'zod';

export type SettingKind = 'secret' | 'general';
export type Readiness = 'CONFIGURED' | 'TESTED' | 'LIVE_VERIFIED';

export type SettingDefinition = {
  key: string;
  label_th: string;
  group: 'Meta' | 'Storage' | 'Notifications' | 'Application' | 'AI';
  kind: SettingKind;
  schema: z.ZodType<string>;
};

const text = z.string().trim().min(1).max(4096);
const short = z.string().trim().min(1).max(500);
const url = z.string().trim().url().max(1000);
const positiveInt = z.string().trim().regex(/^\d+$/).refine((v) => Number(v) > 0 && Number(v) <= 10_000_000);

export const SETTING_DEFINITIONS = [
  { key: 'META_APP_SECRET', label_th: 'Meta App Secret', group: 'Meta', kind: 'secret', schema: text },
  { key: 'META_VERIFY_TOKEN', label_th: 'Meta Verify Token', group: 'Meta', kind: 'secret', schema: text },
  { key: 'GEMINI_API_KEY', label_th: 'Google Gemini API Key', group: 'AI', kind: 'secret', schema: text },
  { key: 'AI_SYSTEM_PROMPT', label_th: 'System Instruction (คำสั่งเทรนบุคลิก AI และกฎของร้าน)', group: 'AI', kind: 'general', schema: z.string().trim().min(1).max(20000) },
  { key: 'AI_STORE_KNOWLEDGE', label_th: 'Knowledge Base (ข้อมูลร้านค้า สินค้า และคำถามพบบ่อย)', group: 'AI', kind: 'general', schema: z.string().trim().min(1).max(30000) },
  { key: 'AI_MODEL', label_th: 'โมเดล Gemini', group: 'AI', kind: 'general', schema: z.string().trim().min(1).max(100) },
  { key: 'AI_TEMPERATURE', label_th: 'ความสร้างสรรค์ (0.0 - 1.0)', group: 'AI', kind: 'general', schema: z.string().trim().regex(/^0(\.\d+)?|1(\.0+)?$/) },
  { key: 'AI_AUTO_REPLY_COMMENTS', label_th: 'บอท AI ตอบคอมเมนต์อัตโนมัติ (on / off)', group: 'AI', kind: 'general', schema: z.enum(['on', 'off']) },
  { key: 'AI_ENABLE_COMMENT_SUGGEST', label_th: 'แสดงปุ่มแนะนำคำตอบ AI ในคอมเมนต์ (on / off)', group: 'AI', kind: 'general', schema: z.enum(['on', 'off']) },
  { key: 'AI_ENABLE_CHAT_ASSIST', label_th: 'ผู้ช่วย AI ในห้องแชท (on / off)', group: 'AI', kind: 'general', schema: z.enum(['on', 'off']) },
  { key: 'AI_DEFAULT_CHAT_BOT', label_th: 'ค่าเริ่มต้นบอทในแชทใหม่ (on / off)', group: 'AI', kind: 'general', schema: z.enum(['on', 'off']) },
  { key: 'AI_CHAT_INSTRUCTION', label_th: 'ชุดคำสั่งสอน AI ประจำแชท', group: 'AI', kind: 'general', schema: z.string().trim().min(1).max(10000) },
  { key: 'AI_CHAT_PERSONA', label_th: 'สไตล์นักขายประจำแชท', group: 'AI', kind: 'general', schema: z.enum(['sales_pro', 'consultative', 'fast', 'custom']) },
  { key: 'AI_ASSIST_CATEGORIES', label_th: 'หมวดหมู่ AI ช่วยคิดสำหรับตอบแชท (JSON)', group: 'AI', kind: 'general', schema: z.string().trim().min(1).max(50000) },
  { key: 'AI_RELATION_CATEGORIES', label_th: 'หมวดหมู่ข้อความสัมพันธ์และติดตามลูกค้า (JSON)', group: 'AI', kind: 'general', schema: z.string().trim().min(1).max(50000) },
  { key: 'AI_ASSIST_GLOBAL_PROMPT', label_th: 'คำสั่งเทรนส่วนกลางสำหรับ AI ผู้ช่วยแชท', group: 'AI', kind: 'general', schema: z.string().trim().min(1).max(10000) },
  { key: 'TELEGRAM_BOT_TOKEN', label_th: 'Telegram Bot Token', group: 'Notifications', kind: 'secret', schema: text },
  { key: 'CRON_SECRET', label_th: 'Cron Secret', group: 'Notifications', kind: 'secret', schema: text },
  { key: 'VAPID_PRIVATE_KEY', label_th: 'VAPID Private Key', group: 'Notifications', kind: 'secret', schema: text },
  { key: 'META_APP_ID', label_th: 'Meta App ID', group: 'Meta', kind: 'general', schema: short },
  { key: 'META_GRAPH_VERSION', label_th: 'Meta Graph Version', group: 'Meta', kind: 'general', schema: z.string().trim().regex(/^v\d+\.\d+$/) },
  { key: 'TELEGRAM_CHAT_ID', label_th: 'Telegram Chat ID', group: 'Notifications', kind: 'general', schema: short },
  { key: 'VAPID_PUBLIC_KEY', label_th: 'VAPID Public Key', group: 'Notifications', kind: 'general', schema: text },
  { key: 'VAPID_SUBJECT', label_th: 'VAPID Subject', group: 'Notifications', kind: 'general', schema: z.string().trim().refine((v) => v.startsWith('mailto:') || v.startsWith('https://')) },
  { key: 'APP_BASE_URL', label_th: 'App Base URL', group: 'Application', kind: 'general', schema: url },
  { key: 'APP_DISPLAY_NAME', label_th: 'ชื่อที่แสดงบนเว็บไซต์', group: 'Application', kind: 'general', schema: z.string().trim().min(1).max(80) },
  { key: 'APP_LOGO_URL', label_th: 'ลิงก์โลโก้เว็บไซต์', group: 'Application', kind: 'general', schema: url },
  { key: 'WORKER_INTERVAL_MS', label_th: 'Webhook worker interval (ms)', group: 'Application', kind: 'general', schema: positiveInt },
  { key: 'NOTIFY_INTERVAL_MS', label_th: 'Notification worker interval (ms)', group: 'Notifications', kind: 'general', schema: positiveInt },
  { key: 'AVATAR_DISPLAY_MODE', label_th: 'โหมดแสดงภาพโปรไฟล์ลูกค้า (platform / real_profile)', group: 'Application', kind: 'general', schema: z.enum(['platform', 'real_profile']) },
  { key: 'AVATAR_ORIGIN_BADGE', label_th: 'โหมดแสดงไอคอนมุมภาพบอกที่มา (off / on)', group: 'Application', kind: 'general', schema: z.enum(['off', 'on']) },
] as const satisfies readonly SettingDefinition[];

export type SettingKey = (typeof SETTING_DEFINITIONS)[number]['key'];
const byKey = new Map<string, SettingDefinition>(SETTING_DEFINITIONS.map((item) => [item.key, item]));

export function settingDefinition(key: string): SettingDefinition {
  const definition = byKey.get(key);
  if (!definition) throw new Error(`ไม่รู้จักค่าตั้ง ${key}`);
  return definition;
}

export function parseSettingValue(key: string, raw: unknown): string {
  return settingDefinition(key).schema.parse(raw);
}

export function isReadiness(value: unknown): value is Readiness {
  return value === 'CONFIGURED' || value === 'TESTED' || value === 'LIVE_VERIFIED';
}

export function readinessCanAdvance(from: Readiness, to: Readiness): boolean {
  const rank: Record<Readiness, number> = { CONFIGURED: 0, TESTED: 1, LIVE_VERIFIED: 2 };
  return rank[to] <= rank[from] + 1;
}
