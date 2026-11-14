// Scroll position per page, for this session — design/backlog-after-sync.md §6.
import { onMounted, onBeforeUnmount, type Ref } from 'vue';

const saved = new Map<string, number>();
const POLL_MS = 50;
const GIVE_UP_MS = 1500;
const USER_SCROLL = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

export type Scrollable = Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight' | 'addEventListener' | 'removeEventListener'>;

/**
 * Waits for the page's liveQuery content to make the element tall enough, then scrolls; any user scroll cancels.
 * @return a cancel function
 */
export function restoreScroll(el: Scrollable, top: number): () => void {
  let waited = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timer);
    for (const ev of USER_SCROLL) el.removeEventListener(ev, stop);
  };
  const attempt = () => {
    if (el.scrollHeight - el.clientHeight >= top || waited >= GIVE_UP_MS) {
      el.scrollTop = top;
      stop();
      return;
    }
    waited += POLL_MS;
    timer = setTimeout(attempt, POLL_MS);
  };
  for (const ev of USER_SCROLL) el.addEventListener(ev, stop, { passive: true });
  attempt();
  return stop;
}

export const rememberScroll = (key: string, top: number) => saved.set(key, top);
export const savedScroll = (key: string) => saved.get(key) ?? 0;

export function useScrollMemory(key: string, el: Ref<HTMLElement | null>) {
  let cancel: (() => void) | undefined;
  onMounted(() => {
    const top = savedScroll(key);
    if (el.value && top > 0) cancel = restoreScroll(el.value, top);
  });
  onBeforeUnmount(() => {
    cancel?.();
    if (el.value) rememberScroll(key, el.value.scrollTop);
  });
}
