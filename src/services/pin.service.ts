// Pinned tasks — design/backlog-after-sync.md §6. Kept out of block.service.ts, which is already 475 lines.
import { db, type BlockRow } from '@/core/db/schema';
import { DbError } from '@/core/errors';
import { blockService } from '@/services/block.service';

export const PIN_CAP = 5;

// a done task keeps its flag but stops floating and stops counting, so unchecking re-pins it
export const isPinned = (b: BlockRow): boolean => b.props?.pinned === 1 && !b.checked;

/** pinned rows first; stable, so both halves keep the order they came in */
export function pinnedFirst(list: BlockRow[]): BlockRow[] {
  return [...list.filter(isPinned), ...list.filter((b) => !isPinned(b))];
}

export const pinService = {
  /** open top-level pinned tasks in one list (a list is a note) */
  async countPinned(noteId: string): Promise<number> {
    return db.blocks
      .where('noteId')
      .equals(noteId)
      .filter((b) => b.parentBlock == null && !b.deletedAt && isPinned(b))
      .count();
  },

  /** @return false when pinning would go past the cap */
  async setPinned(id: string, pinned: boolean): Promise<boolean> {
    const existing = await db.blocks.get(id);
    if (!existing) throw new DbError(`block ${id} not found`, 'block/not-found');
    if (pinned && !isPinned(existing) && (await this.countPinned(existing.noteId)) >= PIN_CAP) return false;
    const props = { ...(existing.props ?? {}) };
    if (pinned) props.pinned = 1;
    else delete props.pinned;
    await blockService.updateBlock(id, { props });
    return true;
  },
};
