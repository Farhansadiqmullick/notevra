/**
 * useSteadyStatus — the sync indicator, without the flicker.
 *
 * THE PROBLEM. Every write enqueues an operation and the engine drains it almost immediately, so
 * the true status goes `synced → queued → synced` inside a few hundred milliseconds. Typing a
 * sentence does that once per debounced keystroke, and the sidebar spends the whole time strobing
 * between a green dot reading "All changes synced" and an amber one reading "1 change waiting to
 * sync". The information is correct and completely useless: nobody can read a label that changes
 * three times a second, and the movement pulls the eye away from the writing.
 *
 * THE FIX is the pattern a good loading spinner uses, in both directions:
 *
 *   1. **Wait before showing.** A busy state has to persist for `showAfter` before it appears at
 *      all. Sync that finishes in 80ms never renders anything — which is right, because a person
 *      does not need to be told about work they never waited for.
 *   2. **Stay once shown.** Having appeared, it holds for `minVisible` even if the work finished
 *      the instant after. Without this, slow-enough-to-show work still produces a one-frame blink,
 *      which is more distracting than either steady state.
 *
 * The result: quick saves are silent, real backlogs are legible, and the indicator changes at
 * human speed instead of at write speed.
 *
 * OFFLINE IS EXEMPT, on purpose. It is a condition rather than a blip — it lasts until the network
 * returns, and it changes what the user should expect from the app — so it appears and clears
 * immediately. Delaying it would mean typing into an app that has not yet admitted it is offline.
 */
import { ref, watch, onScopeDispose, type Ref } from 'vue';
import type { SyncStatus } from '@/types/models';

export interface SteadyOptions {
  /** how long a busy state must persist before it is shown at all */
  showAfter?: number;
  /** once shown, the least time it stays up */
  minVisible?: number;
}

/**
 * Defaults chosen against how the thing actually behaves, not from taste.
 *
 * `SHOW_AFTER` was 400ms, which is past a local flush (tens of ms) but not past a slow one — so
 * while someone was typing steadily the indicator still surfaced now and then, and each appearance
 * cost them their place. A full second is the threshold where a person starts wondering whether a
 * save worked; below it, saying nothing is not hiding anything from them.
 *
 * `MIN_VISIBLE` is 1200 rather than 700 because the sidebar now cross-fades between labels (~220ms
 * each way). At 700 the words spent a third of their life mid-fade, which is exactly the flicker
 * this file exists to remove. 1200 leaves about a second at full opacity — enough to read
 * "1 change waiting to sync" without hunting for it.
 */
export const SHOW_AFTER = 1000;
export const MIN_VISIBLE = 1200;

export function useSteadyStatus(source: () => SyncStatus, opts: SteadyOptions = {}): Ref<SyncStatus> {
  const showAfter = opts.showAfter ?? SHOW_AFTER;
  const minVisible = opts.minVisible ?? MIN_VISIBLE;

  const shown = ref<SyncStatus>(source());
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  /** when the current busy state became visible — 0 while showing 'synced' */
  let busySince = 0;

  const clearTimers = () => {
    if (showTimer) clearTimeout(showTimer);
    if (hideTimer) clearTimeout(hideTimer);
    showTimer = hideTimer = null;
  };

  watch(source, (next) => {
    clearTimers();

    // offline: immediate in both directions, and it also overrides a pending busy state
    if (next === 'offline' || shown.value === 'offline') {
      shown.value = next;
      busySince = next === 'synced' ? 0 : Date.now();
      return;
    }

    if (next !== 'synced') {
      if (shown.value !== 'synced') return; // already showing a busy state; don't restart its clock
      showTimer = setTimeout(() => {
        showTimer = null;
        // re-read rather than trusting `next`: the queue may well have drained while we waited,
        // and showing a state that is already over is the flicker this exists to prevent
        const now = source();
        if (now === 'synced') return;
        shown.value = now;
        busySince = Date.now();
      }, showAfter);
      return;
    }

    // settled. If a busy state is on screen, let it finish its minimum first.
    if (shown.value === 'synced') return;
    const held = Date.now() - busySince;
    if (held >= minVisible) {
      shown.value = 'synced';
      busySince = 0;
      return;
    }
    hideTimer = setTimeout(() => {
      hideTimer = null;
      // only settle if it is STILL settled — more work may have arrived during the hold
      if (source() !== 'synced') return;
      shown.value = 'synced';
      busySince = 0;
    }, minVisible - held);
  });

  onScopeDispose(clearTimers);

  return shown;
}
