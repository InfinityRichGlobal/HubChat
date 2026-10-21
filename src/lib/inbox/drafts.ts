import type { MessageRow } from '@/server/inbox/service';

export type InboxDraft = { text: string; reply: MessageRow | null };
type Drafts = Map<string, InboxDraft>;
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const draftKey = (adminId: string) => `hubchat:inbox-drafts:v1:${adminId}`;
const MAX_AGE = 24 * 60 * 60 * 1000;

/** Text only: quoted customer messages and attachments are not persisted. */
export function createDraftStore(key: string, storage: () => DraftStorage, now = Date.now) {
  let current: Drafts | undefined;
  const listeners = new Set<() => void>();
  const read = () => {
    if (current) return current;
    current = new Map();
    try {
      const raw = storage().getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved.at === 'number' && now() - saved.at >= 0 && now() - saved.at < MAX_AGE && Array.isArray(saved.texts)) {
          for (const entry of saved.texts) {
            if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[1]) {
              current.set(entry[0], { text: entry[1], reply: null });
            }
          }
        } else storage().removeItem(key);
      }
    } catch { /* Unavailable or malformed storage must not break typing. */ }
    return current;
  };
  return {
    read,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(change: (previous: Drafts) => Drafts) {
      current = change(read());
      let persisted = true;
      try {
        const texts = [...current].filter(([, draft]) => draft.text).map(([id, draft]) => [id, draft.text]);
        if (texts.length) storage().setItem(key, JSON.stringify({ at: now(), texts }));
        else storage().removeItem(key);
      } catch { persisted = false; }
      listeners.forEach((listener) => listener());
      return persisted;
    },
  };
}
