/**
 * notice.store — transient "that happened" messages.
 *
 * The gap this fills: an action whose only visible result is something LEAVING the screen has no
 * feedback at all. "Move to → Archive" was the clearest case — on a phone the detail view stayed
 * exactly where it was, so a write that landed perfectly well looked like a button that did nothing
 * (design/ui-test-plan.md §M).
 *
 * Deliberately NOT the home for the conflict banner or the update prompt. Those two are persistent
 * state — a parked conflict must still be there tomorrow — and anything that dismisses itself after
 * four seconds is the wrong shape for them. This is only for what you already know you just did.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

/** matches the `.notice--*` classes in theme/base.css; 'info' is the default and has no modifier */
export type NoticeVariant = 'info' | 'warning' | 'danger';

export interface Notice {
  id: string;
  message: string;
  variant: NoticeVariant;
  /** one button on the bar, e.g. Undo; pressing it also dismisses the bar */
  action?: NoticeAction;
}

export interface NoticeAction {
  label: string;
  run: () => void | Promise<void>;
}

/** long enough to read a short sentence without hunting for it, short enough not to sit in the way */
const DEFAULT_MS = 4000;

/**
 * At most three on screen. Not a nicety: a loop — "select all, archive" — would otherwise paper over
 * the page with its own confirmations, and on a 390px screen three bars is already a third of it.
 */
const MAX_VISIBLE = 3;

let seq = 0;

export const useNoticeStore = defineStore('notice', () => {
  const notices = ref<Notice[]>([]);
  /** id → timeout handle, so a manual dismiss doesn't leave a timer to fire into an empty list */
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function dismiss(id: string) {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
    notices.value = notices.value.filter((n) => n.id !== id);
  }

  /**
   * Show a message. Returns its id so a caller can retract one early (rare — the timer is the
   * normal exit).
   *
   * `duration: 0` pins it until dismissed by hand. That is for a failure the user has to actually
   * see; a success that never leaves is just clutter.
   */
  function notify(message: string, variant: NoticeVariant = 'info', duration = DEFAULT_MS, action?: NoticeAction): string {
    // Repeating an identical message restarts its clock instead of stacking a second copy — ticking
    // four tasks in a row should read as one confirmation, not as four bars fighting for the corner.
    // a bar with an action is never merged: its button belongs to one specific event
    const existing = action ? undefined : notices.value.find((n) => n.message === message && n.variant === variant && !n.action);
    if (existing) {
      const t = timers.get(existing.id);
      if (t) clearTimeout(t);
      if (duration > 0) timers.set(existing.id, setTimeout(() => dismiss(existing.id), duration));
      return existing.id;
    }

    const id = `notice-${++seq}`;
    // newest first: it is the one the user is waiting for, and on desktop it lands nearest the top
    notices.value = [{ id, message, variant, action }, ...notices.value];

    // drop the OLDEST when over the cap — the ones already read
    while (notices.value.length > MAX_VISIBLE) {
      dismiss(notices.value[notices.value.length - 1]!.id);
    }

    if (duration > 0) timers.set(id, setTimeout(() => dismiss(id), duration));
    return id;
  }

  /** every timer, cancelled — for teardown, and so tests don't leak handles between cases */
  function clear() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    notices.value = [];
  }

  const info = (message: string, duration?: number) => notify(message, 'info', duration);
  const warning = (message: string, duration?: number) => notify(message, 'warning', duration);
  const danger = (message: string, duration?: number) => notify(message, 'danger', duration);

  return { notices, notify, info, warning, danger, dismiss, clear };
});
