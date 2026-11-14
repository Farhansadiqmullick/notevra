/**
 * Snooze presets, shared by the item action bar (Archive's DetailPane) and the page action bar
 * (Single / Planning). One list so "Tomorrow, 9am" means the same thing wherever it's offered.
 *
 * Snoozing only RECORDS the intention — it's stored on the row and queued like any other write, so
 * the server has what it needs to actually deliver a reminder once sync lands
 * (design/note-properties.md §7).
 */
export interface SnoozeOption {
  label: string;
  at: () => number;
}

const startOfTomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
};

export const SNOOZE_OPTIONS: SnoozeOption[] = [
  { label: 'In 1 hour', at: () => Date.now() + 60 * 60 * 1000 },
  { label: 'This evening', at: () => { const d = new Date(); d.setHours(18, 0, 0, 0); return d.getTime(); } },
  { label: 'Tomorrow, 9am', at: startOfTomorrow },
  { label: 'Next week', at: () => startOfTomorrow() + 6 * 24 * 60 * 60 * 1000 },
];

export const shortWhen = (ts: number) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
export const fullWhen = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
