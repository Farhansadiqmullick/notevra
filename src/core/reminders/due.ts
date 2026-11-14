// When a day-only due date ("YYYY-MM-DD") reminds you, in local time.

/** a reminder this much in the past still fires (app was closed); older ones are dropped, not flooded */
export const DUE_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function dueFireAt(due: unknown, time: string): number | null {
  if (typeof due !== 'string') return null;
  const d = DATE.exec(due);
  const t = TIME.exec(time);
  if (!d || !t) return null;
  const at = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), 0, 0);
  return Number.isNaN(at.getTime()) ? null : at.getTime();
}

/** one reminder per item per due date: moving the date earns a new one */
export const dueKey = (entity: 'block' | 'note', id: string, due: string) => `${entity}:${id}:${due}`;
