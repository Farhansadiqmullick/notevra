// Which pages were touched in a time window: created, renamed or edited, or a block last changed.
import type { NoteRow } from '@/core/db/schema';
import type { PageType } from '@/types/models';

export type Period = 'today' | 'yesterday' | 'week' | 'month';
export interface Range { from: number; to: number }
export interface Touch { noteId: string; at: number }

export interface ChangedPage {
  id: string;
  title: string;
  type: PageType;
  workspaceId: string;
  space: string;
  /** the latest touch inside the window */
  changedAt: number;
  /** true when the page was made inside the window */
  created: boolean;
}

/** local midnight at the start of the day holding `ms` */
export function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// setDate, not +DAY: a daylight-saving day is 23 or 25 hours long
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return dayStart(d.getTime());
}

export function rangeFor(period: Period, now = Date.now()): Range {
  const today = dayStart(now);
  const tomorrow = addDays(today, 1);
  if (period === 'yesterday') return { from: addDays(today, -1), to: today };
  if (period === 'week') return { from: addDays(today, -6), to: tomorrow };
  if (period === 'month') return { from: addDays(today, -29), to: tomorrow };
  return { from: today, to: tomorrow };
}

/** the calendar month holding `ms`, as a range */
export function monthRange(ms: number): Range {
  const d = new Date(ms);
  return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
}

const inRange = (at: number | undefined, r: Range): at is number => at != null && at >= r.from && at < r.to;

/** every touch of a live page inside the range, from the page row itself and its blocks */
function touchesIn(notes: NoteRow[], blockTouches: Touch[], r: Range): Map<string, Touch[]> {
  const live = new Map(notes.filter((n) => !n.deletedAt && !n.archived).map((n) => [n.id, n]));
  const out = new Map<string, Touch[]>();
  const add = (t: Touch) => {
    if (!live.has(t.noteId) || !inRange(t.at, r)) return;
    const list = out.get(t.noteId);
    if (list) list.push(t);
    else out.set(t.noteId, [t]);
  };
  for (const n of live.values()) {
    add({ noteId: n.id, at: n.updatedAt });
    if (n.createdAt != null) add({ noteId: n.id, at: n.createdAt });
  }
  for (const t of blockTouches) add(t);
  return out;
}

export function changedPages(notes: NoteRow[], blockTouches: Touch[], spaceNames: Map<string, string>, r: Range): ChangedPage[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const out: ChangedPage[] = [];
  for (const [id, touches] of touchesIn(notes, blockTouches, r)) {
    const n = byId.get(id)!;
    out.push({
      id,
      title: n.title,
      type: n.type,
      workspaceId: n.workspaceId,
      space: spaceNames.get(n.workspaceId) ?? '',
      changedAt: Math.max(...touches.map((t) => t.at)),
      created: inRange(n.createdAt, r),
    });
  }
  return out.sort((a, b) => b.changedAt - a.changedAt);
}

/** how many different pages were touched on each day of the range, keyed by that day's midnight */
export function pagesPerDay(notes: NoteRow[], blockTouches: Touch[], r: Range): Map<number, number> {
  const days = new Map<number, Set<string>>();
  for (const [id, touches] of touchesIn(notes, blockTouches, r)) {
    for (const t of touches) {
      const day = dayStart(t.at);
      const set = days.get(day);
      if (set) set.add(id);
      else days.set(day, new Set([id]));
    }
  }
  return new Map([...days].map(([day, ids]) => [day, ids.size]));
}
