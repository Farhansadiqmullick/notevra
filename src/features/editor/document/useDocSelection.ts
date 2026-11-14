// Page-wide block selection: ⌘A, a mouse drag across blocks, and marks on the selected blocks.
import { computed, onMounted, onUnmounted, type ComputedRef, type Ref } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { blockService } from '@/services/block.service';
import { markWhole, wholeHasMark, type Mark } from '@/core/editor/marks';
import type { BlockRow } from '@/core/db/schema';

// blocks whose `text` is the words on screen
const TEXT_TYPES = ['paragraph', 'task', 'heading', 'quote', 'callout', 'textarea', 'toggle'];

export function useDocSelection(
  root: Ref<HTMLElement | null>,
  props: { readonly blocks: BlockRow[] },
  order: ComputedRef<string[]>,
  selectedInOrder: ComputedRef<string[]>,
) {
  const ui = useUiStore();

  function selectIds(ids: string[], anchor: string | null) {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.getSelection()?.removeAllRanges();
    ui.selectedBlockIds = ids;
    ui.lastSelectedId = anchor;
  }

  /* ⌘A: the first press selects the block's text as usual; the next one takes every block */
  function onKeydown(e: KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.code !== 'KeyA') return;
    if (document.querySelector('.scrim')) return; // a dialog owns the keyboard
    const t = e.target as HTMLElement | null;
    const inDoc = !!t && !!root.value?.contains(t);
    if (t?.isContentEditable && inDoc) {
      const text = t.textContent ?? '';
      const selected = window.getSelection()?.toString().length ?? 0;
      if (text && selected < text.length) return;
    } else if (t !== document.body && !inDoc) {
      return; // search boxes, the sidebar, a title field
    }
    if (!order.value.length) return;
    e.preventDefault();
    selectIds([...order.value], order.value[0]!);
  }

  /* a text drag that leaves its block becomes a block selection, so it can span the page */
  let startId: string | null = null;
  let crossing = false;

  function rowIdAt(x: number, y: number): string | null {
    const row = document.elementFromPoint(x, y)?.closest('.blk') as HTMLElement | null;
    return row && root.value?.contains(row) ? (row.dataset.blockId ?? null) : null;
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || ui.editingBlockId) return;
    const t = e.target as HTMLElement;
    if (t.closest('.handle, .ctrls, .seltoolbar, button, input, textarea, select')) return;
    startId = (t.closest('.blk') as HTMLElement | null)?.dataset.blockId ?? null;
    if (!startId) return;
    crossing = false;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', endDrag);
  }

  function onMouseMove(e: MouseEvent) {
    if (!startId || !(e.buttons & 1)) return endDrag();
    const id = rowIdAt(e.clientX, e.clientY);
    if (!id || (!crossing && id === startId)) return; // between rows, or still inside the first one
    if (!crossing) {
      crossing = true;
      root.value?.classList.add('drag-selecting');
    }
    const a = order.value.indexOf(startId);
    const b = order.value.indexOf(id);
    if (a < 0 || b < 0) return;
    selectIds(order.value.slice(Math.min(a, b), Math.max(a, b) + 1), startId);
  }

  function endDrag() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', endDrag);
    root.value?.classList.remove('drag-selecting');
    startId = null;
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown);
    root.value?.addEventListener('mousedown', onMouseDown);
  });
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown);
    root.value?.removeEventListener('mousedown', onMouseDown);
    endDrag();
  });

  /* bold / strike across the selected blocks: on for all unless every one already has it */
  const textRows = computed(() =>
    props.blocks.filter((b) => selectedInOrder.value.includes(b.id) && TEXT_TYPES.includes(b.type) && (b.text ?? '').trim()),
  );
  const allHave = (mark: Mark) => textRows.value.length > 0 && textRows.value.every((b) => wholeHasMark(b.text!, mark));
  const boldOn = computed(() => allHave('bold'));
  const strikeOn = computed(() => allHave('strike'));
  const canMark = computed(() => textRows.value.length > 0);

  async function markSelection(mark: Mark) {
    const on = !allHave(mark);
    for (const b of textRows.value) {
      const next = markWhole(b.text!, mark, on);
      if (next !== b.text) await blockService.updateBlock(b.id, { text: next });
    }
  }

  return { boldOn, strikeOn, canMark, markSelection };
}
