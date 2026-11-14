/**
 * Network state, as a plain module so the engine (which isn't a component) can read and subscribe
 * to it. `navigator.onLine` is the browser's opinion and it lies both ways — a captive portal reads
 * "online", a VPN flap can read "offline" — so it's the *trigger*, never the proof. The proof is a
 * push that succeeds; a failed push schedules a retry regardless of what this says.
 */
type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();
let current = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

function set(v: boolean) {
  if (v === current) return;
  current = v;
  listeners.forEach((l) => l(v));
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => set(true));
  window.addEventListener('offline', () => set(false));
}

export const isOnline = () => current;

export function onOnlineChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** test seam — lets the suite simulate the cable coming out without touching globals */
export function __setOnline(v: boolean) {
  set(v);
}
