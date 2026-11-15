// Notification settings, per device (db.meta, like the theme). Shared by every caller.
import { computed, reactive, watch } from 'vue';
import { db } from '@/core/db/schema';
import { logger } from '@/core/logging/logger';
import { isToneId, type ToneId } from '@/core/reminders/chime';

const log = logger.scoped('notification-prefs');
const META_KEY = 'notificationPrefs';

export type ConflictAlert = 'banner' | 'sound' | 'quiet';

export interface NotificationPrefs {
  enabled: boolean;
  due: boolean;
  /** local "HH:MM" a due-date reminder fires on its day */
  dueTime: string;
  social: boolean;
  conflicts: ConflictAlert;
  tone: ToneId;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  due: true,
  dueTime: '09:00',
  social: true,
  conflicts: 'banner',
  tone: 'chime',
};

const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizePrefs(raw: unknown): NotificationPrefs {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<NotificationPrefs>;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_PREFS.enabled,
    due: typeof v.due === 'boolean' ? v.due : DEFAULT_PREFS.due,
    dueTime: typeof v.dueTime === 'string' && VALID_TIME.test(v.dueTime) ? v.dueTime : DEFAULT_PREFS.dueTime,
    social: typeof v.social === 'boolean' ? v.social : DEFAULT_PREFS.social,
    conflicts: v.conflicts === 'sound' || v.conflicts === 'quiet' || v.conflicts === 'banner' ? v.conflicts : DEFAULT_PREFS.conflicts,
    tone: isToneId(v.tone) ? v.tone : DEFAULT_PREFS.tone,
  };
}

const prefs = reactive<NotificationPrefs>({ ...DEFAULT_PREFS });
let loaded: Promise<void> | null = null;
let hydrating = false;

function load(): Promise<void> {
  loaded ??= db.meta
    .get(META_KEY)
    .then((row) => {
      hydrating = true;
      Object.assign(prefs, normalizePrefs(row?.value));
      hydrating = false;
    })
    .catch((e) => log.warn('could not read notification settings', e));
  return loaded;
}

watch(prefs, (v) => {
  if (hydrating) return;
  void db.meta.put({ key: META_KEY, value: { ...v } }).catch((e) => log.warn('could not save notification settings', e));
});

export function useNotificationPrefs() {
  void load();
  // the master switch silences everything under it
  const dueOn = computed(() => prefs.enabled && prefs.due);
  const socialOn = computed(() => prefs.enabled && prefs.social);
  const remindersOn = computed(() => prefs.enabled);
  const conflictAlert = computed<ConflictAlert>(() => (prefs.enabled ? prefs.conflicts : 'quiet'));
  return { prefs, ready: load, dueOn, socialOn, remindersOn, conflictAlert };
}
