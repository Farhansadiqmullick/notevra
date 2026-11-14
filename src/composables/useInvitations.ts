/**
 * useInvitations — the invitations waiting for an answer, and the answer.
 *
 * A pending row in `workspace_members` grants nothing: `is_member()` tests `membership = 'active'`,
 * so until you accept, no policy anywhere lets the space through. That is why this reads through
 * `my_invitations()` rather than the table — the invitee cannot see the workspace's name or the
 * inviter's profile, because they are not a member yet.
 */
import { ref } from 'vue';
import { isAuthConfigured, supabase } from '@/core/auth/supabase';
import { logger } from '@/core/logging/logger';

const log = logger.scoped('invitations');

export interface Invitation {
  workspaceId: string;
  workspaceName: string;
  role: string;
  invitedByName: string;
  invitedAt: string;
}

export function useInvitations() {
  const invitations = ref<Invitation[]>([]);
  const loading = ref(false);
  const answering = ref<string | null>(null);

  async function refresh(): Promise<void> {
    if (!isAuthConfigured || !supabase) return;
    loading.value = true;
    try {
      const { data, error } = await supabase.rpc('my_invitations');
      if (error) return log.warn('could not read invitations', { detail: error.message });
      invitations.value = (data ?? []).map(
        (r: {
          workspace_id: string;
          workspace_name: string;
          member_role: string;
          invited_by_name: string;
          invited_at: string;
        }) => ({
          workspaceId: r.workspace_id,
          workspaceName: r.workspace_name,
          role: r.member_role,
          invitedByName: r.invited_by_name,
          invitedAt: r.invited_at,
        }),
      );
    } catch (e) {
      log.warn('invitation lookup failed', e);
    } finally {
      loading.value = false;
    }
  }

  /** true when the answer landed; the row leaves the list either way */
  async function respond(workspaceId: string, accept: boolean): Promise<boolean> {
    if (!supabase) return false;
    answering.value = workspaceId;
    const { data, error } = await supabase.rpc('respond_to_invitation', { ws: workspaceId, accept });
    answering.value = null;
    if (error) {
      log.warn('could not answer', { detail: error.message });
      return false;
    }
    invitations.value = invitations.value.filter((i) => i.workspaceId !== workspaceId);
    return data === 'accepted' || data === 'declined';
  }

  return { invitations, loading, answering, refresh, respond };
}
