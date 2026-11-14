/**
 * notice.store — the rules that keep a confirmation bar from becoming a nuisance.
 *
 * Worth testing rather than eyeballing: every one of these is about what happens when the app is
 * BUSY (a batch of writes, a repeated action, a fast dismiss), which is exactly the state you can't
 * reproduce by clicking once and looking at the corner.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useNoticeStore } from './notice.store';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('notice.store', () => {
  it('shows a message and defaults it to info', () => {
    const s = useNoticeStore();
    s.notify('Moved to Archive');
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]!.message).toBe('Moved to Archive');
    expect(s.notices[0]!.variant).toBe('info');
  });

  it('dismisses itself after the timeout', () => {
    const s = useNoticeStore();
    s.info('Moved to Archive');
    vi.advanceTimersByTime(3999);
    expect(s.notices).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(s.notices).toHaveLength(0);
  });

  it('puts the newest first — it is the one being waited for', () => {
    const s = useNoticeStore();
    s.info('first');
    s.info('second');
    expect(s.notices.map((n) => n.message)).toEqual(['second', 'first']);
  });

  it('restarts the clock on a repeat instead of stacking a duplicate', () => {
    const s = useNoticeStore();
    s.info('Moved to Archive');
    vi.advanceTimersByTime(3000);
    s.info('Moved to Archive'); // same message again — archiving a second task

    expect(s.notices).toHaveLength(1);
    // the original 4s deadline has passed; the refreshed one has not
    vi.advanceTimersByTime(1500);
    expect(s.notices, 'the repeat should have reset the timer').toHaveLength(1);
    vi.advanceTimersByTime(2500);
    expect(s.notices).toHaveLength(0);
  });

  it('treats the same text at a different severity as a different message', () => {
    const s = useNoticeStore();
    s.info('Moved');
    s.danger('Moved');
    expect(s.notices).toHaveLength(2);
  });

  it('caps the stack at three, dropping the oldest', () => {
    const s = useNoticeStore();
    for (const m of ['one', 'two', 'three', 'four']) s.info(m);
    expect(s.notices.map((n) => n.message)).toEqual(['four', 'three', 'two']);
  });

  it('a manual dismiss cancels the timer, so a later one cannot remove a newer bar', () => {
    const s = useNoticeStore();
    s.info('first');
    const id = s.notices[0]!.id;
    s.dismiss(id);
    expect(s.notices).toHaveLength(0);

    // a message posted after the dismiss must survive the dead one's original deadline
    vi.advanceTimersByTime(3000);
    s.info('second');
    vi.advanceTimersByTime(1000); // the first bar's 4s mark
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]!.message).toBe('second');
  });

  it('duration 0 pins the message — a failure has to be seen', () => {
    const s = useNoticeStore();
    s.danger('Could not move this task to Archive', 0);
    vi.advanceTimersByTime(60_000);
    expect(s.notices).toHaveLength(1);
  });

  it('clear() empties the list and leaves no timer behind', () => {
    const s = useNoticeStore();
    s.info('one');
    s.warning('two');
    s.clear();
    expect(s.notices).toHaveLength(0);
    // if clear() had left the timers running, this would throw on a missing entry or re-empty a
    // list that has since been refilled
    s.info('three');
    vi.advanceTimersByTime(3000);
    expect(s.notices).toHaveLength(1);
  });
});
