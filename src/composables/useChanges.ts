// Live page history for a time range: the pages touched in it, and how many on each day.
import { computed } from 'vue';
import { db, type NoteRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { changedPages, pagesPerDay, rangeFor, type Range, type Touch } from '@/core/history/changes';

export function useChanges(range: () => Range) {
  const notes = useLiveQuery<NoteRow[]>(() => db.notes.toArray(), []);
  const workspaces = useLiveQuery(() => db.workspaces.toArray(), []);

  // an index range scan on updatedAt, so a month reads that month's blocks, not the library
  const blockTouches = useLiveQuery<Touch[]>(
    () => {
      const r = range();
      return db.blocks
        .where('updatedAt')
        .between(r.from, r.to, true, false)
        .filter((b) => !b.deletedAt)
        .toArray()
        .then((rows) => rows.map((b) => ({ noteId: b.noteId, at: b.updatedAt })));
    },
    [],
    () => {
      const r = range();
      return `${r.from}-${r.to}`;
    },
  );

  const spaceNames = computed(() => new Map(workspaces.value.map((w) => [w.id, w.kind === 'personal' ? 'Personal' : w.name])));
  const pages = computed(() => changedPages(notes.value, blockTouches.value, spaceNames.value, range()));
  const perDay = computed(() => pagesPerDay(notes.value, blockTouches.value, range()));

  return { pages, perDay };
}

// the sidebar badge; the range is read on every recompute, so a session left open past midnight moves on
export const useChangedToday = () => useChanges(() => rangeFor('today'));
