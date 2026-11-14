/**
 * debounce — coalesce rapid calls (e.g. keystrokes) into one trailing call.
 *
 * `flush()` RUNS the pending call now; it used to just clearTimeout, i.e. silently *discard* the
 * newest keystrokes. Every "save then act" site (Enter, add row, switch page) was throwing away up
 * to 300ms of typing, and readers that then loaded the row from Dexie saw stale text.
 *
 * `cancel()` is the old behavior, kept for callers that are about to write the same state
 * themselves; `pending()` hands back the queued arguments so they can fold those un-saved edits
 * into that write instead of clobbering them.
 */
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  let queued: Parameters<T> | undefined;

  const run = () => {
    const args = queued;
    t = undefined;
    queued = undefined;
    if (args) fn(...args);
  };

  const wrapped = (...args: Parameters<T>) => {
    queued = args;
    clearTimeout(t);
    t = setTimeout(run, ms);
  };

  /** run the pending call immediately (no-op when nothing is queued) */
  wrapped.flush = () => {
    if (t === undefined) return;
    clearTimeout(t);
    run();
  };
  /** drop the pending call without running it */
  wrapped.cancel = () => {
    clearTimeout(t);
    t = undefined;
    queued = undefined;
  };
  /** the queued arguments, if a call is waiting */
  wrapped.pending = (): Parameters<T> | undefined => queued;

  return wrapped;
}
