import { describe, it, expect, vi, afterEach } from 'vitest';

let hang = true;

vi.mock('@/core/auth/supabase', () => ({
  isAuthConfigured: true,
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => (hang ? new Promise(() => {}) : Promise.resolve({ data: null, error: null })),
        }),
      }),
    }),
  },
}));

import { syncProfile, ROUND_TIMEOUT_MS } from './profileSync';

describe('profileSync', () => {
  afterEach(() => vi.useRealTimers());

  it('a round that never answers times out instead of blocking the queue forever', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    hang = true;
    const stuck = syncProfile('user-1');
    await vi.advanceTimersByTimeAsync(ROUND_TIMEOUT_MS);
    expect(await stuck).toEqual({ status: 'failed', message: 'profile sync timed out' });

    hang = false;
    expect(await syncProfile('user-1')).toEqual({ status: 'in-sync' });
  });
});
