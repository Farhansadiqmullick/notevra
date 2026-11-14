// ⌘Z straight after a line-start conversion puts back the text that was typed ("- " → a list → "- ").
import { onMounted, onUnmounted } from 'vue';
import { db } from '@/core/db/schema';
import { blockService } from '@/services/block.service';
import { useUiStore } from '@/stores/ui.store';

const WINDOW_MS = 15_000;

export function useShortcutUndo() {
  const ui = useUiStore();

  async function revert(): Promise<void> {
    const last = ui.lastShortcut;
    ui.lastShortcut = null;
    if (!last) return;
    // "[x] " ticked the task; the Text line it goes back to carries no tick
    if (last.fromType !== 'task' && (await db.blocks.get(last.blockId))?.checked) await blockService.toggleTask(last.blockId, false);
    await blockService.convertBlock(last.blockId, last.fromType, { text: last.typed });
    if (last.extraId && !(await db.blocks.get(last.extraId))?.text) await blockService.deleteBlock(last.extraId);
    ui.setFocus(last.blockId);
  }

  function onKeydown(e: KeyboardEvent): void {
    const last = ui.lastShortcut;
    if (!last || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
    if (Date.now() - last.at > WINDOW_MS) return void (ui.lastShortcut = null);
    const here = (document.activeElement as HTMLElement | null)?.closest('[data-block-id]')?.getAttribute('data-block-id');
    if (here !== last.blockId && here !== last.extraId) return;
    e.preventDefault();
    e.stopPropagation();
    void revert();
  }

  // anything typed after the conversion makes ⌘Z mean ordinary undo again
  const onInput = () => (ui.lastShortcut = null);

  onMounted(() => {
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('input', onInput, true);
  });
  onUnmounted(() => {
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('input', onInput, true);
  });
}
