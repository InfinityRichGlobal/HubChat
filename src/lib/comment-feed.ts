import type { CommentRow } from '@/server/comments/service';

export type CommentStatus = 'pending' | 'review' | 'handled' | 'deleted';
export const COMMENT_STATUS_LABEL: Record<CommentStatus, string> = {
  pending: 'รอจัดการ', review: 'ต้องตรวจสอบ', handled: 'จัดการแล้ว', deleted: 'ลบแล้ว',
};
export function commentStatus(comment: CommentRow): CommentStatus {
  if (comment.is_deleted) return 'deleted';
  if (comment.last_error_th != null) return 'review';
  return comment.is_handled ? 'handled' : 'pending';
}
/** Keep the existing order while replacing overlapping rows with the fresh version. */
export function mergeCommentPage(existing: CommentRow[], incoming: CommentRow[]): CommentRow[] {
  const rows = new Map(existing.map((row) => [row.id, row]));
  for (const row of incoming) rows.set(row.id, row);
  return [...rows.values()];
}
