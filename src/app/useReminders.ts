// Snooze and due dates, delivered: a chime and a pinned notice, since a reminder exists for when you weren't looking.
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useSyncStore } from '@/stores/sync.store';
import { useNoticeStore } from '@/stores/notice.store';
import { useNotificationPrefs } from '@/composables/useNotificationPrefs';
import { createChime, armOnFirstGesture } from '@/core/reminders/chime';
import { ReminderScheduler } from '@/services/reminder.service';
import { fullWhen } from '@/core/editor/snooze';

export function useReminders() {
  const syncStore = useSyncStore();
  const notices = useNoticeStore();
  let disarmChime: (() => void) | null = null;
  const chime = createChime();
  const notifyPrefs = useNotificationPrefs();
  const reminders = new ReminderScheduler({
    dueTime: () => (notifyPrefs.dueOn.value ? notifyPrefs.prefs.dueTime : null),
    onDue: (due) => {
      // muted: snoozed items still come back (the scheduler cleared them); only the sound and notice stop
      if (!notifyPrefs.remindersOn.value) return;
      void chime.play();
      const snoozed = due.filter((d) => d.kind === 'snooze');
      const dated = due.filter((d) => d.kind === 'due');
      if (snoozed.length) {
        notices.notify(
          snoozed.length === 1
            ? `⏰ ${snoozed[0]!.title} — snoozed until ${fullWhen(snoozed[0]!.at)}`
            : `⏰ ${snoozed.length} snoozed items are back`,
          'info',
          0,
        );
      }
      if (dated.length) {
        notices.notify(
          dated.length === 1 ? `📅 ${dated[0]!.title} is due today` : `📅 ${dated.length} items are due`,
          'info',
          0,
        );
      }
    },
  });
  onMounted(async () => {
    disarmChime = armOnFirstGesture(chime);
    await notifyPrefs.ready();
    reminders.start();
  });
  watch(
    () => [notifyPrefs.dueOn.value, notifyPrefs.prefs.dueTime],
    () => reminders.refresh(),
  );

  // conflict alerts: Banner (default), Banner + sound, or Quiet (sidebar line + Sync & Storage only)
  const showConflictBar = computed(() => notifyPrefs.conflictAlert.value !== 'quiet');
  watch(
    () => syncStore.conflicts.length,
    (n, before) => {
      if (n > (before ?? 0) && notifyPrefs.conflictAlert.value === 'sound') void chime.play();
    },
  );

  onUnmounted(() => {
    reminders.stop();
    disarmChime?.();
  });

  return { showConflictBar };
}
