// The detail pane's Pin button: state, the per-list cap, and the toggle.
import { computed } from 'vue';
import type { BlockRow } from '@/core/db/schema';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { pinService, isPinned, PIN_CAP } from '@/services/pin.service';
import { useNoticeStore } from '@/stores/notice.store';

/** @param block the selected task, read at call time */
export function useTaskPin(block: () => BlockRow | null) {
  const notices = useNoticeStore();

  const pinned = computed(() => !!block() && isPinned(block()!));
  const pinnedInList = useLiveQuery<number>(
    () => (block() ? pinService.countPinned(block()!.noteId) : Promise.resolve(0)),
    0,
    () => block()?.noteId,
  );
  const atCap = computed(() => !pinned.value && pinnedInList.value >= PIN_CAP);
  const pinTitle = computed(() =>
    block()?.checked ? 'Done tasks can’t be pinned' : atCap.value ? `${PIN_CAP} pinned already — unpin one first` : pinned.value ? 'Unpin' : 'Pin to the top of this list',
  );

  async function togglePin() {
    const b = block();
    if (!b) return;
    try {
      if (!(await pinService.setPinned(b.id, !pinned.value))) notices.info(`${PIN_CAP} pinned already — unpin one first`);
    } catch {
      notices.danger('Could not change the pin on this task');
    }
  }

  return { pinned, atCap, pinTitle, togglePin };
}
