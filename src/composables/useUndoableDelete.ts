// Delete blocks at once and offer Undo for a few seconds, instead of asking first.
import { db } from '@/core/db/schema';
import { blockService } from '@/services/block.service';
import { nextUndoIds, undo } from '@/core/editor/pageHistory';
import { useNoticeStore } from '@/stores/notice.store';
import { logger } from '@/core/logging/logger';

const log = logger.scoped('undo-delete');
const UNDO_MS = 6000;

// module-level so one Undo covers deletes made from any page in the window
let pending: { ids: string[]; noteId: string | null; noticeId: string } | null = null;

function livePending() {
  const notices = useNoticeStore();
  return pending && notices.notices.some((n) => n.id === pending!.noticeId) ? pending : null;
}

export async function deleteWithUndo(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const notices = useNoticeStore();
  const noteId = (await db.blocks.get(ids[0]!))?.noteId ?? null;
  for (const id of ids) await blockService.deleteBlock(id);

  // deletes in quick succession share one bar, and one Undo brings them all back
  const prev = livePending();
  const all = prev ? [...prev.ids, ...ids] : ids;
  if (prev) notices.dismiss(prev.noticeId);
  const message = all.length === 1 ? 'Block deleted' : `${all.length} blocks deleted`;
  const noticeId = notices.notify(message, 'info', UNDO_MS, { label: 'Undo', run: () => void undoLastDelete() });
  pending = { ids: all, noteId: prev && prev.noteId !== noteId ? null : noteId, noticeId };
}

export async function undoLastDelete(): Promise<boolean> {
  const p = livePending();
  pending = null;
  if (!p) return false;
  useNoticeStore().dismiss(p.noticeId);
  try {
    // when page history's next step is exactly this delete, take it from there so Redo can follow
    const top = p.noteId ? nextUndoIds(p.noteId) : [];
    if (p.noteId && top.length === p.ids.length && p.ids.every((id) => top.includes(id))) await undo(p.noteId);
    else for (const id of p.ids) await blockService.restoreBlock(id);
  } catch (e) {
    log.warn('undo delete failed', e);
    useNoticeStore().danger('Could not bring that back — it is still in Archive ▸ Trash');
  }
  return true;
}
