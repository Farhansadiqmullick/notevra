-- ============================================================================
-- 0005 — membership replaces ownership
--
-- The change 0001 said it was leaving for somebody else, quoted here because it also says why this
-- migration is small:
--
--   * Sharing. Every policy above is single-owner. Shared workspaces need a `workspace_members`
--     table and policies that consult it instead of `owner_id` — `owns_workspace()` exists so that
--     change happens in one function rather than in nine policies.
--
-- This is that day, and the promise holds: **not one policy on notes / blocks / tags / note_tags /
-- attachments changes its text.** They call `owns_workspace()` and `owns_note()`; only the bodies of
-- those two functions move from asking "is this row mine?" to asking "am I in this space?".
--
-- ── This migration is meant to change nothing observable ────────────────────────────────────────
-- Every existing workspace gets exactly one member — its owner, as `admin`. For a single account,
-- "the owner of this workspace" and "an active admin member of this workspace" are the same set, so
-- `npm run db:verify` must return the same result it did before this ran. It is the last moment
-- this rewrite can be checked against a known answer: once two people share a space, "nothing
-- changed" stops being the expected outcome and every later bug has somewhere to hide.
--
-- Sharing is not switched on here. Nothing writes a second member row yet; the invitation flow that
-- does is a later migration (design/collaboration-and-sharing.md). What lands here is the shape.
--
-- ── The recursion trap, named rather than survived by luck ──────────────────────────────────────
-- A policy ON workspace_members that calls a helper which READS workspace_members would re-enter
-- the same policy and never terminate. Every helper below is SECURITY DEFINER, which suspends RLS
-- inside it, so the read completes without consulting the policy that called it. This is the same
-- reasoning 0001 wrote down for `owns_workspace` reading `workspaces`; it matters more here,
-- because the table and the policy are now the same table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The join table.
--
-- One row per (space, person). The composite primary key is the many-to-many: a person appears in a
-- space at most once, which makes "add them twice" a database error rather than a UI rule somebody
-- has to remember. It also indexes `workspace_id` for free as its leftmost column, which answers
-- "who is in this space?".
--
-- The other direction — "which spaces am I in?" — is the one every policy check runs, on every
-- request, and the primary key cannot serve it. Hence the explicit index on `user_id`. Without it
-- each policy check is a sequential scan of the whole table, and 0001 already recorded that an
-- unindexed foreign key is what turns a policy into a table scan.
-- ----------------------------------------------------------------------------
create table public.workspace_members (
  workspace_id text not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id)        on delete cascade,

  -- admin  — full control: invite, revoke, change roles, delete the space.
  -- member — writes everything inside pages; cannot destroy a page or the space.
  -- guest  — reads. The read/write split this implies is NOT enforced yet: `owns_workspace()`
  --          below still answers one question for both. Splitting it is a later migration, and
  --          doing it here would be a behaviour change in a migration whose whole value is that it
  --          has none. The column accepts the value now so no data has to move later.
  role       text not null default 'member' check (role in ('admin', 'member', 'guest')),

  -- Leaving does not delete the row. Re-granting is then a flip back to 'active' that restores the
  -- person's prior state, rather than a new membership that has forgotten it — and the row is the
  -- only record that they were ever here.
  membership text not null default 'active' check (membership in ('active', 'left', 'removed')),

  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);

-- ----------------------------------------------------------------------------
-- Helpers. Every one is SECURITY DEFINER with a pinned search_path — see the header.
-- ----------------------------------------------------------------------------

/** Am I in this space, and still in it? The question all read access reduces to. */
create or replace function public.is_member(ws text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.membership = 'active'
  );
$$;

/** May I invite, revoke, change roles, destroy? One role, deliberately: see the doc's §1 table. */
create or replace function public.is_workspace_admin(ws text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.membership = 'active'
      and m.role = 'admin'
  );
$$;

-- ----------------------------------------------------------------------------
-- The swap. Same signatures, same names, same call sites — different question.
-- ----------------------------------------------------------------------------

create or replace function public.owns_workspace(ws text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.is_member(ws);
$$;

create or replace function public.owns_note(n text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.notes nt
    join public.workspace_members m on m.workspace_id = nt.workspace_id
    where nt.id = n
      and m.user_id = auth.uid()
      and m.membership = 'active'
  );
$$;

-- ----------------------------------------------------------------------------
-- Every workspace gets its creator as an admin, at the moment it is created.
--
-- Without this there is a chicken-and-egg the first INSERT cannot escape: the workspaces policy
-- wants you to be a member, and you become a member by having created the workspace. A trigger is
-- the right place for it rather than the application, because `sync_push` inserts workspaces too —
-- putting it in the client would mean a row pushed from a device that skipped the call arrives with
-- no members and is immediately invisible to the person who made it.
--
-- SECURITY DEFINER for the same reason as the helpers: it writes a workspace_members row on behalf
-- of a caller whose policy has not yet been satisfied.
-- ----------------------------------------------------------------------------
create or replace function public.add_creator_as_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role, membership)
  values (new.id, new.owner_id, 'admin', 'active')
  on conflict (workspace_id, user_id) do nothing;
  return new;
end;
$$;

create trigger workspaces_add_creator
  after insert on public.workspaces
  for each row execute function public.add_creator_as_admin();

-- ----------------------------------------------------------------------------
-- Backfill. One admin row per workspace that already exists.
--
-- This is what makes the migration a no-op rather than a lockout: run without it, every existing
-- row in the database becomes unreadable to the account that owns it the instant `owns_workspace`
-- starts asking about membership.
-- ----------------------------------------------------------------------------
insert into public.workspace_members (workspace_id, user_id, role, membership)
select w.id, w.owner_id, 'admin', 'active'
from public.workspaces w
on conflict (workspace_id, user_id) do nothing;

-- ----------------------------------------------------------------------------
-- The workspaces policy itself.
--
-- Read follows membership so a space you were invited into is visible at all. Write stays with
-- admins, and the INSERT half must keep testing `owner_id` rather than membership: at INSERT time
-- the trigger above has not fired yet, so there is no membership row to find and a membership-only
-- check would refuse every create.
-- ----------------------------------------------------------------------------
drop policy workspaces_rw on public.workspaces;

create policy workspaces_read on public.workspaces
  for select using (public.is_member(id));

create policy workspaces_insert on public.workspaces
  for insert with check (owner_id = auth.uid());

create policy workspaces_update on public.workspaces
  for update using (public.is_workspace_admin(id)) with check (public.is_workspace_admin(id));

create policy workspaces_delete on public.workspaces
  for delete using (public.is_workspace_admin(id));

-- ----------------------------------------------------------------------------
-- RLS on the join table.
--
-- Members see who else is in a space they are in — that is the member list the app renders, and it
-- is not a leak: they can already read everything in the space. Only admins change it.
--
-- `is_member`/`is_workspace_admin` are safe to call here despite reading this very table: see the
-- recursion note in the header.
-- ----------------------------------------------------------------------------
alter table public.workspace_members enable row level security;

create policy workspace_members_read on public.workspace_members
  for select using (public.is_member(workspace_id));

create policy workspace_members_write on public.workspace_members
  for all using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

-- Leaving is yours alone: a member may delete their own row without being an admin. Being able to
-- leave a space is not a privilege an administrator grants.
create policy workspace_members_leave on public.workspace_members
  for delete using (user_id = auth.uid());

grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.workspace_members to service_role;
-- `anon` is granted nothing, deliberately — the same rule as every other table in this schema.
