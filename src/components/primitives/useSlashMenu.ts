// The inline `/` menu: opens at a line start or after a space, anywhere in the text.
import { ref, computed } from 'vue';
import { CONVERTIBLE_TYPES } from '@/core/editor/blockTypes';

// `a/b` and `https://` don't open it: the `/` must start a word
const TRIGGER = /(^|\s)\/([^\s/]*)$/;

/** Where a `/command` being typed starts, read from the text up to the caret. */
export function slashAt(beforeCaret: string): { start: number; query: string } | null {
  const m = TRIGGER.exec(beforeCaret);
  return m ? { start: m.index + m[1]!.length, query: m[2]! } : null;
}

/** The text with the `/command` taken out, and no doubled space left where it was. */
export function withoutCommand(text: string, start: number, query: string): string {
  if (text[start] !== '/') return text;
  const before = text.slice(0, start);
  let after = text.slice(start + 1 + query.length);
  if (/\s$/.test(before) && /^\s/.test(after)) after = after.slice(1);
  return before + after;
}

export function useSlashMenu() {
  const open = ref(false);
  const query = ref('');
  const index = ref(0);
  let start = 0;

  const items = computed(() =>
    CONVERTIBLE_TYPES.filter((d) => d.label.toLowerCase().includes(query.value.toLowerCase())),
  );

  function close() {
    open.value = false;
    query.value = '';
    index.value = 0;
  }

  function openAt(at: number, q = '') {
    start = at;
    query.value = q;
    index.value = 0;
    open.value = true;
  }

  // nothing matches, so it's prose with a slash in it: step aside and let Enter work
  function detect(beforeCaret: string) {
    const hit = slashAt(beforeCaret);
    if (!hit) return close();
    openAt(hit.start, hit.query);
    if (!items.value.length) close();
  }

  const strip = (text: string) => withoutCommand(text, start, query.value);

  function move(step: number) {
    const n = items.value.length;
    if (n) index.value = (index.value + step + n) % n;
  }

  return { open, query, index, items, close, openAt, detect, strip, move };
}
