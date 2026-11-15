// ⌥S / Alt+S opens the snooze menu of whichever snooze control is on screen.
import { watch } from 'vue';
import { useUiStore } from '@/stores/ui.store';

export function useSnoozeShortcut(canOpen: () => boolean, open: () => void) {
  const ui = useUiStore();
  watch(
    () => ui.snoozeAsked,
    (asked) => {
      if (!asked || !canOpen()) return;
      ui.snoozeAsked = false;
      open();
    },
    { immediate: true },
  );
}
