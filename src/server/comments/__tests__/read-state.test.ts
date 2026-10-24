import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicAdmin } from '@/types/db';

const state = vi.hoisted(() => ({ row: {} as Record<string, unknown> }));
vi.mock('@/lib/supabase/admin', () => ({
  db: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: { ...state.row }, error: null }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            if (table === 'comments') Object.assign(state.row, patch);
            return { error: null };
          },
        }),
      };
      return query;
    },
  }),
}));

import { setHandled } from '../service';

describe('Reading a failed comment', () => {
  beforeEach(() => {
    state.row = { id: 'comment', page_id: 'page', is_handled: false,
      replied_private: false, last_error_th: 'Meta 200 / 2534066' };
  });

  it('keeps the failure visible when read and unread', async () => {
    const admin = { id: 'owner', role: 'owner', allowed_page_ids: [] } as unknown as PublicAdmin;
    const read = await setHandled(admin, 'comment', true);
    expect(read.is_handled).toBe(true);
    expect(read.last_error_th).toBe('Meta 200 / 2534066');
    expect(read.replied_private).toBe(false);
    const unread = await setHandled(admin, 'comment', false);
    expect(unread.is_handled).toBe(false);
    expect(unread.last_error_th).toBe('Meta 200 / 2534066');
  });
});
