// Picking blocks: modifier clicks, long-press on touch, Esc to select, and the keys that act on a selection.
import { computed, watch, onMounted, onUnmounted, type ComputedRef } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { deleteWithUndo } from '@/composables/useUndoableDelete';
import type { BlockRow } from '@/core/db/schema';

export function useBlockSelect(
  props: { readonly blocks: BlockRow[] },
  order: ComputedRef<string[]>,
  selectedInOrder: ComputedRef<string[]>,
  copySelection: () => void,
) {
  const ui = useUiStore();
  const hasSelection = computed(() => ui.selectedBlockIds.length > 0);

  /** ⌘/Ctrl+click toggles, Shift+click extends a range; a plain click leaves selection alone. */
  function onRowClick(b: BlockRow, e: MouseEvent) {
    if (e.shiftKey && ui.lastSelectedId) {
      e.preventDefault();
      ui.selectRange(b.id, order.value);
    } else if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      ui.toggleSelected(b.id);
    } else if (ui.selectMode) {
      e.preventDefault();
      ui.toggleSelected(b.id); // mobile: after a long-press, plain taps select
    }
  }

  /** Mobile: press-and-hold a block (~600ms) turns on select mode and picks it. */
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  function onTouchStart(b: BlockRow) {
    clearHold();
    holdTimer = setTimeout(() => {
      ui.setSelectMode(true);
      ui.toggleSelected(b.id);
    }, 600);
  }
  function clearHold() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
  }

  async function deleteSelection() {
    const ids = [...selectedInOrder.value];
    ui.clearSelection();
    await deleteWithUndo(ids);
  }

  // a plain click anywhere unmarks; modifier clicks, the toolbar and the handle keep the selection
  function onDocPointerDown(e: MouseEvent | TouchEvent) {
    if (!hasSelection.value) return;
    const me = e as MouseEvent;
    if (me.metaKey || me.ctrlKey || me.shiftKey) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('.seltoolbar')) return;
    if (t?.closest('.handle')) return; // grabbing the handle drags the marked group — keep it marked
    // mobile select-mode: taps inside the document keep toggling; a tap outside it ends the mode
    if (ui.selectMode && t?.closest('.blk')) return;
    ui.clearSelection();
    ui.setSelectMode(false);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && hasSelection.value) ui.clearSelection();
    // Delete/Backspace on marked blocks removes them at once; Undo is on the bar that follows
    if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelection.value) {
      const t = e.target as HTMLElement | null;
      if (!t?.isContentEditable && t?.tagName !== 'INPUT' && t?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        void deleteSelection();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && hasSelection.value) {
      const t = e.target as HTMLElement | null;
      if (!t?.isContentEditable || !window.getSelection()?.toString()) {
        e.preventDefault();
        copySelection();
      }
    }
  }
  watch(
    hasSelection,
    (on) => {
      if (on) {
        window.addEventListener('keydown', onKey);
        // capture phase: unmark before the click reaches whatever it landed on
        document.addEventListener('mousedown', onDocPointerDown, true);
        document.addEventListener('touchstart', onDocPointerDown, true);
      } else {
        window.removeEventListener('keydown', onKey);
        document.removeEventListener('mousedown', onDocPointerDown, true);
        document.removeEventListener('touchstart', onDocPointerDown, true);
      }
    },
    { immediate: true },
  );

  // select exactly one block, out of its text, so the Delete key removes the block itself
  function selectOnly(id: string) {
    (document.activeElement as HTMLElement | null)?.blur();
    ui.clearSelection();
    ui.toggleSelected(id);
  }
  // Esc while typing in a block steps out of the text and selects that block
  function onEscapeToSelect(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented || hasSelection.value) return;
    const t = e.target as HTMLElement | null;
    const id = t?.isContentEditable ? (t.closest('.blk') as HTMLElement | null)?.dataset.blockId : undefined;
    if (!id || !props.blocks.some((b) => b.id === id)) return;
    e.preventDefault();
    selectOnly(id);
  }
  onMounted(() => window.addEventListener('keydown', onEscapeToSelect));
  onUnmounted(() => window.removeEventListener('keydown', onEscapeToSelect));

  return { hasSelection, onRowClick, onTouchStart, clearHold, deleteSelection, selectOnly };
}
