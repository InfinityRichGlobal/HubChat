'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { createDraftStore, draftKey, type InboxDraft } from './drafts';

const stores = new Map<string, ReturnType<typeof createDraftStore>>();
const empty = new Map<string, InboxDraft>();
const serverSnapshot = () => empty;
function storeFor(adminId: string) {
  let store = stores.get(adminId);
  if (!store) {
    store = createDraftStore(draftKey(adminId), () => window.sessionStorage);
    stores.set(adminId, store);
  }
  return store;
}
export function clearInboxDrafts(adminId: string) {
  storeFor(adminId).update(() => new Map());
}
export function useInboxDrafts(adminId: string) {
  const store = storeFor(adminId);
  const drafts = useSyncExternalStore(store.subscribe, store.read, serverSnapshot);
  const update = useCallback((change: (previous: Map<string, InboxDraft>) => Map<string, InboxDraft>) => store.update(change), [store]);
  return [drafts, update] as const;
}
