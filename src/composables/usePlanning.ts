/**
 * usePlanning — data for the Planning page: the live top-level block list, task progress,
 * and the outline (derived from headings). Reads via liveQuery; the block components own writes.
 */
import { computed } from 'vue';
import { db, type BlockRow, type NoteRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { plainText } from '@/core/editor/marks';

export function usePlanning(noteId: string) {
  const note = useLiveQuery<NoteRow | undefined>(() => db.notes.get(noteId), undefined);

  const blocks = useLiveQuery<BlockRow[]>(
    // `== null`, not `=== null`: a block pulled from a payload with no parent_block key has
    // `undefined` here, and a strict test drops it from the page while the counters still see it
    () => db.blocks.where('noteId').equals(noteId).filter((b) => b.parentBlock == null && !b.deletedAt).sortBy('position'),
    [],
  );

  // all task blocks (incl. subtasks) drive the progress counter
  const tasks = useLiveQuery<BlockRow[]>(
    () => db.blocks.where('noteId').equals(noteId).filter((b) => b.type === 'task' && !b.deletedAt).toArray(),
    [],
  );

  const progress = computed(() => ({
    done: tasks.value.filter((t) => t.checked).length,
    total: tasks.value.length,
  }));

  /**
   * The outline is the page's TASK LIST, not its headings.
   *
   * Headings made a table-of-contents that drifted from what the page is actually about — and a
   * plan is a set of commitments, not a set of section titles. Listing tasks means the outline is
   * the work: click a point, read/write its details on the right (design/dashboard-ux.md and the
   * planning rework). Sections still group them, so we carry the nearest heading as context.
   */
  const outline = computed(() => {
    let section = '';
    const rows: { id: string; text: string; checked: boolean; section: string; depth: number }[] = [];

    // walk the whole subtree so sub-subtasks show up too, in page order
    const walk = (parent: BlockRow, depth: number) => {
      const kids = tasks.value
        .filter((t) => t.parentBlock === parent.id)
        .sort((a, b) => a.position - b.position);
      for (const c of kids) {
        rows.push({ id: c.id, text: plainText(c.text ?? ''), checked: !!c.checked, section, depth });
        walk(c, depth + 1);
      }
    };

    for (const b of blocks.value) {
      if (b.type === 'heading') {
        if (((b.props?.level as number | undefined) ?? 2) >= 2) section = b.text ?? '';
        continue;
      }
      if (b.type !== 'task') continue;
      rows.push({ id: b.id, text: plainText(b.text ?? ''), checked: !!b.checked, section, depth: 0 });
      walk(b, 1);
    }
    return rows;
  });

  return { note, blocks, tasks, progress, outline };
}
