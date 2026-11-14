// M5 for Archive pages: a multi-line paste into an empty item or Content line becomes blocks.
import { db, type BlockRow } from '@/core/db/schema';
import { blockService } from '@/services/block.service';
import { useUiStore } from '@/stores/ui.store';
import { envelopeFromHtml, CLIP_FORMAT, CLIP_VERSION, type ClipBlock } from '@/core/editor/clipboard';
import { isMultiLine, isMarkdownLine } from '@/core/editor/pasteMarkdown';

/**
 * @param into the row the caret is in
 * @param toBlocks how the pasted text is split
 * @return true when it took the paste
 */
export function pasteIntoEmpty(e: ClipboardEvent, into: BlockRow, toBlocks: (text: string) => ClipBlock[]): boolean {
  const target = e.target as HTMLElement | null;
  const text = e.clipboardData?.getData('text/plain') ?? '';
  const html = e.clipboardData?.getData('text/html');
  if (!target?.isContentEditable || (into.type !== 'task' && into.type !== 'paragraph')) return false;
  if ((html && envelopeFromHtml(html)) || !(isMultiLine(text) || isMarkdownLine(text))) return false; // Notevra's own copies paste as before
  if ((into.text ?? '').trim() || (target.textContent ?? '').trim()) return false;
  const blocks = toBlocks(text);
  if (!blocks.length) return false;
  e.preventDefault(); // before any await, or the browser has already pasted
  void land(into, blocks);
  return true;
}

async function land(into: BlockRow, blocks: ClipBlock[]) {
  const ids = await blockService.pasteBlocks(
    into.noteId,
    { format: CLIP_FORMAT, version: CLIP_VERSION, blocks },
    { after: into.id, parentBlock: into.parentBlock ?? null },
  );
  // deleted rather than reused, as on a Single page; kept if it already has subtasks under it
  const hasChildren = await db.blocks.where('parentBlock').equals(into.id).filter((b) => !b.deletedAt).count();
  if (!hasChildren) await blockService.deleteBlock(into.id);
  if (ids[0]) useUiStore().setFocus(ids[0]);
}
