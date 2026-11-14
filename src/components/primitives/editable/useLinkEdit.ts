// The link address box: the selection is held as offsets while the box has focus.
import { computed, ref, type Ref } from 'vue';
import { findLink, toggleLink } from '@/core/editor/marks';
import { caretPos, restoreRange, selectionRange } from './caret';
import type { useLivePaint } from './useLivePaint';

export function useLinkEdit(
  el: Ref<HTMLElement | null>,
  paint: ReturnType<typeof useLivePaint>,
  emitInput: (text: string) => void,
  barRect: Ref<{ top: number; left: number } | null>,
) {
  const linkDraft = ref<string | null>(null);
  const linkSel = ref<{ start: number; end: number } | null>(null);
  const linkPos = ref<{ top: number; left: number } | null>(null);

  const linkAtSel = computed(() => {
    const node = el.value;
    const s = linkSel.value;
    return node && s ? findLink(node.textContent ?? '', s.start, s.end) : null;
  });

  function startLink(): void {
    const node = el.value;
    if (!node) return;
    const sel = selectionRange(node);
    if (!sel) return;
    const existing = findLink(node.textContent ?? '', sel.start, sel.end);
    if (sel.start === sel.end && !existing) return;
    linkSel.value = sel;
    linkPos.value = barRect.value ?? caretPos();
    linkDraft.value = existing?.url ?? '';
  }

  function finishLink(url: string | null): void {
    const node = el.value;
    const sel = linkSel.value;
    linkDraft.value = null;
    linkSel.value = null;
    if (!node || !sel) return;
    node.focus();
    paint.paintLive();
    const text = node.textContent ?? '';
    const next = toggleLink(text, sel.start, sel.end, url);
    if (next.text !== text) {
      paint.setLive(next.text);
      emitInput(next.text);
    }
    restoreRange(node, next.start, next.end);
    if (next.text !== text) paint.history.record(next, true);
  }

  function cancelLink(): void {
    const node = el.value;
    const sel = linkSel.value;
    linkDraft.value = null;
    linkSel.value = null;
    if (!node || !sel) return;
    node.focus();
    paint.paintLive();
    restoreRange(node, sel.start, sel.end);
  }

  return { linkDraft, linkPos, linkAtSel, startLink, finishLink, cancelLink };
}
