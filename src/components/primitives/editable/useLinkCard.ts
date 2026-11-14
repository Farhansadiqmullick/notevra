// Hover card on a link (Open / Copy / Edit / Remove); only while idle, when the text is rendered with links.
import { computed, onUnmounted, ref, type Ref } from 'vue';
import { renderMarks, toggleLink } from '@/core/editor/marks';
import { restoreRange } from './caret';

export type LinkCardState = { href: string; label: string; index: number; top: number; left: number };

export const openUrl = (href: string) => href && window.open(href, '_blank', 'noopener,noreferrer');

export function useLinkCard(
  el: Ref<HTMLElement | null>,
  props: { readonly modelValue: string },
  emitInput: (text: string) => void,
  paintLive: () => void,
  startLink: () => void,
) {
  const card = ref<LinkCardState | null>(null);
  let cardTimer: ReturnType<typeof setTimeout> | undefined;

  function anchorAt(target: EventTarget | null): HTMLAnchorElement | null {
    const a = (target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    return a && el.value?.contains(a) ? a : null;
  }

  function onMouseOver(e: MouseEvent): void {
    const a = anchorAt(e.target);
    if (!a) return;
    clearTimeout(cardTimer);
    const href = a.getAttribute('href') ?? '';
    // which of this field's links with the same address, counted in reading order
    const index = [...el.value!.querySelectorAll('a[href]')].filter((x) => x.getAttribute('href') === href).indexOf(a);
    cardTimer = setTimeout(() => {
      const r = a.getBoundingClientRect();
      card.value = { href, label: a.textContent ?? '', index, top: r.bottom + 6, left: r.left };
    }, 250);
  }

  function scheduleHide(): void {
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => (card.value = null), 200);
  }
  const keepCard = () => clearTimeout(cardTimer);
  function hideCard(): void {
    clearTimeout(cardTimer);
    card.value = null;
  }
  onUnmounted(() => clearTimeout(cardTimer));

  // a bare address can't be unlinked, only turned into a named link
  const cardIsMarkdown = computed(() => (card.value ? cardRange(card.value)?.bare === false : false));

  /** Where the hovered link sits in the stored text: the label of a `[label](url)`, or a bare address. */
  function cardRange(c: { href: string; index: number }): { start: number; end: number; bare: boolean } | null {
    const text = props.modelValue;
    const hits: { start: number; end: number; bare: boolean }[] = [];
    for (const m of text.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
      if (m[2] === c.href) hits.push({ start: m.index! + 1, end: m.index! + 1 + m[1]!.length, bare: false });
    }
    for (const m of text.matchAll(/https?:\/\/[^\s<]+/g)) {
      const at = m.index!;
      const insideMarkdown = text[at - 1] === '(' && text[at - 2] === ']';
      // same trailing-punctuation rule as the renderer
      const url = m[0].replace(/[.,;:!?)]+$/, '');
      if (!insideMarkdown && url === c.href) hits.push({ start: at, end: at + url.length, bare: true });
    }
    hits.sort((a, b) => a.start - b.start);
    return hits[c.index] ?? null;
  }

  function openCard(): void {
    if (card.value) openUrl(card.value.href);
    hideCard();
  }

  async function copyLink(): Promise<void> {
    const href = card.value?.href;
    hideCard();
    if (href) await navigator.clipboard?.writeText(href).catch(() => undefined);
  }

  function editLink(): void {
    const c = card.value;
    const node = el.value;
    hideCard();
    if (!c || !node) return;
    const range = cardRange(c);
    if (!range) return;
    node.focus();
    paintLive();
    restoreRange(node, range.start, range.end);
    startLink();
  }

  function removeLink(): void {
    const c = card.value;
    const node = el.value;
    hideCard();
    if (!c || !node) return;
    const range = cardRange(c);
    if (!range || range.bare) return;
    const next = toggleLink(props.modelValue, range.start, range.end, null);
    if (next.text === props.modelValue) return;
    emitInput(next.text);
    node.innerHTML = renderMarks(next.text);
  }

  return { card, cardIsMarkdown, anchorAt, onMouseOver, scheduleHide, keepCard, hideCard, openCard, copyLink, editLink, removeLink };
}
