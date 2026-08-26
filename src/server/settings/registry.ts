import { z } from 'zod';

export type SettingKind = 'secret' | 'general';
export type Readiness = 'CONFIGURED' | 'TESTED' | 'LIVE_VERIFIED';

export type SettingDefinition = {
  key: string;
  label_th: string;
  group: 'Meta' | 'Storage' | 'Notifications' | 'Application';
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
  { key: 'R2_ACCOUNT_ID', label_th: 'R2 Account ID', group: 'Storage', kind: 'secret', schema: short },
  { key: 'R2_ACCESS_KEY_ID', label_th: 'R2 Access Key ID', group: 'Storage', kind: 'secret', schema: text },
  { key: 'R2_SECRET_ACCESS_KEY', label_th: 'R2 Secret Access Key', group: 'Storage', kind: 'secret', schema: text },
  { key: 'TELEGRAM_BOT_TOKEN', label_th: 'Telegram Bot Token', group: 'Notifications', kind: 'secret', schema: text },
  { key: 'CRON_SECRET', label_th: 'Cron Secret', group: 'Notifications', kind: 'secret', schema: text },
  { key: 'VAPID_PRIVATE_KEY', label_th: 'VAPID Private Key', group: 'Notifications', kind: 'secret', schema: text },
  { key: 'META_APP_ID', label_th: 'Meta App ID', group: 'Meta', kind: 'general', schema: short },
  { key: 'META_GRAPH_VERSION', label_th: 'Meta Graph Version', group: 'Meta', kind: 'general', schema: z.string().trim().regex(/^v\d+\.\d+$/) },
  { key: 'R2_BUCKET', label_th: 'R2 Bucket', group: 'Storage', kind: 'general', schema: short },
  { key: 'R2_PUBLIC_BASE_URL', label_th: 'R2 Public Base URL', group: 'Storage', kind: 'general', schema: url },
  { key: 'TELEGRAM_CHAT_ID', label_th: 'Telegram Chat ID', group: 'Notifications', kind: 'general', schema: short },
  { key: 'VAPID_PUBLIC_KEY', label_th: 'VAPID Public Key', group: 'Notifications', kind: 'general', schema: text },
  { key: 'VAPID_SUBJECT', label_th: 'VAPID Subject', group: 'Notifications', kind: 'general', schema: z.string().trim().refine((v) => v.startsWith('mailto:') || v.startsWith('https://')) },
  { key: 'APP_BASE_URL', label_th: 'App Base URL', group: 'Application', kind: 'general', schema: url },
  { key: 'WORKER_INTERVAL_MS', label_th: 'Webhook worker interval (ms)', group: 'Application', kind: 'general', schema: positiveInt },
  { key: 'NOTIFY_INTERVAL_MS', label_th: 'Notification worker interval (ms)', group: 'Notifications', kind: 'general', schema: positiveInt },
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
