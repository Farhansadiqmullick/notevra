import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { restoreScroll, rememberScroll, savedScroll, type Scrollable } from './useScrollMemory';

function fakeEl(scrollHeight: number, clientHeight = 500) {
  const listeners = new Map<string, () => void>();
  const el = {
    scrollTop: 0,
    scrollHeight,
    clientHeight,
    addEventListener: (ev: string, fn: () => void) => listeners.set(ev, fn),
    removeEventListener: (ev: string) => listeners.delete(ev),
  };
  return { el, fire: (ev: string) => listeners.get(ev)?.(), listeners };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('restoreScroll', () => {
  it('scrolls at once when the content is already tall enough', () => {
    const { el, listeners } = fakeEl(3000);
    restoreScroll(el as unknown as Scrollable, 1200);
    expect(el.scrollTop).toBe(1200);
    expect(listeners.size).toBe(0);
  });

  it('waits for the content to arrive before scrolling', () => {
    const { el } = fakeEl(500);
    restoreScroll(el as unknown as Scrollable, 1200);
    expect(el.scrollTop).toBe(0);
    el.scrollHeight = 3000;
    vi.advanceTimersByTime(60);
    expect(el.scrollTop).toBe(1200);
  });

  it('gives up waiting and scrolls as far as it can', () => {
    const { el } = fakeEl(800);
    restoreScroll(el as unknown as Scrollable, 1200);
    vi.advanceTimersByTime(2000);
    expect(el.scrollTop).toBe(1200);
  });

  it('a user scroll cancels the pending restore', () => {
    const { el, fire } = fakeEl(500);
    restoreScroll(el as unknown as Scrollable, 1200);
    fire('wheel');
    el.scrollHeight = 3000;
    vi.advanceTimersByTime(2000);
    expect(el.scrollTop).toBe(0);
  });
});

describe('saved positions', () => {
  it('are kept per key', () => {
    rememberScroll('page-a', 300);
    rememberScroll('page-b', 900);
    expect(savedScroll('page-a')).toBe(300);
    expect(savedScroll('page-b')).toBe(900);
    expect(savedScroll('page-c')).toBe(0);
  });
});
