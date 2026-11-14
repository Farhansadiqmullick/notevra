// Selection as character offsets into a field's text, measured across nodes, not within one.

export function selectionRange(node: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!node.contains(r.commonAncestorContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(node);
  before.setEnd(r.startContainer, r.startOffset);
  const start = before.toString().length;
  return { start, end: start + r.toString().length };
}

/** Put the selection back on the same characters after the text under it changed length. */
export function restoreRange(node: HTMLElement, start: number, end: number): void {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let placedStart = false;
  let t = walker.nextNode() as Text | null;
  while (t) {
    const len = t.data.length;
    if (!placedStart && seen + len >= start) {
      range.setStart(t, start - seen);
      placedStart = true;
    }
    if (placedStart && seen + len >= end) {
      range.setEnd(t, end - seen);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
    seen += len;
    t = walker.nextNode() as Text | null;
  }
}

export function caretPos(): { top: number; left: number } | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return { top: r.top, left: r.left + r.width / 2 };
}

export function caretToEnd(node: HTMLElement): void {
  node.focus();
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
