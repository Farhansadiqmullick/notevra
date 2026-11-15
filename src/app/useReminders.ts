// Snooze and due dates, delivered: a tone, a pinned notice, and a system notification when you're elsewhere.
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useSyncStore } from '@/stores/sync.store';
import { useNoticeStore } from '@/stores/notice.store';
import { useNotificationPrefs } from '@/composables/useNotificationPrefs';
import { createChime, armOnFirstGesture } from '@/core/reminders/chime';
import { claimReminderLead, isReminderLead, reminderChannel } from '@/core/reminders/lead';
import { systemNotify } from '@/core/reminders/systemNotify';
import { ReminderScheduler, type DueReminder } from '@/services/reminder.service';
import { fullWhen } from '@/core/editor/snooze';

export function useReminders() {
  const syncStore = useSyncStore();
  const notices = useNoticeStore();
  let disarmChime: (() => void) | null = null;
  const notifyPrefs = useNotificationPrefs();
  const chime = createChime(() => notifyPrefs.prefs.tone);

  function messages(due: DueReminder[]): string[] {
    const snoozed = due.filter((d) => d.kind === 'snooze');
    const dated = due.filter((d) => d.kind === 'due');
    const out: string[] = [];
    if (snoozed.length) {
      out.push(snoozed.length === 1 ? `⏰ ${snoozed[0]!.title} — snoozed until ${fullWhen(snoozed[0]!.at)}` : `⏰ ${snoozed.length} snoozed items are back`);
    }
    if (dated.length) out.push(dated.length === 1 ? `📅 ${dated[0]!.title} is due today` : `📅 ${dated.length} items are due`);
    return out;
  }
  const showNotices = (due: DueReminder[]) => messages(due).forEach((m) => notices.notify(m, 'info', 0));

  // other tabs only show the notice; the sound and the system notification come from the lead tab
  const channel = reminderChannel((due) => {
    if (notifyPrefs.remindersOn.value) showNotices(due);
  });

  const reminders = new ReminderScheduler({
    dueTime: () => (notifyPrefs.dueOn.value ? notifyPrefs.prefs.dueTime : null),
    onDue: (due) => {
      // muted: snoozed items still come back (the scheduler cleared them); only the sound and notice stop
      if (!notifyPrefs.remindersOn.value) return;
      void chime.play();
      showNotices(due);
      channel.send(due);
      for (const m of messages(due)) void systemNotify('Notevra', m.replace(/^\S+\s/, ''));
    },
  });
  onMounted(async () => {
    disarmChime = armOnFirstGesture(chime);
    await notifyPrefs.ready();
    claimReminderLead(() => reminders.start());
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
      if (n > (before ?? 0) && notifyPrefs.conflictAlert.value === 'sound' && isReminderLead()) void chime.play();
    },
  );

  onUnmounted(() => {
    reminders.stop();
    channel.close();
    disarmChime?.();
  });

  return { showConflictBar };
}
