/**
 * usePropsRail — where the properties surface is, and how to open it.
 *
 * Three presentations, one state:
 *   desktop, roomy    → the rail PUSHES the content aside (268px)
 *   desktop, cramped  → the rail FLOATS over the content, because pushing would crush it
 *   phone             → a bottom sheet (design/mobile-properties.md)
 *
 * The floor is computed, not guessed. A page tells us how much width its other panes already take
 * (`RAIL_RESERVE`) — Single has the sidebar, Planning has the sidebar *and* the contents pane — and
 * from that we know how much is left for the document. Pinning the rail open used to crush Planning
 * to a ~250px column of one-word lines at 1000px, because the preference ignored how many panes the
 * page had.
 */
import { computed, inject, ref, type InjectionKey } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { useBreakpoint } from '@/composables/useBreakpoint';

/** width already spent on other panes; pages provide it, default = sidebar only */
export const RAIL_RESERVE: InjectionKey<number> = Symbol('railReserve');

export const RAIL_WIDTH = 268;
/** open by default only if the document keeps a full measure next to it */
const AUTO_MIN_CONTENT = 640;
/** below this the rail must not take layout width — it floats instead */
const PUSH_MIN_CONTENT = 560;
/** phones get the sheet, never the rail */
const MOBILE_MAX = 900;

/** the sheet is one thing on screen at a time, so its state is module-level */
const sheetOpen = ref(false);

export function usePropsRail() {
  const ui = useUiStore();
  const { width } = useBreakpoint();
  const reserve = inject(RAIL_RESERVE, 250);

  const isMobile = computed(() => width.value < MOBILE_MAX);
  /** window width at which the rail can open by default without squeezing the document */
  const autoAt = computed(() => reserve + RAIL_WIDTH + AUTO_MIN_CONTENT);
  /** below this an open rail floats over the content instead of pushing it */
  const pushAt = computed(() => reserve + RAIL_WIDTH + PUSH_MIN_CONTENT);

  /** is the rail showing at all (false on phones — that's the sheet's job) */
  const open = computed(() => {
    if (isMobile.value) return false;
    return ui.railPref === null ? width.value >= autoAt.value : ui.railPref === 'open';
  });

  /** showing, but floating over the document rather than pushing it aside */
  const overlay = computed(() => open.value && width.value < pushAt.value);

  function show() {
    if (isMobile.value) sheetOpen.value = true;
    else ui.setRailPref('open');
  }
  function hide() {
    if (isMobile.value) sheetOpen.value = false;
    else ui.setRailPref('closed');
  }
  function toggle() {
    if (isMobile.value) sheetOpen.value = !sheetOpen.value;
    else ui.setRailPref(open.value ? 'closed' : 'open');
  }

  return { open, overlay, isMobile, sheetOpen, toggle, show, hide };
}
