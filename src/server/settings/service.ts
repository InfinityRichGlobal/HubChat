import 'server-only';
import { db } from '@/lib/supabase/admin';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { logActivity } from '@/lib/activity-log';
import type { PublicAdmin } from '@/types/db';
import {
  SETTING_DEFINITIONS, isReadiness, parseSettingValue, readinessCanAdvance,
  settingDefinition, type Readiness, type SettingKey,
} from './registry';

export const RUNTIME_SETTING_SELECT =
  'key,kind,encrypted_value,plain_value,secret_hint,readiness,configured_at,tested_at,live_verified_at,updated_at';

type RuntimeRow = {
  key: string;
  kind: 'secret' | 'general';
  encrypted_value: string | null;
  plain_value: unknown;
  secret_hint: string | null;
  readiness: Readiness;
  configured_at: string;
  tested_at: string | null;
  live_verified_at: string | null;
  updated_at: string;
};

export type SafeSettingView = {
  key: string;
  label_th: string;
  group: string;
  kind: 'secret' | 'general';
  configured: boolean;
  value: string | null;
  hint_last4: string | null;
  readiness: Readiness | null;
  updated_at: string | null;
};

let cache = new Map<string, { value: string; expires: number }>();

function rowMap(rows: RuntimeRow[]): Map<string, RuntimeRow> {
  return new Map(rows.map((row) => [row.key, row]));
}

async function rows(keys?: string[]): Promise<RuntimeRow[]> {
  let query = db().from('runtime_settings').select(RUNTIME_SETTING_SELECT);
  if (keys?.length) query = query.in('key', keys);
  const { data, error } = await query;
  if (error) throw new Error(`อ่านค่าตั้งระบบไม่สำเร็จ: ${error.message}`);
  return (data ?? []) as RuntimeRow[];
}

export async function listSafeSettings(): Promise<SafeSettingView[]> {
  const found = rowMap(await rows());
  return SETTING_DEFINITIONS.map((definition) => {
    const row = found.get(definition.key);
    return {
      key: definition.key,
      label_th: definition.label_th,
      group: definition.group,
      kind: definition.kind,
      configured: Boolean(row),
      value: row?.kind === 'general' && typeof row.plain_value === 'string' ? row.plain_value : null,
      hint_last4: row?.kind === 'secret' ? row.secret_hint : null,
      readiness: row?.readiness ?? null,
      updated_at: row?.updated_at ?? null,
    };
  });
}

export async function getRuntimeSetting(key: SettingKey): Promise<string | null> {
  // Unit tests use fake transports and must never contact a real/fake remote database implicitly.
  if (process.env.NODE_ENV === 'test') return process.env[key]?.trim() || null;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const definition = settingDefinition(key);
  const row = (await rows([key]))[0];
  // ช่วงเปลี่ยนผ่าน: อ่าน env ได้ แต่ไม่คัดลอกเข้า DB และค่าใน DB ชนะเสมอ
  if (!row) return process.env[key]?.trim() || null;
  const value = definition.kind === 'secret'
    ? decryptSecret(row.encrypted_value ?? '')
    : (typeof row.plain_value === 'string' ? row.plain_value : null);
  if (value !== null) cache.set(key, { value, expires: Date.now() + 5_000 });
  return value;
}

export async function saveRuntimeSetting(admin: PublicAdmin, key: string, raw: unknown): Promise<void> {
  const definition = settingDefinition(key);
  const value = parseSettingValue(key, raw);
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = definition.kind === 'secret'
    ? { key, kind: definition.kind, encrypted_value: encryptSecret(value), plain_value: null, secret_hint: value.slice(-4), readiness: 'CONFIGURED', configured_at: now, tested_at: null, live_verified_at: null, updated_by: admin.id, updated_at: now }
    : { key, kind: definition.kind, encrypted_value: null, plain_value: value, secret_hint: null, readiness: 'CONFIGURED', configured_at: now, tested_at: null, live_verified_at: null, updated_by: admin.id, updated_at: now };
  const { error } = await db().from('runtime_settings').upsert(payload, { onConflict: 'key' });
  if (error) throw new Error(`บันทึกค่าตั้ง ${key} ไม่สำเร็จ: ${error.message}`);
  cache.delete(key);
  await logActivity({ adminId: admin.id, action: `${key} updated`, targetType: 'runtime_setting', targetId: key });
}

export async function deleteRuntimeSetting(admin: PublicAdmin, key: string): Promise<void> {
  settingDefinition(key);
  const { error } = await db().from('runtime_settings').delete().eq('key', key);
  if (error) throw new Error(`ลบค่าตั้ง ${key} ไม่สำเร็จ: ${error.message}`);
  cache.delete(key);
  await logActivity({ adminId: admin.id, action: `${key} deleted`, targetType: 'runtime_setting', targetId: key });
}

export async function updateReadiness(admin: PublicAdmin, key: string, target: unknown): Promise<void> {
  settingDefinition(key);
  if (!isReadiness(target)) throw new Error('สถานะ readiness ไม่ถูกต้อง');
  const current = (await rows([key]))[0];
  if (!current) throw new Error('ต้องตั้งค่าก่อนเปลี่ยน readiness');
  if (!readinessCanAdvance(current.readiness, target)) throw new Error('ต้องเลื่อน readiness ทีละขั้น');
  const now = new Date().toISOString();
  const patch: Record<string, string> = { readiness: target, updated_at: now };
  if (target === 'TESTED') patch.tested_at = now;
  if (target === 'LIVE_VERIFIED') patch.live_verified_at = now;
  const { error } = await db().from('runtime_settings').update(patch).eq('key', key);
  if (error) throw new Error(`อัปเดต readiness ${key} ไม่สำเร็จ: ${error.message}`);
  await logActivity({ adminId: admin.id, action: `${key} readiness ${target}`, targetType: 'runtime_setting', targetId: key });
}

export function clearRuntimeSettingCache(): void { cache = new Map(); }
