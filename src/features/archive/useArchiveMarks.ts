// Marking several Archive items, with the same keys, clicks and toolbar as a Single or Planning page.
import { ref, computed, type ComputedRef, type Ref } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { blockService } from '@/services/block.service';
import { toPlainText, toHtml } from '@/core/editor/clipboard';
import { useBlockSelect } from '@/features/editor/document/useBlockSelect';
import { useDocSelection } from '@/features/editor/document/useDocSelection';
import type { BlockRow } from '@/core/db/schema';

/**
 * @param root the list's scroller; rows inside it carry `.blk` and `data-block-id`
 * @param shown the rows on screen, in screen order
 */
export function useArchiveMarks(noteId: string, root: Ref<HTMLElement | null>, shown: ComputedRef<BlockRow[]>) {
  const ui = useUiStore();
  const doc = { get blocks() { return shown.value; } };
  const order = computed(() => shown.value.map((b) => b.id));
  const selectedInOrder = computed(() => order.value.filter((id) => ui.selectedBlockIds.includes(id)));
  const copied = ref(false);

  async function copySelection() {
    const ids = selectedInOrder.value;
    if (!ids.length) return;
    const envelope = await blockService.copyBlocks(ids);
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([toPlainText(envelope.blocks)], { type: 'text/plain' }),
          'text/html': new Blob([toHtml(envelope)], { type: 'text/html' }),
        })]);
      } else {
        await navigator.clipboard.writeText(toPlainText(envelope.blocks));
      }
      copied.value = true;
      setTimeout(() => (copied.value = false), 1400);
    } catch {
      // clipboard refused (no focus or no permission): nothing was copied, so no tick
    }
  }

  async function duplicateSelection() {
    const ids = selectedInOrder.value;
    if (!ids.length) return;
    const envelope = await blockService.copyBlocks(ids);
    await blockService.pasteBlocks(noteId, envelope, { after: ids[ids.length - 1] });
    ui.clearSelection();
  }

  const { boldOn, strikeOn, canMark, markSelection } = useDocSelection(root, doc, order, selectedInOrder);
  const { hasSelection, onRowClick, onRowContextMenu, onTouchStart, clearHold, deleteSelection } =
    useBlockSelect(doc, order, selectedInOrder, copySelection);

  return {
    hasSelection, copied, boldOn, strikeOn, canMark,
    onRowClick, onRowContextMenu, onTouchStart, clearHold,
    copySelection, duplicateSelection, markSelection, deleteSelection,
  };
}
