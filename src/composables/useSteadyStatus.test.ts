/**
 * The anti-flicker rules for the sync indicator.
 *
 * Worth pinning down rather than eyeballing, because both ways of getting it wrong look fine in a
 * screenshot and only show up in motion: too eager and the sidebar strobes on every keystroke
 * (the bug this fixes), too lazy and a genuine backlog never surfaces at all — the user is left
 * believing everything saved while operations pile up in the outbox.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effectScope, ref, nextTick, type Ref } from 'vue';
import { useSteadyStatus, SHOW_AFTER as DEFAULT_SHOW_AFTER } from './useSteadyStatus';
import type { SyncStatus } from '@/types/models';

/**
 * The rules below are tested at fixed timings so they don't move when the defaults are tuned. The
 * defaults themselves are pinned separately, at the bottom — they are a product decision (how long
 * a writer is left alone), not an implementation detail.
 */
const SHOW_AFTER = 400;
const MIN_VISIBLE = 700;

let scope: ReturnType<typeof effectScope>;

/** drive the composable from a ref, the way the store drives it from a computed */
function harness(initial: SyncStatus = 'synced'): { src: Ref<SyncStatus>; shown: Ref<SyncStatus> } {
  const src = ref<SyncStatus>(initial);
  let shown!: Ref<SyncStatus>;
  scope = effectScope();
  scope.run(() => {
    shown = useSteadyStatus(() => src.value, { showAfter: SHOW_AFTER, minVisible: MIN_VISIBLE });
  });
  return { src, shown };
}

/** advance timers AND let Vue's watcher run — the watch is what schedules them */
async function tick(ms: number) {
  await nextTick();
  vi.advanceTimersByTime(ms);
  await nextTick();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  scope?.stop();
  vi.useRealTimers();
});

describe('quick work says nothing', () => {
  it('a flush that lands before the delay never shows at all', async () => {
    const { src, shown } = harness();

    src.value = 'queued';
    await tick(80); // a local flush is done in tens of ms
    expect(shown.value, 'shown before the delay elapsed').toBe('synced');

    src.value = 'synced';
    await tick(SHOW_AFTER * 2);
    expect(shown.value, 'a state nobody waited for should never have appeared').toBe('synced');
  });

  it('typing — many fast round trips — never moves the indicator', async () => {
    const { src, shown } = harness();
    const seen = new Set<SyncStatus>();

    for (let i = 0; i < 12; i++) {
      src.value = 'queued';
      await tick(60);
      seen.add(shown.value);
      src.value = 'synced';
      await tick(120);
      seen.add(shown.value);
    }

    expect([...seen], 'the sidebar strobed while the user was typing').toEqual(['synced']);
  });
});

describe('slow work is shown, and stays readable', () => {
  it('appears once the delay passes', async () => {
    const { src, shown } = harness();

    src.value = 'queued';
    await tick(SHOW_AFTER + 10);

    expect(shown.value).toBe('queued');
  });

  it('holds for the minimum even if the work finishes immediately after', async () => {
    const { src, shown } = harness();

    src.value = 'queued';
    await tick(SHOW_AFTER + 10);
    expect(shown.value).toBe('queued');

    src.value = 'synced'; // done one tick after it became visible
    await tick(50);
    expect(shown.value, 'a one-frame blink is worse than either steady state').toBe('queued');

    await tick(MIN_VISIBLE);
    expect(shown.value).toBe('synced');
  });

  it('clears immediately when it has already been visible long enough', async () => {
    const { src, shown } = harness();

    src.value = 'queued';
    await tick(SHOW_AFTER + MIN_VISIBLE + 100);
    expect(shown.value).toBe('queued');

    src.value = 'synced';
    await tick(0);
    expect(shown.value, 'no reason to hold a state that has been read').toBe('synced');
  });

  it('keeps showing busy if more work arrives during the hold', async () => {
    const { src, shown } = harness();

    src.value = 'queued';
    await tick(SHOW_AFTER + 10);
    src.value = 'synced';
    await tick(100);
    src.value = 'queued'; // another write, mid-hold

    await tick(MIN_VISIBLE * 2);
    expect(shown.value, 'settled while the outbox was not empty').toBe('queued');
  });
});

describe('offline is a condition, not a blip', () => {
  it('shows at once, with no delay', async () => {
    const { src, shown } = harness();

    src.value = 'offline';
    await tick(0);

    expect(shown.value, 'typing into an app that has not admitted it is offline').toBe('offline');
  });

  it('clears at once when the network returns', async () => {
    const { src, shown } = harness('offline');

    src.value = 'synced';
    await tick(0);

    expect(shown.value).toBe('synced');
  });

  it('overrides a busy state that is still waiting to appear', async () => {
    const { src, shown } = harness();

    src.value = 'queued';
    await tick(100); // inside the delay, nothing shown yet
    src.value = 'offline';
    await tick(0);

    expect(shown.value).toBe('offline');
  });
});

/**
 * The default delay is the promise made to someone who is writing: nothing moves in the corner of
 * your eye for a full second. It is easy to shave "just a bit" off in a future tweak and quietly
 * reintroduce the distraction, so it gets its own test rather than living only in a constant.
 */
describe('the default delay leaves a writer alone for a second', () => {
  it('is at least a second before anything appears', () => {
    expect(DEFAULT_SHOW_AFTER).toBeGreaterThanOrEqual(1000);
  });

  it('a 900ms round trip is never shown at all, using the real defaults', async () => {
    const src = ref<SyncStatus>('synced');
    let shown!: Ref<SyncStatus>;
    scope = effectScope();
    scope.run(() => (shown = useSteadyStatus(() => src.value)));

    src.value = 'queued';
    await tick(900); // slower than a local flush, still inside the window
    expect(shown.value).toBe('synced');

    src.value = 'synced';
    await tick(5000);
    expect(shown.value, 'work that finished inside the window should never have surfaced').toBe('synced');
  });
});
