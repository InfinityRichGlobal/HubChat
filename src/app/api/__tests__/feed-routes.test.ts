import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  admin: { role: 'admin', allowed_page_ids: ['11111111-1111-4111-8111-111111111111'] },
  sync: vi.fn(), process: vi.fn(), comments: vi.fn(), conversations: vi.fn(),
}));
vi.mock('@/lib/auth/current-admin', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth/current-admin')>(),
  requireAdmin: vi.fn(async () => mocks.admin),
  requirePermission: vi.fn(async () => mocks.admin),
}));
vi.mock('@/server/comments/service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/server/comments/service')>(),
  listComments: mocks.comments, getFilterWords: vi.fn(async () => []),
}));
vi.mock('@/server/inbox/service', () => ({ listConversations: mocks.conversations }));
vi.mock('@/server/comments/sync', () => ({ syncPageComments: mocks.sync }));
vi.mock('@/server/ingest/processor', () => ({ processWebhookBatch: mocks.process }));

import { GET as getComments } from '../comments/route';
import { GET as getConversations } from '../conversations/route';
import { POST as syncComments } from '../comments/sync/route';

describe('feed routes do not trigger delivery and imports respect page permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admin.role = 'admin';
    mocks.comments.mockResolvedValue({ comments: [], unhandled_count: 0 });
    mocks.conversations.mockResolvedValue({ conversations: [] });
    mocks.sync.mockResolvedValue({ errors: [] });
  });

  it.each([
    ['/api/comments?sync=1', getComments],
    ['/api/conversations', getConversations],
  ] as const)('polling %s only reads data', async (path, handler) => {
    for (let i = 0; i < 3; i += 1) {
      expect((await handler(new NextRequest(`http://localhost${path}`))).status).toBe(200);
    }
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it.each(['limit=abc', 'limit=0', 'limit=201', 'page_id=invalid', 'status=wrong', 'before=invalid'])('rejects malformed feed filters: %s', async (query) => {
    expect((await getComments(new NextRequest(`http://localhost/api/comments?${query}`))).status).toBe(422);
    expect(mocks.comments).not.toHaveBeenCalled();
  });

  const request = (body: unknown) => new NextRequest('http://localhost/api/comments/sync', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  });

  it('rejects importing another page', async () => {
    expect((await syncComments(request({ page_id: '22222222-2222-4222-8222-222222222222' }))).status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('limits an all-page import to the admin allowed pages', async () => {
    expect((await syncComments(request({}))).status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith(undefined, mocks.admin.allowed_page_ids);
  });

  it('allows the owner to import all pages', async () => {
    mocks.admin.role = 'owner';
    expect((await syncComments(request({}))).status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith(undefined, undefined);
  });

  it('rejects malformed page identifiers before calling Meta', async () => {
    expect((await syncComments(request({ page_id: ['invalid'] }))).status).toBe(422);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
