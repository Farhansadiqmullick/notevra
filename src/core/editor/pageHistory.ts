/**
 * Page undo/redo for block ACTIONS (add, delete, move, convert, paste, tick, props).
 *
 * Typing is not recorded here — each text field keeps its own undo while it has the caret.
 * Undo and redo are ordinary forward writes (version bump + dirty), so sync sends them like any edit.
 */
import { reactive } from 'vue';
import { db, type BlockRow } from '@/core/db/schema';
import { toPlain } from '@/core/db/plain';
import { markLocalWrite } from '@/core/sync/dirty';
import { eventBus } from '@/core/events/eventBus';

type Snap = Pick<BlockRow, 'parentBlock' | 'position' | 'type' | 'text' | 'checked' | 'props' | 'deletedAt'>;
interface Change { before: Snap | null; after: Snap | null }
export interface HistoryEntry { at: number; changes: Map<string, Change> }
interface Stacks { undo: HistoryEntry[]; redo: HistoryEntry[] }

/** actions closer together than this are one step (Enter, Enter, Enter → one undo) */
const MERGE_MS = 600;
const LIMIT = 100;

const pages = reactive(new Map<string, Stacks>());
let applying = false;
let now = () => Date.now();

const stacksFor = (noteId: string): Stacks => {
  let s = pages.get(noteId);
  if (!s) {
    s = { undo: [], redo: [] };
    pages.set(noteId, s);
  }
  return pages.get(noteId)!; // the reactive proxy, not the raw object
};

const snap = (r: Partial<BlockRow> | null | undefined): Snap | null =>
  r
    ? toPlain({
        parentBlock: r.parentBlock ?? null, position: r.position ?? 0, type: r.type ?? 'paragraph',
        text: r.text ?? '', checked: r.checked ?? 0, props: r.props ?? {}, deletedAt: r.deletedAt ?? null,
      })
    : null;

const same = (a: Snap | null, b: Snap | null) => JSON.stringify(a) === JSON.stringify(b);

/** called by block.service after every structural write */
export function recordChange(noteId: string, id: string, before: Partial<BlockRow> | null | undefined, after: Partial<BlockRow>): void {
  if (applying) return;
  const b = snap(before);
  const a = snap(after);
  if (same(b, a)) return;
  const s = stacksFor(noteId);
  const t = now();
  let top = s.undo[s.undo.length - 1];
  if (!top || t - top.at > MERGE_MS) {
    top = { at: t, changes: new Map() };
    s.undo.push(top);
    if (s.undo.length > LIMIT) s.undo.shift();
  }
  top.at = t;
  const prev = top.changes.get(id);
  top.changes.set(id, { before: prev ? prev.before : b, after: a });
  s.redo.length = 0; // a new action ends the redo line
}

export const canUndo = (noteId: string): boolean => (pages.get(noteId)?.undo.length ?? 0) > 0;
export const canRedo = (noteId: string): boolean => (pages.get(noteId)?.redo.length ?? 0) > 0;

/** the ids touched by the step Undo would reverse next */
export const nextUndoIds = (noteId: string): string[] => [...(pages.get(noteId)?.undo.at(-1)?.changes.keys() ?? [])];

async function write(id: string, target: Snap | null): Promise<Snap | null> {
  const row = await db.blocks.get(id);
  if (!row) return null;
  const current = snap(row);
  // "did not exist" is undone by a soft delete, so the row stays recoverable and redo can bring it back
  // toPlain: entries live in reactive state, and IndexedDB cannot clone a proxy
  const fields: Snap = toPlain(target ?? { ...current!, deletedAt: Date.now() });
  const undeleting = row.deletedAt != null && fields.deletedAt == null;
  await db.blocks.update(id, { ...fields, ...(undeleting ? { restoring: 1 as const } : {}), updatedAt: Date.now(), ...markLocalWrite(row.version + 1) });
  if (fields.deletedAt) eventBus.emit('block.deleted', { id, noteId: row.noteId });
  else eventBus.emit('block.updated', { id, patch: { ...fields } });
  return current;
}

async function move(noteId: string, from: 'undo' | 'redo'): Promise<boolean> {
  const s = stacksFor(noteId);
  const entry = s[from].pop();
  if (!entry) return false;
  applying = true;
  try {
    for (const [id, c] of entry.changes) {
      // whatever is there NOW is what the opposite direction returns to, so text typed since survives
      const current = await write(id, from === 'undo' ? c.before : c.after);
      if (from === 'undo') c.after = current; else c.before = current;
    }
  } finally {
    applying = false;
  }
  entry.at = 0; // never merge into a step that has been moved
  (from === 'undo' ? s.redo : s.undo).push(entry);
  return true;
}

export const undo = (noteId: string) => move(noteId, 'undo');
export const redo = (noteId: string) => move(noteId, 'redo');

/** tests only */
export function _resetHistory(clock?: () => number): void {
  pages.clear();
  now = clock ?? (() => Date.now());
}
