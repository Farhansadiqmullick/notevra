-- ============================================================================
-- 0007 — a person you share a space with has a name
--
-- Until now `profiles_rw` was `user_id = auth.uid()`: every account could read exactly one profile,
-- its own. That is why the assignee dropdown shipped with three invented people — there was no way
-- for the client to learn any real name, so it had to make some up.
--
-- Read widens to "we are in a space together". Write does not move: your profile stays yours alone.
--
-- `profiles` still has NO email column, so this does not become a directory. Sharing a space is the
-- only thing that reveals a name, and you cannot join a space without being let in.
-- ============================================================================

-- SECURITY DEFINER for the reason 0005 gives: it reads workspace_members, and the caller's own
-- access to that table must not decide whether the lookup completes.
create or replace function public.shares_a_workspace(other uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid()
      and mine.membership = 'active'
      and theirs.user_id = other
      and theirs.membership = 'active'
  );
$$;

drop policy profiles_rw on public.profiles;

create policy profiles_read on public.profiles
  for select using (user_id = auth.uid() or public.shares_a_workspace(user_id));

-- unchanged in effect: a profile is written by the account it belongs to, and by nobody else
create policy profiles_write on public.profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
