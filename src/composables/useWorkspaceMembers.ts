/**
 * useWorkspaceMembers — who is actually in this space: the Owner/Assignee pickers and the Share
 * dialog both read it, and sharing writes through it.
 *
 * This replaced three invented people that both properties panels carried. They existed because
 * `profiles` was readable only by its own owner, so no real name could reach the client; migration
 * 0007 widened that to people you share a space with, and 0008 made the names unique.
 *
 * Read from the SERVER, not from Dexie: `role` and `membership` are not in `CONTENT_FIELDS`, so
 * nothing about who-is-in-a-space ever syncs down. That also means this is empty while offline.
 */
import { ref, watch, type Ref } from 'vue';
import { isAuthConfigured, supabase } from '@/core/auth/supabase';
import { initialsOf } from '@/stores/profile.store';
import { logger } from '@/core/logging/logger';
import { useAuthStore } from '@/stores/auth.store';

const log = logger.scoped('members');

export interface Member {
  id: string;
  name: string;
  initials: string;
  role: string;
  isMe: boolean;
}

/** shortest search that is allowed to run — the same floor `search_members` enforces */
export const MIN_SEARCH = 3;

/** what `share_workspace` can answer; anything else is a transport failure */
export type ShareOutcome =
  | 'ok'
  | 'not_found'
  | 'already_member'
  | 'already_invited'
  | 'not_admin'
  | 'bad_role'
  | 'failed';

/** what the send-invite function can answer; anything else is a transport failure */
export type EmailInviteOutcome =
  | 'sent'
  | 'invited'
  | 'already_member'
  | 'already_invited'
  | 'bad_email'
  | 'not_admin'
  | 'rate_limited'
  | 'bad_role'
  | 'failed';

export const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

/** someone invited who hasn't answered: an account (userId) or an address with no account yet (email) */
export interface PendingInvite {
  key: string;
  userId: string | null;
  email: string | null;
  label: string;
  role: string;
}

export function useWorkspaceMembers(workspaceId: Ref<string | undefined>) {
  const auth = useAuthStore();
  const members = ref<Member[]>([]);
  const pending = ref<PendingInvite[]>([]);
  const loading = ref(false);
  /** my own role in this space, or null when I am not in it / it is not knowable */
  const myRole = ref<string | null>(null);

  // empty for non-admins: pending_invites returns no rows to them
  async function loadPending(ws: string | undefined): Promise<void> {
    if (!ws || !supabase) return void (pending.value = []);
    const { data, error } = await supabase.rpc('pending_invites', { ws });
    if (error) return log.warn('could not read pending invites', { detail: error.message });
    pending.value = (data ?? []).map(
      (r: { user_id: string | null; email: string | null; display_name: string | null; member_role: string }) => ({
        key: r.user_id ?? `email:${r.email}`,
        userId: r.user_id,
        email: r.email,
        label: r.display_name ?? r.email ?? '',
        role: r.member_role,
      }),
    );
  }

  async function cancelInvite(p: PendingInvite): Promise<boolean> {
    const ws = workspaceId.value;
    if (!ws || !supabase) return false;
    const { data, error } = await supabase.rpc('cancel_invite', {
      ws,
      target: p.userId,
      address: p.userId ? null : p.email,
    });
    if (error) {
      log.warn('cancel invite failed', { detail: error.message });
      return false;
    }
    await loadPending(ws);
    return data === 'cancelled';
  }

  async function load(ws: string | undefined): Promise<void> {
    members.value = [];
    myRole.value = null;
    if (!ws || !isAuthConfigured || !supabase) return;

    loading.value = true;
    try {
      const { data: rows, error } = await supabase
        .from('workspace_members')
        .select('user_id, role')
        .eq('workspace_id', ws)
        .eq('membership', 'active');
      if (error) return log.warn('could not read the member list', { detail: error.message });
      if (!rows?.length) return;

      // two round trips: workspace_members references auth.users, not profiles, so PostgREST has no
      // foreign key to embed across
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', rows.map((r) => r.user_id));
      if (pErr) return log.warn('could not read member profiles', { detail: pErr.message });

      const me = auth.user?.id;
      const nameOf = new Map((profiles ?? []).map((p) => [p.user_id, (p.display_name ?? '').trim()]));
      members.value = rows
        .map((r) => {
          const name = nameOf.get(r.user_id) ?? '';
          return { id: r.user_id, name, initials: initialsOf(name), role: r.role as string, isMe: r.user_id === me };
        })
        .filter((m) => m.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      myRole.value = rows.find((r) => r.user_id === me)?.role ?? null;
    } catch (e) {
      log.warn('member lookup failed', e);
    } finally {
      loading.value = false;
    }
  }

  const reload = () => load(workspaceId.value);

  /**
   * Find people by part of their name. Returns nothing for a non-admin and for fewer than 3
   * characters — both rules are the function's, and repeated here only to save a round trip.
   */
  async function search(q: string): Promise<Array<{ id: string; name: string; already: boolean }>> {
    const ws = workspaceId.value;
    const term = q.trim();
    if (!ws || !supabase || term.length < MIN_SEARCH) return [];
    const { data, error } = await supabase.rpc('search_members', { ws, q: term });
    if (error) {
      log.warn('search failed', { detail: error.message });
      return [];
    }
    return (data ?? []).map((r: { user_id: string; display_name: string; already: boolean }) => ({
      id: r.user_id,
      name: r.display_name,
      already: r.already,
    }));
  }

  /** Add someone by display name. The admin check lives in the function, not here. */
  async function share(name: string, role: string): Promise<ShareOutcome> {
    const ws = workspaceId.value;
    if (!ws || !supabase) return 'failed';
    const { data, error } = await supabase.rpc('share_workspace', {
      ws,
      member_name: name.trim(),
      member_role: role,
    });
    if (error) {
      log.warn('share failed', { detail: error.message });
      return 'failed';
    }
    if (data === 'ok') await loadPending(ws);
    return (data as ShareOutcome) ?? 'failed';
  }

  async function inviteByEmail(email: string, role: string): Promise<EmailInviteOutcome> {
    const ws = workspaceId.value;
    if (!ws || !supabase) return 'failed';
    const { data, error } = await supabase.functions.invoke('send-invite', {
      body: { workspaceId: ws, email: email.trim(), role },
    });
    if (!error) {
      if (data?.result === 'sent' || data?.result === 'invited') {
        await loadPending(ws);
        return data.result;
      }
      return 'failed';
    }
    // a refusal arrives as a non-2xx; its body still names the reason
    try {
      const body = await (error as { context?: Response }).context?.json();
      const known = ['already_member', 'already_invited', 'bad_email', 'not_admin', 'rate_limited', 'bad_role'];
      if (known.includes(body?.result)) return body.result;
    } catch {
      /* not JSON — a transport failure */
    }
    log.warn('email invite failed', { detail: error.message });
    return 'failed';
  }

  /** Leave a space. Refuses for the last admin — see `leave_workspace`. */
  async function leave(): Promise<string> {
    const ws = workspaceId.value;
    if (!ws || !supabase) return 'failed';
    const { data, error } = await supabase.rpc('leave_workspace', { ws });
    if (error) {
      log.warn('leave failed', { detail: error.message });
      return 'failed';
    }
    if (data === 'left') await reload();
    return data as string;
  }

  /** Remove someone. `remove_member` checks the caller is an admin and keeps the last admin. */
  async function remove(userId: string): Promise<boolean> {
    const ws = workspaceId.value;
    if (!ws || !supabase) return false;
    const { data, error } = await supabase.rpc('remove_member', { ws, target: userId });
    if (error || data !== 'removed') {
      log.warn('remove failed', { detail: error?.message ?? data });
      return false;
    }
    await reload();
    return true;
  }

  watch(
    workspaceId,
    (ws) => {
      void load(ws);
      void loadPending(ws);
    },
    { immediate: true },
  );

  return { members, pending, loading, myRole, reload, search, share, inviteByEmail, cancelInvite, remove, leave };
}
