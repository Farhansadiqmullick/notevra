import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizePrefs } from '@/composables/useNotificationPrefs';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('claimReminderLead', () => {
  it('a browser without Web Locks leads straight away', async () => {
    vi.stubGlobal('navigator', {});
    const { claimReminderLead, isReminderLead } = await import('./lead');
    const onLead = vi.fn();
    claimReminderLead(onLead);
    expect(onLead).toHaveBeenCalledOnce();
    expect(isReminderLead()).toBe(true);
  });

  it('waits for the lock, so a second tab does not lead while the first holds it', async () => {
    let grant: (() => void) | null = null;
    vi.stubGlobal('navigator', {
      locks: { request: (_name: string, cb: () => Promise<never>) => new Promise(() => (grant = () => void cb())) },
    });
    const { claimReminderLead, isReminderLead } = await import('./lead');
    const onLead = vi.fn();
    claimReminderLead(onLead);
    expect(onLead).not.toHaveBeenCalled();
    expect(isReminderLead()).toBe(false);
    grant!();
    expect(onLead).toHaveBeenCalledOnce();
  });
});

describe('reminder tone', () => {
  it('keeps a known tone and falls back to Chime for anything else', () => {
    expect(normalizePrefs({ tone: 'bell' }).tone).toBe('bell');
    expect(normalizePrefs({ tone: 'siren' }).tone).toBe('chime');
  });
});
