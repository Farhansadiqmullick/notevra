/**
 * useArchive — everything the Archive page needs, as one composable (ARCHITECTURE.md §4.1).
 * READS via liveQuery (reactive), WRITES via blockService (the queued path). The page
 * components stay dumb; this holds the filter, selection and counts.
 */
import { ref, computed } from 'vue';
import { db, type BlockRow, type NoteRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { blockService } from '@/services/block.service';
import { pinnedFirst } from '@/services/pin.service';

export type ArchiveFilter = 'open' | 'all' | 'done';

/**
 * How the list is ordered. 'added' is the stored order (`position`) and is the default.
 *
 * It stays reachable rather than being replaced by a plain asc/desc toggle: `position` is the order
 * you actually created things in, and once an A→Z toggle is the only control there is no way back
 * to it. Sorting here is a VIEW concern — it never writes `position`, so nothing is reordered on
 * disk and no sync operation is queued by looking at your list differently.
 */
export type ArchiveSort = 'added' | 'asc' | 'desc';

export const SORT_LABEL: Record<ArchiveSort, string> = {
  added: 'Added',
  asc: 'A → Z',
  desc: 'Z → A',
};

export function useArchive(noteId: string) {
  const note = useLiveQuery<NoteRow | undefined>(() => db.notes.get(noteId), undefined);

  // top-level task blocks of this note (children are shown inside the detail pane)
  const items = useLiveQuery<BlockRow[]>(
    () =>
      db.blocks
        .where('noteId')
        .equals(noteId)
        .filter((b) => b.parentBlock == null && !b.deletedAt)
        .sortBy('position'),
    [],
  );

  const filter = ref<ArchiveFilter>('open');
  // "Move to → Archive" and an active snooze both take an item out of the open list without
  // deleting it (design/note-properties.md §4–5)
  const isParked = (b: BlockRow) =>
    b.props?.archived === 1 || ((b.props?.snoozedUntil as number | undefined) ?? 0) > Date.now();
  const openItems = computed(() => items.value.filter((b) => !b.checked && !isParked(b)));

  const sort = ref<ArchiveSort>('added');
  /** Added → A→Z → Z→A → Added. One button, no menu to open on a phone. */
  function cycleSort() {
    sort.value = sort.value === 'added' ? 'asc' : sort.value === 'asc' ? 'desc' : 'added';
  }

  /**
   * `localeCompare` rather than `<`: it puts accented words where a reader expects them, and
   * `numeric` makes "Item 10" come after "Item 2" instead of after "Item 1". Always on a COPY —
   * the array belongs to a liveQuery and sorting in place would mutate cached results.
   */
  function ordered(list: BlockRow[]): BlockRow[] {
    // pins win over every sort
    if (sort.value === 'added') return pinnedFirst(list);
    const dir = sort.value === 'asc' ? 1 : -1;
    return pinnedFirst(
      [...list].sort(
        (a, b) =>
          dir * (a.text ?? '').localeCompare(b.text ?? '', undefined, { sensitivity: 'base', numeric: true }),
      ),
    );
  }

  const doneRaw = computed(() => items.value.filter((b) => b.checked));
  const doneItems = computed(() => ordered(doneRaw.value));
  const visibleItems = computed(() =>
    ordered(filter.value === 'open' ? openItems.value : filter.value === 'done' ? doneRaw.value : items.value),
  );
  /** parked items surface under "All" so nothing becomes unreachable */
  const parkedItems = computed(() => items.value.filter((b) => !b.checked && isParked(b)));

  const total = computed(() => items.value.length);
  const doneCount = computed(() => doneItems.value.length);

  // selection (a route param in the real app; local ref in the playground)
  const selectedId = ref<string | null>(null);
  const selected = computed(() => items.value.find((b) => b.id === selectedId.value) ?? null);
  function select(id: string) {
    selectedId.value = id;
  }

  function toggle(b: BlockRow) {
    return blockService.toggleTask(b.id, !b.checked);
  }

  return {
    note, items, filter, sort, cycleSort, visibleItems, openItems, doneItems, parkedItems,
    total, doneCount, selectedId, selected, select, toggle,
  };
}
