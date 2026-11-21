// ↑ on a field's first line / ↓ on its last line moves the caret into the field above / below.
import { onMounted, onUnmounted, type Ref } from 'vue';
import { selectionRange } from '@/components/primitives/editable/caret';

export type ArrowDir = 'up' | 'down';

export const arrowDir = (e: KeyboardEvent): ArrowDir | null =>
  e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.isComposing ? null
  : e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : null;

/** True when the caret sits on the field's first line (up) or last line (down). */
export function caretAtEdge(field: HTMLElement, dir: ArrowDir): boolean {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return false;
  const length = (field.textContent ?? '').length;
  if (!length) return true;
  const rect = sel.getRangeAt(0).getClientRects()[0];
  // a caret at a field or line boundary can have no box; its character offset decides instead
  if (!rect) {
    const at = selectionRange(field)?.start ?? 0;
    return dir === 'up' ? at === 0 : at === length;
  }
  const box = field.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(field).lineHeight) || rect.height || 20;
  return dir === 'up' ? rect.top < box.top + line * 0.75 : rect.bottom > box.bottom - line * 0.75;
}

function placeCaret(field: HTMLElement, atEnd: boolean) {
  field.focus();
  const range = document.createRange();
  range.selectNodeContents(field);
  range.collapse(!atEnd);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  field.scrollIntoView({ block: 'nearest' });
}

// table cells keep the browser's own arrows, and are skipped when moving past a table
const isNavField = (el: HTMLElement) => el.isContentEditable && !el.closest('table') && el.getClientRects().length > 0;

/** @param skip true while the page is in a mode the arrows should leave alone */
export function useArrowNav(root: Ref<HTMLElement | null>, skip: () => boolean) {
  function onKeydown(e: KeyboardEvent) {
    const dir = arrowDir(e);
    const t = e.target as HTMLElement;
    if (!dir || e.defaultPrevented || skip() || !t.classList.contains('editable') || !isNavField(t)) return;
    if (!caretAtEdge(t, dir)) return;
    const fields = [...(root.value?.querySelectorAll<HTMLElement>('.editable') ?? [])].filter(isNavField);
    const at = fields.indexOf(t);
    const next = at < 0 ? undefined : fields[at + (dir === 'up' ? -1 : 1)];
    if (!next) return;
    e.preventDefault();
    placeCaret(next, dir === 'up'); // going up lands at the end, going down at the start
  }

  onMounted(() => root.value?.addEventListener('keydown', onKeydown));
  onUnmounted(() => root.value?.removeEventListener('keydown', onKeydown));
}
