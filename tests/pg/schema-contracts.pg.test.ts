import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { postgresAvailable, resetDatabase, testPool } from './harness';
import { INBOX_SELECTS } from '@/server/inbox/service';
import { ORDER_SELECTS } from '@/server/orders/service';
import { COMMENT_SELECTS } from '@/server/comments/service';
import { NOTIFICATION_SELECTS } from '@/server/notify/prefs';
import { RUNTIME_SETTING_SELECT } from '@/server/settings/service';
import { WORKER_HEARTBEAT_SELECT } from '@/server/workers/heartbeat';
import { SEND_STATUS_SELECT } from '@/server/messaging/status-service';

const available = await postgresAvailable();
let pool: Pool;

function columns(select: string): string[] {
  return select.split(',').map((part) => part.trim()).filter(Boolean);
}

describe.skipIf(!available)('database select contracts', () => {
  beforeAll(async () => { await resetDatabase(); pool = await testPool(); });
  afterAll(async () => { await pool?.end(); });

  const contracts: Array<[string, string]> = [
    ['pages', INBOX_SELECTS.pages], ['conversations', INBOX_SELECTS.conversations],
    ['customers', INBOX_SELECTS.customers], ['messages', INBOX_SELECTS.messages],
    ['orders', ORDER_SELECTS.orders], ['products', ORDER_SELECTS.products],
    ['promotions', ORDER_SELECTS.promotions], ['comments', COMMENT_SELECTS.comments],
    ['app_settings', COMMENT_SELECTS.setting], ['notification_prefs', NOTIFICATION_SELECTS.prefs],
    ['pages', NOTIFICATION_SELECTS.pages], ['notification_jobs', NOTIFICATION_SELECTS.jobs],
    ['runtime_settings', RUNTIME_SETTING_SELECT], ['worker_heartbeats', WORKER_HEARTBEAT_SELECT],
    ['message_sends', SEND_STATUS_SELECT],
  ];

  for (const [table, select] of contracts) {
    it(`${table}: every selected column exists`, async () => {
      const result = await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [table],
      );
      const actual = new Set(result.rows.map((row) => row.column_name));
      expect(columns(select).filter((column) => !actual.has(column))).toEqual([]);
    });
  }
});
