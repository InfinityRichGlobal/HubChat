import { z } from 'zod';

export type InboxCursor = { at: string; id: string };
const cursorSchema = z.object({ at: z.string().datetime({ offset: true }), id: z.string().uuid() });

/** Match the database's timestamp + UUID ordering, including tied timestamps. */
export function cursorFilter(column: 'created_at' | 'last_message_at', at: string, id: string, direction: 'lt' | 'gt'): string {
  const cursor = cursorSchema.parse({ at, id });
  return `${column}.${direction}.${cursor.at},and(${column}.eq.${cursor.at},id.${direction}.${cursor.id})`;
}

export function compareCursor(a: InboxCursor, b: InboxCursor): number {
  const time = Date.parse(a.at) - Date.parse(b.at);
  const micros = (at: string) => Number((at.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6));
  return time || micros(a.at) - micros(b.at) || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1);
}
