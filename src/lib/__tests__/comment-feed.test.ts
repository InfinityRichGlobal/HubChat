import { describe, expect, it } from 'vitest';
import { commentStatus, mergeCommentPage } from '../comment-feed';
import type { CommentRow } from '@/server/comments/service';
const row = (over: Partial<CommentRow>) => ({ is_handled: false, is_deleted: false, last_error_th: null, ...over }) as CommentRow;
describe('comment work queue', () => {
  it('shows failures even when a bot marked the comment handled', () => {
    expect(commentStatus(row({ is_handled: true, last_error_th: 'failed' }))).toBe('review');
    expect(commentStatus(row({ is_deleted: true, last_error_th: 'failed' }))).toBe('deleted');
    expect(commentStatus(row({ is_handled: true }))).toBe('handled');
    expect(commentStatus(row({}))).toBe('pending');
  });
  it('merges overlapping pages without duplicate rows and preserves fresh state', () => {
    const result = mergeCommentPage([row({ id: 'a' }), row({ id: 'b' })], [row({ id: 'b', is_handled: true }), row({ id: 'c' })]);
    expect(result.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(result[1].is_handled).toBe(true);
  });
});
