import { describe, expect, it } from 'vitest';
import { createDraftStore, draftKey } from './drafts';

function fixture() {
  const data = new Map<string, string>();
  return { data, storage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } } };
}
describe('inbox draft recovery', () => {
  it('recovers text after reload, isolates admins and clears sent drafts', () => {
    const { storage } = fixture();
    const key = draftKey('owner');
    const store = createDraftStore(key, () => storage);
    store.update(() => new Map([['room', { text: 'ร่างที่ยังไม่ส่ง', reply: null }]]));
    expect(createDraftStore(key, () => storage).read().get('room')?.text).toBe('ร่างที่ยังไม่ส่ง');
    expect(createDraftStore(draftKey('other'), () => storage).read().size).toBe(0);
    store.update(() => new Map());
    expect(createDraftStore(key, () => storage).read().size).toBe(0);
  });
  it('rejects expired and malformed data without breaking the inbox', () => {
    const { data, storage } = fixture();
    data.set('draft', JSON.stringify({ at: 1, texts: [['room', 'expired']] }));
    expect(createDraftStore('draft', () => storage, () => 86_400_002).read().size).toBe(0);
    data.set('draft', '{bad');
    expect(createDraftStore('draft', () => storage).read().size).toBe(0);
  });
  it('retains typing in memory and reports unavailable persistence', () => {
    const store = createDraftStore('draft', () => { throw new Error('blocked'); });
    expect(store.update(() => new Map([['room', { text: 'keep me', reply: null }]]))).toBe(false);
    expect(store.read().get('room')?.text).toBe('keep me');
    expect(store.read()).toBe(store.read());
  });
  it('notifies subscribers and applies successive edits to the latest text', () => {
    const { storage } = fixture();
    const store = createDraftStore('draft', () => storage);
    let changes = 0;
    const unsubscribe = store.subscribe(() => { changes++; });
    store.update(() => new Map([['room', { text: 'a', reply: null }]]));
    store.update((previous) => new Map([['room', { text: previous.get('room')!.text + 'b', reply: null }]]));
    expect(store.read().get('room')?.text).toBe('ab');
    expect(changes).toBe(2);
    unsubscribe();
    store.update(() => new Map());
    expect(changes).toBe(2);
  });
});
