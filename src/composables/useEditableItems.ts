/**
 * useEditableItems — editing seam for the "grouped" list blocks (bulleted / numbered), whose
 * lines live in `props.items: string[]`. Debounced text saves (300ms), Enter inserts a line,
 * Backspace-on-empty removes one; the whole array is written in a single UpdateBlock op (we keep
 * the grouped shape for now — splitting into per-line child blocks is a later, finer-sync call).
 * `focusIndex` drives autofocus so a freshly-inserted line grabs the caret.
 */
import { computed, ref } from 'vue';
import { blockService } from '@/services/block.service';
import { debounce } from '@/utils/debounce';
import { useUiStore } from '@/stores/ui.store';
import type { BlockRow } from '@/core/db/schema';

/** @param opts.exitOnEmpty Enter on an empty last line leaves for a Text line below (lists, not Toggle) */
export function useEditableItems(block: () => BlockRow, opts: { exitOnEmpty?: boolean } = {}) {
  const items = computed<string[]>(() => (block().props?.items as string[] | undefined) ?? []);
  const ui = useUiStore();
  // just converted into a list ("- "): the first line takes the caret
  const fresh = ui.focusBlockId === block().id && Date.now() - ui.focusAt < 4000;
  const focusIndex = ref<number | null>(fresh ? 0 : null);

  function commit(next: string[]) {
    blockService.updateBlock(block().id, { props: { ...block().props, items: next } });
  }
  const save = debounce(commit, 300);

  /**
   * The lines as they stand *including* an edit that's still waiting on the debounce. Building the
   * next array off `items` alone meant adding or removing a line rewrote the block from the last
   * SAVED state, wiping whatever was typed in the previous 300ms.
   */
  const current = () => save.pending()?.[0] ?? items.value;

  function onInput(i: number, text: string) {
    focusIndex.value = null;
    const next = current().slice();
    next[i] = text;
    save(next);
  }
  function addItem(i: number) {
    const next = current().slice();
    if (opts.exitOnEmpty && i >= 0 && i === next.length - 1 && !next[i]!.trim()) return void exitList(next);
    save.cancel(); // we're writing the same state, with the line added
    next.splice(i + 1, 0, '');
    focusIndex.value = i + 1;
    commit(next);
  }
  function removeItem(i: number) {
    const next = current().slice();
    save.cancel();
    next.splice(i, 1);
    focusIndex.value = Math.max(0, i - 1);
    commit(next);
  }

  async function exitList(lines: string[]) {
    save.cancel();
    const id = block().id;
    // the only line, still empty: the list goes back to being a Text line
    if (lines.length === 1) {
      await blockService.convertBlock(id, 'paragraph');
      ui.setFocus(id);
      return;
    }
    commit(lines.slice(0, -1));
    const next = await blockService.insertAfter(id, 'paragraph');
    if (next) ui.setFocus(next);
  }

  return { items, focusIndex, onInput, addItem, removeItem };
}
