-- ============================================================================
-- 0010 — nobody joins a space without saying yes
--
-- 0008 shipped sharing as a direct insert: an admin typed your name and the project simply appeared
-- on your next sync. That contradicts the rule design/collaboration-and-sharing.md §1 rests on —
-- you cannot be added to a space by somebody else's decision alone — and it was recorded as a
-- deliberate debt. This pays it.
--
-- ── Why this is not an `invitations` table ──────────────────────────────────────────────────────
-- The design doc named one. `workspace_members` already IS that table: it has a row per (space,
-- person), a composite primary key that makes a duplicate invite a database error, and a
-- `membership` column whose whole job is which state that pairing is in. Adding 'pending' and
-- 'declined' to it keeps ONE answer to "what is this person to this space".
--
-- A separate table would mean two places to ask, and a window where both have a row — which is
-- exactly the bug class that makes invitation flows leak access.
--
-- ── Why pending needs no policy changes ─────────────────────────────────────────────────────────
-- `is_member()` and `is_workspace_admin()` both test `membership = 'active'`. A pending row
-- therefore grants nothing, anywhere, through any policy — no notes, no blocks, no sync_pull. The
-- access rule did not have to learn about invitations at all, which is the whole reason this shape
-- was worth choosing.
-- ============================================================================

alter table public.workspace_members drop constraint workspace_members_membership_check;
alter table public.workspace_members add constraint workspace_members_membership_check
  check (membership in ('pending', 'active', 'declined', 'left', 'removed'));

-- ----------------------------------------------------------------------------
-- You can always see your own rows — including the pending one you have not answered yet.
--
-- Without this an invitee cannot read the invitation addressed to them: `workspace_members_read`
-- is gated on `is_member()`, which a pending person is not.
-- ----------------------------------------------------------------------------
create policy workspace_members_read_own on public.workspace_members
  for select using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Sharing now INVITES. Same checks, same statuses, one changed word — plus 'already_invited', so
-- an admin who shares twice is told the invitation is waiting rather than that nothing happened.
-- ----------------------------------------------------------------------------
create or replace function public.share_workspace(ws text, member_name text, member_role text default 'member')
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid;
  state  text;
begin
  if member_role not in ('admin', 'member', 'guest') then
    return 'bad_role';
  end if;

  if not public.is_workspace_admin(ws) then
    return 'not_admin';
  end if;

  select p.user_id into target
  from public.profiles p
  where lower(p.display_name) = lower(btrim(coalesce(member_name, '')));

  if target is null then
    return 'not_found';
  end if;

  select m.membership into state
  from public.workspace_members m
  where m.workspace_id = ws and m.user_id = target;

  if state = 'active' then
    return 'already_member';
  elsif state = 'pending' then
    return 'already_invited';
  end if;

  -- a declined, left or removed row is re-invited rather than duplicated: one row per pairing
  insert into public.workspace_members (workspace_id, user_id, role, membership, invited_by)
  values (ws, target, member_role, 'pending', auth.uid())
  on conflict (workspace_id, user_id) do update
    set role = excluded.role, membership = 'pending', invited_by = excluded.invited_by,
        created_at = now();

  return 'ok';
end;
$$;

-- ----------------------------------------------------------------------------
-- What am I being asked to join?
--
-- An RPC because neither half is reachable through RLS: the invitee is not a member, so they
-- cannot read the workspace row for its name, nor the inviter's profile for theirs. Returns only
-- what the prompt has to say, for invitations addressed to the caller.
-- ----------------------------------------------------------------------------
create or replace function public.my_invitations()
returns table (
  workspace_id text,
  workspace_name text,
  member_role text,
  invited_by_name text,
  invited_at timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select m.workspace_id,
         w.name,
         m.role,
         coalesce(p.display_name, 'Someone'),
         m.created_at
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  left join public.profiles p on p.user_id = m.invited_by
  where m.user_id = auth.uid()
    and m.membership = 'pending'
  order by m.created_at desc;
$$;

grant execute on function public.my_invitations() to authenticated;

-- ----------------------------------------------------------------------------
-- Yes or no.
--
-- An RPC rather than an update policy on the row. A policy permissive enough to let you flip your
-- own `membership` would also let you flip your own `role` in the same statement — accepting an
-- invitation as a member and arriving as an admin. This function writes one column, and only from
-- 'pending', so answering twice is a no-op rather than a way back in after being removed.
-- ----------------------------------------------------------------------------
create or replace function public.respond_to_invitation(ws text, accept boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hit int;
begin
  update public.workspace_members
  set membership = case when accept then 'active' else 'declined' end
  where workspace_id = ws
    and user_id = auth.uid()
    and membership = 'pending';

  get diagnostics hit = row_count;
  if hit = 0 then
    return 'no_invitation';
  end if;
  return case when accept then 'accepted' else 'declined' end;
end;
$$;

grant execute on function public.respond_to_invitation(text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Leave a space you are in. The other half of consent, and the one that was missing entirely:
-- the server permitted it, nothing in the app called it.
--
-- 'left' rather than a delete, for the reason 0005 gives — a re-invite restores what you were,
-- and the row is the only record that you were ever here. An admin cannot leave their own space
-- while they are its only admin, or it becomes unadministrable.
-- ----------------------------------------------------------------------------
create or replace function public.leave_workspace(ws text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  mine text;
  admins int;
begin
  select m.role into mine
  from public.workspace_members m
  where m.workspace_id = ws and m.user_id = auth.uid() and m.membership = 'active';

  if mine is null then
    return 'not_a_member';
  end if;

  if mine = 'admin' then
    select count(*) into admins
    from public.workspace_members m
    where m.workspace_id = ws and m.membership = 'active' and m.role = 'admin';
    if admins <= 1 then
      return 'last_admin';
    end if;
  end if;

  update public.workspace_members
  set membership = 'left'
  where workspace_id = ws and user_id = auth.uid();

  return 'left';
end;
$$;

grant execute on function public.leave_workspace(text) to authenticated;
