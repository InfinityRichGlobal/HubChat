export type ReplyResponder = { name: string; avatar_url: string | null; kind: 'admin' | 'bot'; at: string };
export type ReplyReceipt = { target_id: string | null; action: string; admin_id: string | null; created_at: string };
export function resolveResponder(
  id: string, channel: 'public' | 'private', at: string | null | undefined, text: string | null,
  receipts: ReplyReceipt[], admins: { id: string; name: string; avatar_url?: string | null }[],
): ReplyResponder | null {
  if (!at || !text) return null;
  const log = receipts.find(log => log.target_id === id && log.action.endsWith(`_${channel}`));
  const delta = log ? Date.parse(log.created_at) - Date.parse(at) : NaN;
  // A later reply without a receipt must never inherit an earlier person's identity.
  if (!log || !Number.isFinite(delta) || delta < 0 || delta > 60000) return null;
  if (log.action === `comment.bot_reply_${channel}`) return { name: 'บอท HubChat', avatar_url: null, kind: 'bot', at };
  if (log.action !== `comment.reply_${channel}` || !log.admin_id) return null;
  const admin = admins.find(a => a.id === log.admin_id);
  return { name: admin?.name ?? 'แอดมิน (บัญชีเดิม)', avatar_url: admin?.avatar_url ?? null, kind: 'admin', at };
}
