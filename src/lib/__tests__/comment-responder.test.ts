import { describe, expect, it } from 'vitest';
import { resolveResponder, type ReplyReceipt } from '../comment-responder';
const at = '2026-10-22T00:00:00Z';
const receipt: ReplyReceipt = { target_id: 'c1', action: 'comment.reply_public', admin_id: 'a1', created_at: '2026-10-22T00:00:01Z' };
const admins = [{ id: 'a1', name: 'Admin', avatar_url: 'https://example.com/avatar.png' }];
describe('comment responder evidence', () => {
  it('uses the actual sender profile for the matching channel', () => {
    expect(resolveResponder('c1', 'public', at, 'reply', [receipt], admins)).toMatchObject({ name: 'Admin', kind: 'admin', avatar_url: admins[0].avatar_url });
    expect(resolveResponder('c1', 'private', at, 'reply', [receipt], admins)).toBeNull();
  });
  it('does not guess bot identity from a missing admin or missing evidence', () => {
    expect(resolveResponder('c1', 'public', at, 'reply', [], admins)).toBeNull();
    expect(resolveResponder('c1', 'public', at, 'reply', [{ ...receipt, admin_id: null }], admins)).toBeNull();
    expect(resolveResponder('c1', 'public', at, 'reply', [{ ...receipt, action: 'comment.bot_reply_public', admin_id: null }], admins)?.kind).toBe('bot');
  });
  it('does not attribute an older receipt or an unconfirmed send', () => {
    expect(resolveResponder('c1', 'public', '2026-10-22T00:01:00Z', 'reply', [receipt], admins)).toBeNull();
    expect(resolveResponder('c1', 'public', at, null, [receipt], admins)).toBeNull();
    expect(resolveResponder('c2', 'public', at, 'reply', [receipt], admins)).toBeNull();
  });
});
