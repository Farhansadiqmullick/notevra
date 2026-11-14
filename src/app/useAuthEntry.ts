// Restores the session and opens auth on its own for a reset link or an invite; nothing here gates the app.
import { watch } from 'vue';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { useNotesStore } from '@/stores/notes.store';
import { loadMyRoles } from '@/core/sync/roles';

export function useAuthEntry() {
  const auth = useAuthStore();
  const ui = useUiStore();
  const notesStore = useNotesStore();

  auth.init();
  // a password-reset link lands as a recovery session, which needs "set a new password" opened for it
  watch(
    () => auth.recovering,
    (yes: boolean) => yes && ui.openAuth('reset'),
    { immediate: true },
  );

  // My role per project comes from the server; re-read when projects arrive or a pull drops the role.
  watch(
    () => [auth.user?.id, notesStore.workspaces.map((w) => `${w.id}:${w.role ?? ''}`).join(',')] as const,
    ([id]) => void loadMyRoles(id),
    { immediate: true },
  );

  // An invite email lands here with ?invite=signup&email=…; open sign-up once we know nobody is signed in.
  const inviteQuery = new URLSearchParams(location.search);
  const fromInvite = inviteQuery.get('invite') === 'signup';
  const inviteEmail = fromInvite ? (inviteQuery.get('email') ?? '') : '';
  if (inviteQuery.has('invite')) {
    inviteQuery.delete('invite');
    inviteQuery.delete('email');
    const rest = inviteQuery.toString();
    history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  }
  watch(
    () => auth.ready,
    (ready: boolean) => ready && fromInvite && !auth.signedIn && ui.openAuth('signup'),
    { immediate: true },
  );

  return { inviteEmail };
}
