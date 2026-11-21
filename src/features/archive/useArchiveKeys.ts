// ↑ / ↓ step through the Archive list, in the order it is drawn; while typing, from the text's first or last line.
import { onMounted, onUnmounted } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { arrowDir, caretAtEdge } from '@/features/editor/document/arrowNav';

/** how the next item is reached: highlighted only, with its row focused, or opened for typing */
export type StepMode = 'select' | 'focus' | 'edit';

/** @param order the item ids as drawn on screen */
export function useArchiveKeys(
  order: () => string[],
  selectedId: () => string | null,
  step: (id: string, mode: StepMode) => void,
) {
  const ui = useUiStore();

  function onKeydown(e: KeyboardEvent) {
    const dir = arrowDir(e);
    if (!dir || e.defaultPrevented) return;
    if (ui.paletteOpen || ui.settingsOpen || document.querySelector('.scrim')) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, select, [role="menu"], .menu')) return;
    // typing: only a list row's text hands over, and only from its edge line
    const typing = !!t?.isContentEditable;
    const row = t?.closest<HTMLElement>('.arow');
    if (typing && (!row || !caretAtEdge(t, dir))) return;

    const ids = order();
    // a just-added item can be typed in before it is the selected one, so typing starts from its own row
    const at = ids.indexOf((typing ? row?.dataset.blockId : selectedId()) ?? '');
    const next = at < 0 ? 0 : at + (dir === 'down' ? 1 : -1);
    if (!ids[next] || (typing && at < 0)) return;
    e.preventDefault();
    step(ids[next]!, typing ? 'edit' : row ? 'focus' : 'select');
  }

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onUnmounted(() => window.removeEventListener('keydown', onKeydown));
}
