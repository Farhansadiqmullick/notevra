// Drag to reorder or nest: top half → before, bottom-left → after, bottom-right third → subtask.
import { ref, type ComputedRef } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { blockService } from '@/services/block.service';
import type { BlockRow } from '@/core/db/schema';

export type DropMode = 'before' | 'after' | 'child';
const NEST_INSET = 72; // px from the row's start before a drop counts as "nest under this"

export function useBlockDrag(
  props: { readonly blocks: BlockRow[] },
  locked: ComputedRef<boolean>,
  selectedInOrder: ComputedRef<string[]>,
  clearHold: () => void,
) {
  const ui = useUiStore();
  const draggingId = ref<string | null>(null);
  const overId = ref<string | null>(null);
  const dropMode = ref<DropMode>('before');
  /** finger position for the touch ghost (HTML5 drag events don't exist on touch) */
  const touchPos = ref<{ x: number; y: number } | null>(null);

  const byId = (id: string) => props.blocks.find((b) => b.id === id);

  /** what the drop would do, from the pointer's place inside the row */
  function modeFor(target: BlockRow, rect: DOMRect, x: number, y: number): DropMode {
    const lower = y > rect.top + rect.height / 2;
    if (!lower) return 'before';
    const dragged = byId(draggingId.value ?? '');
    const nestable = target.type === 'task' && dragged?.type === 'task';
    // only the right third nests; most of the row reorders, which is what a drag usually means
    return nestable && x - rect.left > Math.max(NEST_INSET, rect.width * (2 / 3)) ? 'child' : 'after';
  }

  function endDrag() {
    draggingId.value = null;
    overId.value = null;
    touchPos.value = null;
  }

  function onDragStart(b: BlockRow, e: DragEvent) {
    if (locked.value) return;
    draggingId.value = b.id;
    e.dataTransfer!.effectAllowed = 'move';
    // a custom mime, never text/plain, or a drop on a contenteditable body pastes the raw id into it
    e.dataTransfer!.setData('application/x-blocnote-block', b.id);
  }
  function onDragOver(b: BlockRow, e: DragEvent) {
    if (!draggingId.value || b.id === draggingId.value) return;
    e.preventDefault();
    dropMode.value = modeFor(b, (e.currentTarget as HTMLElement).getBoundingClientRect(), e.clientX, e.clientY);
    overId.value = b.id;
  }
  function onDrop(b: BlockRow, e: DragEvent) {
    e.preventDefault(); // never let the browser insert the payload into a contenteditable body
    void applyDrop(b.id);
  }

  /** touch drag: same three zones, driven by touch events + hit-testing */
  function onHandleTouchStart(b: BlockRow, e: TouchEvent) {
    if (locked.value) return;
    clearHold(); // the row's long-press-to-select must not also fire
    draggingId.value = b.id;
    const t = e.touches[0];
    touchPos.value = { x: t.clientX, y: t.clientY };
    window.addEventListener('touchmove', onTouchDragMove, { passive: false });
    window.addEventListener('touchend', onTouchDragEnd);
    window.addEventListener('touchcancel', endDrag);
  }
  function onTouchDragMove(e: TouchEvent) {
    if (!draggingId.value) return;
    e.preventDefault(); // hold the page still while dragging
    const t = e.touches[0];
    touchPos.value = { x: t.clientX, y: t.clientY };

    const row = (document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null)?.closest('.blk') as HTMLElement | null;
    const id = row?.dataset.blockId;
    const target = id ? byId(id) : undefined;
    if (!target || target.id === draggingId.value) {
      overId.value = null;
      return;
    }
    dropMode.value = modeFor(target, row!.getBoundingClientRect(), t.clientX, t.clientY);
    overId.value = target.id;
  }
  function onTouchDragEnd() {
    window.removeEventListener('touchmove', onTouchDragMove);
    window.removeEventListener('touchend', onTouchDragEnd);
    window.removeEventListener('touchcancel', endDrag);
    const target = overId.value;
    if (target) void applyDrop(target);
    else endDrag();
  }

  // nestBlock has the final say (depth, own subtree); if it refuses, the drop falls back to a reorder
  async function applyDrop(targetId: string) {
    const id = draggingId.value;
    const mode = dropMode.value;
    endDrag();
    if (!id) return;

    // dragging a selected block moves the WHOLE selection, keeping its document order
    const moving = ui.selectedBlockIds.includes(id) ? selectedInOrder.value : [id];
    if (moving.includes(targetId)) return; // can't drop a selection onto itself

    if (mode === 'child') {
      let nested = false;
      for (const m of moving) nested = (await blockService.nestBlock(m, targetId)) || nested;
      if (nested) {
        ui.clearSelection();
        return;
      }
    }

    const list = props.blocks.filter((x) => !moving.includes(x.id));
    const targetIdx = list.findIndex((x) => x.id === targetId);
    if (targetIdx < 0) return;
    const insertAt = mode === 'before' ? targetIdx : targetIdx + 1;
    const before = list[insertAt - 1]?.position;
    const after = list[insertAt]?.position;

    // carve the gap into one slot per moved block so relative order survives
    const start = before ?? (after != null ? after - 1 : 0);
    const end = after ?? (before != null ? before + 1 : moving.length);
    const step = (end - start) / (moving.length + 1);

    for (let i = 0; i < moving.length; i++) {
      await blockService.updateBlock(moving[i], { position: start + step * (i + 1) });
    }
  }

  return { draggingId, overId, dropMode, touchPos, onDragStart, onDragOver, onDrop, onHandleTouchStart, endDrag };
}
