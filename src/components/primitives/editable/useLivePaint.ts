// Two paintings of a marks field (design/markdown-v3.md): clean formatting idle, faded markers while editing.
import type { Ref } from 'vue';
import { renderLive, renderMarks, toggleMark, type Mark } from '@/core/editor/marks';
import { createUndoStack, type Snapshot } from '@/core/editor/undoStack';
import { restoreRange, selectionRange } from './caret';

// M4: markers show only in the run the caret touches; 'faded' keeps them all visible if hiding misbehaves
export const LIVE_MARKERS: 'hide' | 'faded' = 'hide';

export function useLivePaint(
  el: Ref<HTMLElement | null>,
  props: { readonly modelValue: string; readonly marks: boolean },
  emitInput: (text: string) => void,
) {
  /** Is the caret in this field right now? Decides which of the two paintings is correct. */
  const isEditing = () => document.activeElement === el.value;

  let shown: 'plain' | 'idle' | 'live' = 'plain';
  let composing = false;

  function setLive(text: string): void {
    const node = el.value;
    if (!node) return;
    if (props.marks) {
      node.innerHTML = renderLive(text);
      shown = 'live';
    } else node.textContent = text;
  }

  function paint(): void {
    const node = el.value;
    if (!node) return;
    if (props.marks && !isEditing()) {
      node.innerHTML = renderMarks(props.modelValue);
      shown = 'idle';
    } else if (props.marks) paintLive();
    else if (node.textContent !== props.modelValue) node.textContent = props.modelValue;
  }

  // on mousedown, before the browser places the caret, so the click lands in the text being edited
  function paintLive(): void {
    const node = el.value;
    if (!node || !props.marks) return;
    if (shown !== 'live' || node.textContent !== props.modelValue) setLive(props.modelValue);
  }

  /** Re-render after typing, keeping the caret on the same character. */
  function repaintLive(): void {
    const node = el.value;
    if (!node || !props.marks || composing) return;
    const sel = selectionRange(node);
    setLive(node.textContent ?? '');
    if (sel) restoreRange(node, sel.start, sel.end);
    markActiveRuns();
  }

  function markActiveRuns(): void {
    const node = el.value;
    if (!node || !props.marks || LIVE_MARKERS !== 'hide' || shown !== 'live') return;
    const sel = isEditing() ? selectionRange(node) : null;
    for (const r of node.querySelectorAll<HTMLElement>('.run')) {
      let on = false;
      if (sel) {
        const before = document.createRange();
        before.selectNodeContents(node);
        before.setEndBefore(r);
        const start = before.toString().length;
        const end = start + (r.textContent ?? '').length;
        // touching counts, so the caret just after `**b**` shows the markers it would delete
        on = sel.start <= end && sel.end >= start;
      }
      r.classList.toggle('active', on);
    }
  }

  // repainting wipes the browser's own undo history, so marks fields keep one
  const history = createUndoStack();
  function snapshot(): Snapshot {
    const node = el.value;
    const text = node?.textContent ?? '';
    const sel = node ? selectionRange(node) : null;
    return { text, start: sel?.start ?? text.length, end: sel?.end ?? text.length };
  }
  function stepHistory(redo: boolean): void {
    const node = el.value;
    const s = redo ? history.redo() : history.undo();
    if (!node || !s) return;
    setLive(s.text);
    emitInput(s.text);
    restoreRange(node, s.start, s.end);
  }

  // Bengali and other IME input: no repaint mid-character, one when it's finished
  function onCompositionStart(): void {
    composing = true;
  }
  function onCompositionEnd(): void {
    composing = false;
    if (!props.marks) return;
    repaintLive();
    history.record(snapshot());
  }

  function onFocus(): void {
    paintLive();
    if (props.marks) history.reset(snapshot());
  }

  // restores the selection, so bold-then-keep-typing works
  function applyMark(mark: Mark): void {
    const node = el.value;
    if (!node) return;
    const sel = selectionRange(node);
    if (!sel) return;
    const next = toggleMark(node.textContent ?? '', sel.start, sel.end, mark);
    if (next.text === node.textContent) return;
    setLive(next.text);
    emitInput(next.text);
    restoreRange(node, next.start, next.end);
    history.record(next, true);
  }

  return {
    isEditing,
    isComposing: () => composing,
    setLive,
    paint,
    paintLive,
    repaintLive,
    markActiveRuns,
    history,
    snapshot,
    stepHistory,
    onCompositionStart,
    onCompositionEnd,
    onFocus,
    applyMark,
  };
}
