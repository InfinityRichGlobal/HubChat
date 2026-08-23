import 'server-only';
/**
 * ทะเบียน transport ทั้งหมด
 * ===========================================================================
 * เพิ่ม/ถอด transport ทำที่ไฟล์นี้ที่เดียว
 * ⚠️ ห้าม import ไฟล์ใน transports/ จากนอก src/server/messaging/
 *    ทางเข้าเดียวของการส่งข้อความคือ sendMessage()
 *    (ชุดทดสอบมีข้อที่ไล่ตรวจทั้งโปรเจกต์)
 */
import type { Channel, Transport } from '@/server/policy/types';
import type { TransportAdapter } from './types';
import { standardAdapter } from './standard';
import { humanAgentAdapter } from './human-agent';
import { utilityAdapter } from './utility';
import { marketingAdapter } from './marketing';

const ADAPTERS: TransportAdapter[] = [
  standardAdapter,
  humanAgentAdapter,
  utilityAdapter,
  marketingAdapter,
];

export function getAdapter(transport: Transport): TransportAdapter | null {
  return ADAPTERS.find((a) => a.transport === transport) ?? null;
}

export function allAdapters(): TransportAdapter[] {
  return [...ADAPTERS];
}

/** แผนที่ว่า transport ไหนรองรับแพลตฟอร์มไหน — ประกอบจาก adapter จริง */
export function transportChannelSupport(): Record<Transport, Channel[]> {
  const map = {} as Record<Transport, Channel[]>;
  for (const a of ADAPTERS) map[a.transport] = [...a.channels];
  return map;
}
