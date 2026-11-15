// One open tab runs reminders: it holds a Web Lock until it closes, then the next tab takes over.
import type { DueReminder } from '@/services/reminder.service';

const LOCK = 'notevra-reminder-lead';
const CHANNEL = 'notevra-reminders';

let leading = false;
export const isReminderLead = () => leading;

/** calls `onLead` once this tab holds the lock; a browser without Web Locks is always the lead */
export function claimReminderLead(onLead: () => void): void {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const lead = () => {
    leading = true;
    onLead();
  };
  if (!locks) return lead();
  // the callback's promise never settles, so the lock is held for the life of the tab
  void locks.request(LOCK, () => new Promise<never>(() => lead())).catch(lead);
}

// the lead tab passes what came due to the others, so every open tab shows the notice
export function reminderChannel(onDue: (due: DueReminder[]) => void): { send: (due: DueReminder[]) => void; close: () => void } {
  if (typeof BroadcastChannel === 'undefined') return { send: () => undefined, close: () => undefined };
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent<DueReminder[]>) => {
    if (!leading && Array.isArray(e.data)) onDue(e.data);
  };
  return { send: (due) => ch.postMessage(due), close: () => ch.close() };
}
