/**
 * block.service — the ONLY way features mutate blocks (ARCHITECTURE.md §4.1 dependency rule).
 * Every write follows the same 4 moves (the write path, §4.2):
 *   (1) write local Dexie   (2) bump version   (3) queue the operation   (4) emit the event
 * Components never call this directly against the DB — they go Component → Composable → this.
 */
import { db, newId, type BlockRow } from '@/core/db/schema';
import { toPlain } from '@/core/db/plain';
import { eventBus } from '@/core/events/eventBus';
import { historyService } from '@/services/history.service';
import { DbError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { markLocalWrite } from '@/core/sync/dirty';
import { defForType } from '@/core/editor/blockTypes';
import { CLIP_FORMAT, CLIP_VERSION, type ClipBlock, type ClipEnvelope } from '@/core/editor/clipboard';
import { recordChange } from '@/core/editor/pageHistory';

const log = logger.scoped('block.service');

/**
 * How deep nesting may go (0 = top level), so: task → subtask → sub-subtask and no further.
 * Past three levels a list stops being readable and the indent just hides work.
 */
export const MAX_DEPTH = 2;

/** Below this, two neighbours are too close to split again — renumber instead. */
const MIN_GAP = 1e-6;

/** Live siblings of a block, in order. */
async function siblingsOf(noteId: string, parentBlock: string | null): Promise<BlockRow[]> {
  return db.blocks
    .where('noteId')
    .equals(noteId)
    .filter((b) => b.parentBlock === parentBlock && !b.deletedAt)
    .sortBy('position');
}

/**
 * Rewrite a sibling list to 0,1,2… — the escape hatch for fractional positions that have collided
 * (older rows appended by *count*, so a soft-delete could hand a new block a position another row
 * already held) or drifted too close to split. Both cases put a "new block below" in the wrong
 * place. Rare, so paying for one op per row here is cheaper than renumbering on every insert.
 */
async function renumberSiblings(noteId: string, parentBlock: string | null): Promise<BlockRow[]> {
  const sibs = await siblingsOf(noteId, parentBlock);
  await db.transaction('rw', db.blocks, async () => {
    for (let i = 0; i < sibs.length; i++) {
      if (sibs[i].position === i) continue;
      const version = sibs[i].version + 1;
      await db.blocks.update(sibs[i].id, { position: i, updatedAt: Date.now(), ...markLocalWrite(version) });
      sibs[i] = { ...sibs[i], position: i, version };
    }
  });
  log.debug('renumberSiblings', { noteId, parentBlock, count: sibs.length });
  return sibs;
}

/** Distance from the top level, walking up parents. */
async function depthOf(block: BlockRow): Promise<number> {
  let depth = 0;
  let cur: BlockRow | undefined = block;
  while (cur?.parentBlock) {
    cur = await db.blocks.get(cur.parentBlock);
    depth++;
    if (depth > 10) break; // cycle guard
  }
  return depth;
}

/** How many levels of descendants a block carries (0 = none). */
async function heightOf(id: string, guard = 0): Promise<number> {
  if (guard > 10) return 0;
  const kids = await db.blocks.where('parentBlock').equals(id).filter((b) => !b.deletedAt).toArray();
  if (!kids.length) return 0;
  const heights = await Promise.all(kids.map((k) => heightOf(k.id, guard + 1)));
  return 1 + Math.max(...heights);
}

/** Is `maybeAncestorId` somewhere above `block`? (a block can't be moved inside its own subtree) */
async function isAncestor(maybeAncestorId: string, block: BlockRow): Promise<boolean> {
  let cur: BlockRow | undefined = block;
  for (let i = 0; cur?.parentBlock && i < 10; i++) {
    if (cur.parentBlock === maybeAncestorId) return true;
    cur = await db.blocks.get(cur.parentBlock);
  }
  return false;
}

/**
 * The one nesting rule, shared by Tab and drag-to-nest:
 *  - tasks only (nothing else renders children, so a nested paragraph would just disappear)
 *  - not into your own subtree
 *  - the moved block's OWN depth counts: nesting a task that already has subtasks must not push
 *    those past MAX_DEPTH
 */
async function canNest(self: BlockRow, parent: BlockRow): Promise<boolean> {
  if (self.id === parent.id) return false;
  if (self.type !== 'task' || parent.type !== 'task') return false;
  if (await isAncestor(self.id, parent)) return false;
  return (await depthOf(parent)) + 1 + (await heightOf(self.id)) <= MAX_DEPTH;
}

type BlockPatch = Partial<Pick<BlockRow, 'text' | 'checked' | 'props' | 'position'>>;
type NewBlock = {
  text?: string;
  props?: Record<string, unknown>;
  parentBlock?: string | null;
  position?: number;
  /** carried by copies (fork/duplicate) — a half-copied task that forgets it was done is a lie */
  checked?: 0 | 1;
};

export const blockService = {
  /**
   * Create a new top-level (or child) block. Same write path as updates. When `opts.position` is
   * given (e.g. Enter inserting right after the current block), it's used verbatim — a fractional
   * index that slots the block between two siblings without renumbering. Otherwise the block is
   * appended to the end (append = count of current siblings).
   */
  async createBlock(noteId: string, type: string, opts: NewBlock = {}): Promise<string> {
    const id = newId();
    const parentBlock = opts.parentBlock ?? null;
    // append = LAST position + 1, not the sibling count: with soft-deleted rows in the table the
    // count can land on a position that's already taken, and two blocks sharing a position have no
    // defined order — the new one appears anywhere but where the user pressed Enter.
    let position = opts.position;
    if (position === undefined) {
      const sibs = await siblingsOf(noteId, parentBlock);
      position = sibs.length ? sibs[sibs.length - 1].position + 1 : 0;
    }

    const row: BlockRow = {
      id, noteId, parentBlock, position, type,
      text: opts.text ?? '', checked: opts.checked ?? 0, props: toPlain(opts.props ?? {}),
      deletedAt: null, updatedAt: Date.now(), version: 1,
      syncedVersion: 0, dirty: 1,  // brand-new row: the server has never seen it
    };

    await db.blocks.add(row);
    recordChange(noteId, id, null, row);

    eventBus.emit('block.created', { id, noteId });
    log.debug('createBlock', { id, type });
    return id;
  },

  /**
   * Insert a NEW block on the line directly below `id`, as a sibling under the same parent — what
   * Enter does in every text block. The position is the midpoint to the next sibling, so the block
   * lands between two existing ones without renumbering anything; if that gap has collapsed (or the
   * neighbours collide) we normalize the list once and split cleanly.
   */
  async insertAfter(id: string, type: string, opts: Omit<NewBlock, 'position' | 'parentBlock'> = {}): Promise<string | null> {
    const self = await db.blocks.get(id);
    if (!self) return null;

    let sibs = await siblingsOf(self.noteId, self.parentBlock);
    let idx = sibs.findIndex((b) => b.id === id);
    if (sibs[idx + 1] && sibs[idx + 1].position - sibs[idx].position < MIN_GAP) {
      sibs = await renumberSiblings(self.noteId, self.parentBlock);
      idx = sibs.findIndex((b) => b.id === id);
    }

    const cur = sibs[idx] ?? self;
    const next = sibs[idx + 1];
    const position = next ? (cur.position + next.position) / 2 : cur.position + 1;

    return this.createBlock(self.noteId, type, { ...opts, parentBlock: self.parentBlock, position });
  },

  /**
   * Copy a block to a NEW row on the line directly below it, with any fields overridden.
   *
   * The copy is a genuinely new entity (fresh id, `version: 1`, queued as `CreateBlock`), which is
   * what makes it safe for "Keep both" (design/conflict-keep-both.md): the server has never seen
   * this id, so the copy cannot itself conflict.
   *
   * Children are NOT copied. A conflict is about one block's fields; duplicating a subtree would
   * silently double a list of real work.
   */
  async forkBlock(id: string, overrides: Pick<NewBlock, 'text' | 'props' | 'checked'> = {}): Promise<string | null> {
    const src = await db.blocks.get(id);
    if (!src) throw new DbError(`block ${id} not found`, 'block/not-found');

    return this.insertAfter(id, src.type, {
      text: overrides.text ?? src.text ?? '',
      props: overrides.props ?? src.props ?? {},
      checked: overrides.checked ?? src.checked ?? 0,
    });
  },

  async updateBlock(id: string, rawPatch: BlockPatch): Promise<void> {
    const existing = await db.blocks.get(id);
    if (!existing) throw new DbError(`block ${id} not found`, 'block/not-found');

    // components hand us slices of their own (deeply reactive) props — strip the proxies or
    // IndexedDB's structured clone throws DataCloneError
    const patch = toPlain(rawPatch);
    const version = existing.version + 1;
    const changes = { ...patch, updatedAt: Date.now(), ...markLocalWrite(version) };

    await db.transaction('rw', db.blocks, db.block_versions, async () => {
      // (0) keep what we're about to replace. In the SAME transaction as the write, so we can never
      // end up with a change that landed and a history row that didn't — or the reverse, which would
      // claim a version that never existed. Rate-limited inside; most keystrokes write nothing here.
      await historyService.capture(existing, 'edit');
      await db.blocks.update(id, changes); // (1)(2) local write + version bump
    });
    // typing has its own per-field undo; page history takes everything else
    if (Object.keys(patch).some((k) => k !== 'text')) recordChange(existing.noteId, id, existing, { ...existing, ...patch });

    eventBus.emit('block.updated', { id, patch }); // (4)
    log.debug('updateBlock', { id, patch });
  },

  /**
   * Put a past version's content back (design/data-safety-and-identity.md §3).
   *
   * A restore is an ordinary forward write, never a rewrite of the past: the old content is applied
   * as a NEW version, and the content being replaced is itself snapshotted first — so restoring is
   * undoable too, and history stays append-only. If the block was deleted, restoring its content
   * brings the row back; asking for text from a block that no longer exists can only mean that.
   */
  async restoreVersion(versionId: string): Promise<void> {
    const snapshot = await historyService.get(versionId);
    if (!snapshot) throw new DbError(`version ${versionId} not found`, 'history/not-found');
    const existing = await db.blocks.get(snapshot.blockId);
    if (!existing) throw new DbError(`block ${snapshot.blockId} not found`, 'block/not-found');

    const version = existing.version + 1;
    const now = Date.now();
    const content = { text: snapshot.text, props: toPlain(snapshot.props ?? {}), checked: snapshot.checked };

    await db.transaction('rw', db.blocks, db.block_versions, async () => {
      await historyService.capture(existing, 'restore'); // what you're replacing, kept unconditionally
      await db.blocks.update(snapshot.blockId, { ...content, deletedAt: null, ...(existing.deletedAt ? { restoring: 1 as const } : {}), updatedAt: now, ...markLocalWrite(version) });
    });
    recordChange(existing.noteId, existing.id, existing, { ...existing, ...content, deletedAt: null });

    eventBus.emit('block.updated', { id: snapshot.blockId, patch: content });
    log.info('restoreVersion', { blockId: snapshot.blockId, from: snapshot.version, to: version });
  },

  /** convenience for the checkbox — checked is stored as 0/1 */
  toggleTask(id: string, checked: boolean): Promise<void> {
    return this.updateBlock(id, { checked: checked ? 1 : 0 });
  },

  /**
   * Snooze an item until `until` (epoch ms), or clear it with null. Stored on the block and queued
   * like any write, so once sync exists the server has what it needs to schedule the reminder.
   * NOTE: this records the intention — delivering a notification needs the backend
   * (design/note-properties.md §7).
   */
  async snoozeBlock(id: string, until: number | null): Promise<void> {
    const existing = await db.blocks.get(id);
    if (!existing) throw new DbError(`block ${id} not found`, 'block/not-found');
    const props = { ...(existing.props ?? {}) };
    if (until) props.snoozedUntil = until;
    else delete props.snoozedUntil;
    return this.updateBlock(id, { props });
  },

  /** Move an item out of the open list without deleting it (the "Move to → Archive" action). */
  async archiveBlock(id: string, archived = true): Promise<void> {
    const existing = await db.blocks.get(id);
    if (!existing) throw new DbError(`block ${id} not found`, 'block/not-found');
    const props = { ...(existing.props ?? {}) };
    if (archived) props.archived = 1;
    else delete props.archived;
    return this.updateBlock(id, { props });
  },

  /** Read a block subtree into a clipboard envelope (ids dropped — a paste is a copy). */
  async copyBlocks(ids: string[]): Promise<ClipEnvelope> {
    const asClip = async (id: string): Promise<ClipBlock | null> => {
      const b = await db.blocks.get(id);
      if (!b || b.deletedAt) return null;
      const kids = await siblingsOf(b.noteId, b.id);
      const children = (await Promise.all(kids.map((k) => asClip(k.id)))).filter(Boolean) as ClipBlock[];
      return { type: b.type, text: b.text ?? '', checked: b.checked ?? 0, props: toPlain(b.props ?? {}), children };
    };
    const blocks = (await Promise.all(ids.map(asClip))).filter(Boolean) as ClipBlock[];
    return { format: CLIP_FORMAT, version: CLIP_VERSION, blocks };
  },

  /**
   * Write a clipboard envelope into a note as NEW blocks (fresh ids, so pasting twice gives two
   * copies). Inserted after `after` when given, else appended. One transaction for the whole tree.
   */
  async pasteBlocks(
    noteId: string,
    envelope: ClipEnvelope,
    opts: { after?: string; parentBlock?: string | null } = {},
  ): Promise<string[]> {
    const parentBlock = opts.parentBlock ?? null;
    let siblings = await siblingsOf(noteId, parentBlock);

    // starting position: right after `after`, else at the end
    let pos: number;
    let gap = 1;
    const idx = opts.after ? siblings.findIndex((b) => b.id === opts.after) : -1;
    if (idx >= 0) {
      // the gap has to be splittable — if these two neighbours collide (or sit too close), the
      // pasted blocks would all land on the same position and show up in an arbitrary order
      if (siblings[idx + 1] && siblings[idx + 1].position - siblings[idx].position < MIN_GAP) {
        siblings = await renumberSiblings(noteId, parentBlock);
      }
      const at = siblings.findIndex((b) => b.id === opts.after);
      const cur = siblings[at];
      const next = siblings[at + 1];
      gap = next ? (next.position - cur.position) / (envelope.blocks.length + 1) : 1;
      pos = cur.position + gap;
    } else {
      // append (or `after` wasn't a sibling here — e.g. pasting from another page)
      pos = siblings.length ? siblings[siblings.length - 1].position + 1 : 0;
    }

    const rows: BlockRow[] = [];
    const topIds: string[] = [];

    const walk = (clip: ClipBlock, parent: string | null, position: number) => {
      const id = newId();
      rows.push({
        id, noteId, parentBlock: parent, position, type: clip.type,
        text: clip.text ?? '', checked: clip.checked ?? 0, props: toPlain(clip.props ?? {}),
        deletedAt: null, updatedAt: Date.now(), version: 1,
        syncedVersion: 0, dirty: 1,  // brand-new row: the server has never seen it
      });
      clip.children?.forEach((c, i) => walk(c, id, i));
      return id;
    };

    envelope.blocks.forEach((clip, i) => topIds.push(walk(clip, parentBlock, pos + i * gap)));

    await db.blocks.bulkAdd(rows);
    rows.forEach((r) => recordChange(noteId, r.id, null, r));

    rows.forEach((r) => eventBus.emit('block.created', { id: r.id, noteId }));
    log.debug('pasteBlocks', { noteId, count: rows.length });
    return topIds;
  },

  /**
   * Soft-delete a block (clear-to-delete + the 🗑 control). We never hard-delete: set `deletedAt`
   * so it drops out of every `!deletedAt` liveQuery instantly, bump the version, and queue a
   * DeleteBlock op so the server (Phase B) and Trash can honour it. Children are left as-is —
   * they fall out of view with the parent and get reaped later.
   */
  async deleteBlock(id: string): Promise<void> {
    const existing = await db.blocks.get(id);
    if (!existing) throw new DbError(`block ${id} not found`, 'block/not-found');
    if (existing.deletedAt) return; // already gone — no-op

    const version = existing.version + 1;
    const deletedAt = Date.now();

    await db.transaction('rw', db.blocks, db.block_versions, async () => {
      // a delete always snapshots, bucket or no bucket — Trash restores the row, but the content
      // at the moment of deletion is what someone actually asks for afterwards
      await historyService.capture(existing, 'delete');
      await db.blocks.update(id, { deletedAt, updatedAt: deletedAt, ...markLocalWrite(version) });
    });
    recordChange(existing.noteId, id, existing, { ...existing, deletedAt });

    eventBus.emit('block.deleted', { id, noteId: existing.noteId });
    log.debug('deleteBlock', { id });
  },

  /** Undo a delete: an ordinary forward write that clears `deletedAt`, which sync sends as an update. */
  async restoreBlock(id: string): Promise<void> {
    const existing = await db.blocks.get(id);
    if (!existing?.deletedAt) return;
    const version = existing.version + 1;
    const now = Date.now();
    await db.blocks.update(id, { deletedAt: null, restoring: 1, updatedAt: now, ...markLocalWrite(version) });
    recordChange(existing.noteId, id, existing, { ...existing, deletedAt: null });
    eventBus.emit('block.updated', { id, patch: { deletedAt: null } });
    log.debug('restoreBlock', { id });
  },

  /**
   * Tab — make this block a child of the block above it (its previous sibling). Returns false when
   * it can't indent (first at its level, or already at MAX_DEPTH), so the caller can leave the
   * caret alone. The block's OWN children come along for free: they point at it by id, so nothing
   * else is rewritten — one row changes, which is the whole point of `parentBlock` + fractional
   * `position`.
   */
  async indentBlock(id: string): Promise<boolean> {
    const self = await db.blocks.get(id);
    if (!self) return false;

    const siblings = await siblingsOf(self.noteId, self.parentBlock);
    const idx = siblings.findIndex((b) => b.id === id);
    const newParent = siblings[idx - 1];
    if (!newParent) return false; // nothing above to nest under

    return this.nestBlock(id, newParent.id);
  },

  /**
   * Make `id` a child of `parentId`, appended after any existing children — the write behind BOTH
   * Tab and drag-to-nest (drop a block on the lower-RIGHT of a task). Touch devices have no Tab key,
   * so the drag is the only way to build a subtask on a phone; they must therefore agree exactly,
   * which is why the rule lives in `canNest` and not in either caller.
   *
   * Returns false when the move isn't allowed, so the caller can leave the caret/row alone.
   */
  async nestBlock(id: string, parentId: string): Promise<boolean> {
    const self = await db.blocks.get(id);
    const parent = await db.blocks.get(parentId);
    if (!self || !parent || parent.deletedAt) return false;
    if (self.parentBlock === parentId) return false; // already there
    if (!(await canNest(self, parent))) return false;

    const kids = await siblingsOf(self.noteId, parentId);
    const position = kids.length ? kids[kids.length - 1].position + 1 : 0;

    const version = self.version + 1;
    await db.blocks.update(id, { parentBlock: parentId, position, updatedAt: Date.now(), ...markLocalWrite(version) });
    recordChange(self.noteId, id, self, { ...self, parentBlock: parentId, position });

    eventBus.emit('block.updated', { id, patch: { parentBlock: parentId } });
    log.debug('nestBlock', { id, under: parentId });
    return true;
  },

  /** Can this block become a child of that one? Lets the UI show a nest indicator only when the
   *  drop would actually land. */
  async canNestUnder(id: string, parentId: string): Promise<boolean> {
    const self = await db.blocks.get(id);
    const parent = await db.blocks.get(parentId);
    return !!self && !!parent && !parent.deletedAt && (await canNest(self, parent));
  },

  /** Shift+Tab — lift this block out to sit just after its former parent. */
  async outdentBlock(id: string): Promise<boolean> {
    const self = await db.blocks.get(id);
    if (!self?.parentBlock) return false; // already top level

    const parent = await db.blocks.get(self.parentBlock);
    if (!parent) return false;

    // slot it immediately after the parent among the parent's siblings
    const uncles = await siblingsOf(self.noteId, parent.parentBlock);
    const pIdx = uncles.findIndex((b) => b.id === parent.id);
    const next = uncles[pIdx + 1];
    const position = next ? (parent.position + next.position) / 2 : parent.position + 1;

    const version = self.version + 1;
    await db.blocks.update(id, { parentBlock: parent.parentBlock, position, updatedAt: Date.now(), ...markLocalWrite(version) });
    recordChange(self.noteId, id, self, { ...self, parentBlock: parent.parentBlock, position });

    eventBus.emit('block.updated', { id, patch: { parentBlock: parent.parentBlock } });
    log.debug('outdentBlock', { id });
    return true;
  },

  /**
   * Turn a block into another type (the inline `/` menu). Clears text, resets props to the type's
   * defaults.
   *
   * Returns **false** when the conversion is refused, so the caller can explain why rather than
   * appearing to do nothing. There is one such rule, and it protects data:
   *
   *   **A task that still owns children cannot become anything else.** Only `task` renders
   *   children, so converting one that has them leaves those rows in the database with nothing
   *   drawing them. Not deleted — invisible, which is worse, because a soft delete at least puts
   *   them in Trash where they can be found.
   *
   * The rule lives here rather than in the composable that calls it because it is an invariant of
   * the data, not a preference of one screen: `/` in the body, `/` on a subtask and any future
   * caller all have to obey it, and only one of them existed when this was written.
   */
  async convertBlock(id: string, type: string, seed: { text?: string; props?: Record<string, unknown> } = {}): Promise<boolean> {
    const existing = await db.blocks.get(id);
    if (!existing) throw new DbError(`block ${id} not found`, 'block/not-found');

    if (existing.type === 'task' && type !== 'task') {
      const kids = await db.blocks.where('parentBlock').equals(id).filter((b) => !b.deletedAt).count();
      if (kids) {
        log.debug('convertBlock refused — would orphan children', { id, type, kids });
        return false;
      }
    }

    const props = toPlain({ ...(defForType(type)?.defaults() ?? {}), ...(seed.props ?? {}) });
    const version = existing.version + 1;

    await db.blocks.update(id, { type, text: seed.text ?? '', props, updatedAt: Date.now(), ...markLocalWrite(version) });
    recordChange(existing.noteId, id, existing, { ...existing, type, text: seed.text ?? '', props });

    eventBus.emit('block.updated', { id, patch: { type } });
    log.debug('convertBlock', { id, type });
    return true;
  },
};
