import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ setting: vi.fn(), authorized: vi.fn(), started: vi.fn(), finished: vi.fn(), failed: vi.fn(), process: vi.fn(), scan: vi.fn(), flush: vi.fn() }));
vi.mock('@/lib/auth/current-admin', async (original) => ({
  ...await original<typeof import('@/lib/auth/current-admin')>(), requirePermission: mocks.authorized, requireOwner: mocks.authorized,
}));
vi.mock('@/server/settings/service', () => ({ getRuntimeSetting: mocks.setting }));
vi.mock('@/server/workers/heartbeat', () => ({ heartbeatStarted: mocks.started, heartbeatFinished: mocks.finished, heartbeatFailed: mocks.failed }));
vi.mock('@/server/ingest/processor', () => ({ processWebhookBatch: mocks.process }));
vi.mock('@/server/notify/scan', () => ({ scanIdleAndClosing: mocks.scan }));
vi.mock('@/server/notify/dispatch', () => ({ flushNotifications: mocks.flush }));
import { AuthError } from '@/lib/auth/current-admin';
import { POST as ingest } from '../ingest/process/route';
import { POST as notify } from '../notify/flush/route';
const req = (token: string) => new Request('https://hubchat.test/api/worker', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
describe.each([['ingest', ingest], ['notifications', notify]] as const)('%s worker authentication', (_name, handler) => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('CRON_SECRET', 'obsolete-environment-token');
    mocks.setting.mockResolvedValue('current-runtime-token');
    mocks.authorized.mockRejectedValue(new AuthError('no_session', 'กรุณาเข้าสู่ระบบ', 401));
    mocks.process.mockResolvedValue({ done: 0 }); mocks.scan.mockResolvedValue({ scanned: 0 }); mocks.flush.mockResolvedValue({ push_sent: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('uses the runtime setting even when a stale deployment environment token exists', async () => {
    expect((await handler(req('current-runtime-token'))).status).toBe(200);
    expect(mocks.authorized).not.toHaveBeenCalled(); expect(mocks.finished).toHaveBeenCalled();
  });
  it('rejects obsolete credentials without corrupting worker health', async () => {
    expect((await handler(req('obsolete-environment-token'))).status).toBe(401);
    expect(mocks.started).not.toHaveBeenCalled(); expect(mocks.failed).not.toHaveBeenCalled();
  });
});
