/**
 * useChangedToday — the pages you touched today, newest first.
 *
 * This is what **Today** now is. It used to be "unchecked tasks due today or overdue", which is a
 * different question — that one is about what you *owe*, this one is about where you have *been*.
 * The design note is in design/dashboard-ux.md §5; the replacement is deliberate and the due-date
 * triage went with it.
 *
 * ── Two clocks, not one ─────────────────────────────────────────────────────────────────────────
 * A page is "changed" if the NOTE row changed — a rename, a property, an archive — **or if any
 * block inside it changed.** Only checking `notes.updatedAt` looks right and is wrong in the most
 * common case there is: typing a sentence into a page updates that BLOCK's row and never touches
 * the note's, so the page you spent all morning writing would not appear in a list of what you
 * changed today.
 *
 * Both queries are index range scans — `updatedAt` is indexed on both tables (schema.ts v1/v5) — so
 * this reads today's rows rather than the library.
 *
 * ── Read-only, on purpose ───────────────────────────────────────────────────────────────────────
 * Today lists PAGES, and a page is not a thing you can tick. It is an index: every row is a link
 * that opens the real page inside its project. The old Today could be edited in place because its
 * rows were the actual task blocks; nothing here is a block, so there is nothing to edit.
 */
import { computed } from 'vue';
import { db, type NoteRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import type { PageType } from '@/types/models';

/** Local midnight this morning. Everything at or after it counts as today. */
export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface ChangedPage {
  id: string;
  title: string;
  type: PageType;
  workspaceId: string;
  /** the project it lives in, so a row says where it will take you before you click it */
  space: string;
  /** the later of the note's own change and its most recent block's */
  changedAt: number;
}

/**
 * The shape both the page and the sidebar badge read.
 *
 * A plain function over rows rather than a computed reading refs, so the rule — which pages count
 * and in what order — is testable without a database or a mounted component.
 */
export function changedPages(
  notes: NoteRow[],
  blockTouches: { noteId: string; updatedAt: number }[],
  spaceNames: Map<string, string>,
  since: number,
): ChangedPage[] {
  const latestBlock = new Map<string, number>();
  for (const b of blockTouches) {
    const prev = latestBlock.get(b.noteId) ?? 0;
    if (b.updatedAt > prev) latestBlock.set(b.noteId, b.updatedAt);
  }

  return notes
    .filter((n) => !n.deletedAt && !n.archived)
    .map((n) => ({ n, changedAt: Math.max(n.updatedAt, latestBlock.get(n.id) ?? 0) }))
    .filter(({ changedAt }) => changedAt >= since)
    .sort((a, b) => b.changedAt - a.changedAt)
    .map(({ n, changedAt }) => ({
      id: n.id,
      title: n.title,
      type: n.type,
      workspaceId: n.workspaceId,
      space: spaceNames.get(n.workspaceId) ?? '',
      changedAt,
    }));
}

export function useChangedToday() {
  const notes = useLiveQuery<NoteRow[]>(() => db.notes.toArray(), []);
  const workspaces = useLiveQuery(() => db.workspaces.toArray(), []);

  /**
   * Only today's blocks, by index range — the whole point of reading `updatedAt` rather than
   * scanning every block in the library on every keystroke.
   *
   * `startOfToday()` is called inside the query so a session left open past midnight re-reads
   * against the new day the next time anything invalidates it.
   */
  const blockTouches = useLiveQuery<{ noteId: string; updatedAt: number }[]>(
    () =>
      db.blocks
        .where('updatedAt')
        .aboveOrEqual(startOfToday())
        .filter((b) => !b.deletedAt)
        .toArray()
        .then((rows) => rows.map((b) => ({ noteId: b.noteId, updatedAt: b.updatedAt }))),
    [],
  );

  const spaceNames = computed(() => new Map(workspaces.value.map((w) => [w.id, w.name])));

  const pages = computed(() =>
    changedPages(notes.value, blockTouches.value, spaceNames.value, startOfToday()),
  );

  return { pages };
}
