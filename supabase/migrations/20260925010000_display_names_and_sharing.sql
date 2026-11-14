-- ============================================================================
-- 0008 — every account has a name, the name is unique, and an admin can share by it
--
-- design/display-names-and-sharing.md has the reasoning. The short version: the Share dialog has to
-- name a person, so `display_name` stops being optional and starts being unique — enforced here
-- rather than in the signup form, because the seeder and every future flow bypass the form.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Names that are already in use lose their duplicates before the index goes on.
-- A blank name is not a duplicate of another blank name, hence the partial index.
-- ----------------------------------------------------------------------------
with dupes as (
  select user_id,
         row_number() over (partition by lower(display_name) order by updated_at, user_id) as n
  from public.profiles
  where display_name <> ''
)
update public.profiles p
set display_name = p.display_name || ' ' || d.n
from dupes d
where d.user_id = p.user_id and d.n > 1;

create unique index profiles_display_name_key
  on public.profiles (lower(display_name))
  where display_name <> '';

-- ----------------------------------------------------------------------------
-- Is this name free? Callable by anon, because the person asking has not signed up yet.
--
-- One boolean. No id, no email, no list, no prefix match — the narrowest form of the question that
-- can still answer it. See the doc for why this oracle is accepted here and refused for emails.
-- ----------------------------------------------------------------------------
create or replace function public.display_name_available(name text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select btrim(coalesce(name, '')) <> ''
     and not exists (
       select 1 from public.profiles
       where lower(display_name) = lower(btrim(name))
     );
$$;

grant execute on function public.display_name_available(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- The free name nearest the one asked for: `Milo Member` → `Milo Member 2` → `Milo Member 3`.
-- ----------------------------------------------------------------------------
create or replace function public.suggest_display_name(base text)
returns text
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  root text := nullif(btrim(coalesce(base, '')), '');
  try  text;
  n    int := 1;
begin
  if root is null then root := 'Someone'; end if;
  try := root;
  while exists (select 1 from public.profiles where lower(display_name) = lower(try)) loop
    n := n + 1;
    try := root || ' ' || n;
  end loop;
  return try;
end;
$$;

grant execute on function public.suggest_display_name(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Every new account gets a profile row with a unique name, whatever created the account.
--
-- The name comes from signup metadata; failing that, from the email's local part. Uniquified in the
-- same transaction as the insert, so two accounts racing on one name cannot both win.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    public.suggest_display_name(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
        split_part(coalesce(new.email, ''), '@', 1)
      )
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- existing accounts that never set a name get one now, so "everyone has a name" is true of the
-- rows already here and not only of the ones created next
insert into public.profiles (user_id, display_name)
select u.id, public.suggest_display_name(split_part(coalesce(u.email, ''), '@', 1))
from auth.users u
where not exists (select 1 from public.profiles p where p.user_id = u.id)
on conflict (user_id) do nothing;

update public.profiles p
set display_name = public.suggest_display_name(split_part(coalesce(u.email, ''), '@', 1))
from auth.users u
where u.id = p.user_id and p.display_name = '';

-- ----------------------------------------------------------------------------
-- Share a workspace with someone, by their display name.
--
-- The admin check is INSIDE this function, before the lookup, so name→id resolution is reachable
-- only by someone who already administers a shared space. A bare public lookup would hand out the
-- identifier every other table is keyed by.
--
-- Returns a status rather than raising: four of the five outcomes are ordinary form results.
-- ----------------------------------------------------------------------------
-- the parameters are `member_name` / `member_role`, not `display_name` / `role`: a parameter sharing
-- a name with a column in the same query is ambiguous, and Postgres refuses it at call time
create or replace function public.share_workspace(ws text, member_name text, member_role text default 'member')
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid;
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

  -- a row that exists as 'left' or 'removed' is revived rather than duplicated: the composite
  -- primary key means there is only ever one row per (space, person)
  if exists (select 1 from public.workspace_members m
             where m.workspace_id = ws and m.user_id = target and m.membership = 'active') then
    return 'already_member';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, membership, invited_by)
  values (ws, target, member_role, 'active', auth.uid())
  on conflict (workspace_id, user_id) do update
    set role = excluded.role, membership = 'active', invited_by = excluded.invited_by;

  return 'ok';
end;
$$;

grant execute on function public.share_workspace(text, text, text) to authenticated;
