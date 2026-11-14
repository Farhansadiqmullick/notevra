// Undo/redo for the open page: the top-bar buttons and Ctrl/⌘Z, Ctrl/⌘Shift+Z, Ctrl+Y.
import { computed, onMounted, onUnmounted, type Ref } from 'vue';
import { canRedo, canUndo, redo, undo } from '@/core/editor/pageHistory';
import { IS_MAC } from '@/utils/platform';

const isTextTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');

export function usePageHistory(noteId: Ref<string>) {
  const undoable = computed(() => canUndo(noteId.value));
  const redoable = computed(() => canRedo(noteId.value));
  const undoLabel = `Undo (${IS_MAC ? '⌘Z' : 'Ctrl+Z'})`;
  const redoLabel = `Redo (${IS_MAC ? '⌘⇧Z' : 'Ctrl+Y'})`;

  function onKey(e: KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const isUndo = key === 'z' && !e.shiftKey;
    const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.metaKey);
    if (!isUndo && !isRedo) return;
    // inside a text field the field's own undo handles typing
    if (isTextTarget(e.target)) return;
    e.preventDefault();
    void (isUndo ? undo(noteId.value) : redo(noteId.value));
  }
  onMounted(() => window.addEventListener('keydown', onKey));
  onUnmounted(() => window.removeEventListener('keydown', onKey));

  return {
    undoable, redoable, undoLabel, redoLabel,
    undo: () => undo(noteId.value),
    redo: () => redo(noteId.value),
  };
}
