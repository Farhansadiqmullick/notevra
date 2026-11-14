/**
 * useBreakpoint — reactive viewport size → layout mode. Drives the responsive shell
 * (design_skiil.md §Responsive). Shared singleton so every consumer reads the same width.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';

const width = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);
let listeners = 0;
const onResize = () => (width.value = window.innerWidth);

export function useBreakpoint() {
  onMounted(() => {
    if (listeners++ === 0) window.addEventListener('resize', onResize);
  });
  onUnmounted(() => {
    if (--listeners === 0) window.removeEventListener('resize', onResize);
  });

  const isMobile = computed(() => width.value < 900); // sidebar → drawer + bottom tabs
  const isCompact = computed(() => width.value < 1280); // narrower panes
  /**
   * Below this a two-pane screen stops being two panes and becomes one view at a time.
   *
   * Deliberately NOT `isMobile`. The sidebar has to fold away at 900 because it is a third column,
   * but Archive's list+detail still fit either side of 720 (390 for the list leaves ~330 for the
   * detail) — a portrait tablet keeps both, and only phones get the pushed view.
   */
  const isNarrow = computed(() => width.value < 720);
  return { width, isMobile, isCompact, isNarrow };
}
