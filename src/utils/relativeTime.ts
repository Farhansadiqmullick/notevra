/**
 * "just now" / "6 min ago" / "yesterday" / "12 Aug" — the scale people actually read at.
 *
 * Lived inside ActivityList until the Archive header needed the same words. Two copies of a
 * time formatter drift, and then the same moment reads differently in two places on one screen.
 */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
