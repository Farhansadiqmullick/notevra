// Server-side notifications (invites and their answers), polled while signed in. Shared across callers.
import { computed, ref, watch } from 'vue';
import { isAuthConfigured, supabase } from '@/core/auth/supabase';
import { useAuthStore } from '@/stores/auth.store';
import { logger } from '@/core/logging/logger';
import { useNotificationPrefs } from './useNotificationPrefs';

const log = logger.scoped('notifications');

export type NotificationKind = 'invite_received' | 'invite_accepted' | 'invite_declined';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  workspaceId: string | null;
  actorName: string;
  workspaceName: string;
  at: number;
  read: boolean;
}

const POLL_MS = 60_000;
const LIMIT = 30;

const items = ref<AppNotification[]>([]);
const unread = computed(() => items.value.filter((n) => !n.read).length);
let started = false;
let timer: ReturnType<typeof setInterval> | undefined;

export function describe(n: AppNotification): string {
  const project = n.workspaceName || 'a project';
  if (n.kind === 'invite_received') return `${n.actorName} invited you to ${project}`;
  if (n.kind === 'invite_accepted') return `${n.actorName} accepted your invitation to ${project}`;
  return `${n.actorName} declined your invitation to ${project}`;
}

async function refresh(): Promise<void> {
  if (!isAuthConfigured || !supabase || !useNotificationPrefs().socialOn.value) return;
  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, workspace_id, actor_name, workspace_name, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) return log.warn('could not read notifications', { detail: error.message });
  items.value = (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as NotificationKind,
    workspaceId: (r.workspace_id as string | null) ?? null,
    actorName: (r.actor_name as string) || 'Someone',
    workspaceName: (r.workspace_name as string) ?? '',
    at: Date.parse(r.created_at as string),
    read: r.read_at != null,
  }));
}

async function markAllRead(): Promise<void> {
  if (!supabase || !unread.value) return;
  items.value = items.value.map((n) => ({ ...n, read: true }));
  const { error } = await supabase.rpc('mark_notifications_read', { ids: null });
  if (error) log.warn('could not mark notifications read', { detail: error.message });
}

function onVisible() {
  if (document.visibilityState === 'visible' && useNotificationPrefs().socialOn.value) void refresh();
}

function start(signedIn: () => boolean) {
  if (started || !isAuthConfigured) return;
  started = true;
  const auth = useAuthStore();
  const { socialOn } = useNotificationPrefs();
  watch(
    () => [auth.user?.id, socialOn.value] as const,
    async ([id, on], before) => {
      clearInterval(timer);
      items.value = [];
      if (!id || !signedIn() || !on) return;
      // switched back on: what arrived while off is history, not news
      if (before && before[0] === id && !before[1]) {
        const { error } = await supabase!.rpc('mark_notifications_read', { ids: null });
        if (error) log.warn('could not mark notifications read', { detail: error.message });
      }
      void refresh();
      timer = setInterval(() => void refresh(), POLL_MS);
    },
    { immediate: true },
  );
  document.addEventListener('visibilitychange', onVisible);
}

export function useNotifications() {
  const auth = useAuthStore();
  start(() => auth.signedIn);
  return { items, unread, refresh, markAllRead, socialOn: useNotificationPrefs().socialOn };
}
