import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), setting: vi.fn(), authorized: vi.fn(), started: vi.fn(), finished: vi.fn(), failed: vi.fn(), process: vi.fn(), scan: vi.fn(), flush: vi.fn() }));
vi.mock('@/lib/auth/current-admin', async (original) => ({
  ...await original<typeof import('@/lib/auth/current-admin')>(), requirePermission: mocks.authorized, requireOwner: mocks.authorized,
}));
vi.mock('@/lib/supabase/admin', () => ({ db: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/server/settings/service', () => ({ getRuntimeSetting: mocks.setting }));
vi.mock('@/server/workers/heartbeat', () => ({ heartbeatStarted: mocks.started, heartbeatFinished: mocks.finished, heartbeatFailed: mocks.failed }));
vi.mock('@/server/ingest/processor', () => ({ processWebhookBatch: mocks.process }));
vi.mock('@/server/notify/scan', () => ({ scanIdleAndClosing: mocks.scan }));
vi.mock('@/server/notify/dispatch', () => ({ flushNotifications: mocks.flush }));
import { AuthError } from '@/lib/auth/current-admin';
import { POST as ingest } from '../ingest/process/route';
import { POST as notify } from '../notify/flush/route';
import { POST as configure } from '../settings/workers/route';
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


describe('production schedule configuration', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.setting.mockResolvedValue('r'.repeat(40)); mocks.rpc.mockResolvedValue({data:true,error:null}); });
  const request = () => new Request('https://hubchat.test/api/settings/workers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'configure_schedule'})});
  it('uses the deployed credential and origin without returning the secret', async () => {
    mocks.authorized.mockResolvedValue({role:'owner'});
    const response = await configure(request());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('configure_worker_schedule',{p_app_url:'https://hubchat.test',p_token:'r'.repeat(40)});
    expect(await response.json()).toEqual({ok:true,data:{configured:true}});
  });
  it('requires owner permission before reading or storing credentials', async () => {
    mocks.authorized.mockRejectedValue(new AuthError('forbidden','ไม่มีสิทธิ์',403));
    expect((await configure(request())).status).toBe(403);
    expect(mocks.setting).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
