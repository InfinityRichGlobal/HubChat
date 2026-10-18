'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

const CHANGE_EVENT = 'hubchat:preferences-changed';
function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Read persisted preferences after hydration, including changes in other tabs. */
export function useLocalPreference<T>(key: string, fallback: T, validate: (value: unknown) => value is T) {
  const read = useCallback(() => {
    try { return localStorage.getItem(key); } catch { return null; }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const value = useMemo(() => {
    try {
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      return validate(parsed) ? parsed : fallback;
    } catch { return fallback; }
  }, [raw, fallback, validate]);
  const save = useCallback((next: T) => {
    localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [key]);
  return [value, save] as const;
}
