-- ============================================================================
-- 0015 — invite by email, and notifications. See design/email-invites-and-notifications.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- An invitation addressed to an email, waiting for that address to have a confirmed account.
-- ----------------------------------------------------------------------------
create table public.email_invites (
  workspace_id text        not null references public.workspaces (id) on delete cascade,
  email        text        not null check (email = lower(email) and length(email) <= 254),
  role         text        not null check (role in ('admin', 'member', 'guest')),
  invited_by   uuid        references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  claimed_at   timestamptz,
  primary key (workspace_id, email)
);

create index email_invites_email_idx on public.email_invites (email) where claimed_at is null;
create index email_invites_inviter_idx on public.email_invites (invited_by, created_at);

-- server-only: no policies, and the default grants from 0001 are taken back
alter table public.email_invites enable row level security;
revoke all on public.email_invites from anon, authenticated;

-- every lookup counts toward the hourly cap, so "already registered" can't be farmed
create table public.email_invite_attempts (
  inviter uuid        not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);

create index email_invite_attempts_idx on public.email_invite_attempts (inviter, at);

alter table public.email_invite_attempts enable row level security;
revoke all on public.email_invite_attempts from anon, authenticated;

-- ----------------------------------------------------------------------------
-- One row per thing worth telling somebody. Written only by the trigger below.
-- ----------------------------------------------------------------------------
create table public.notifications (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  kind         text        not null check (kind in ('invite_received', 'invite_accepted', 'invite_declined')),
  workspace_id text        references public.workspaces (id) on delete cascade,
  actor_name   text        not null default '',
  -- a snapshot, because a declined invitee can no longer read the workspace's name
  workspace_name text      not null default '',
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

create policy notifications_read_own on public.notifications
  for select using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Invite an address that has no account yet. A registered address is refused with
-- 'already_registered' (invite those by name). service_role only: the edge function verifies the caller.
-- ----------------------------------------------------------------------------
create or replace function public.invite_by_email(inviter uuid, ws text, address text, member_role text default 'member')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  addr      text := lower(btrim(coalesce(address, '')));
  previous  timestamptz;
  recent    int;
  ws_name   text;
  from_name text;
begin
  if member_role not in ('admin', 'member', 'guest') then
    return jsonb_build_object('result', 'bad_role');
  end if;

  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(addr) > 254 then
    return jsonb_build_object('result', 'bad_email');
  end if;

  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = inviter and m.membership = 'active' and m.role = 'admin'
  ) then
    return jsonb_build_object('result', 'not_admin');
  end if;

  select count(*) into recent
  from public.email_invite_attempts a
  where a.inviter = invite_by_email.inviter and a.at > now() - interval '1 hour';
  if recent >= 20 then
    return jsonb_build_object('result', 'rate_limited');
  end if;
  insert into public.email_invite_attempts (inviter) values (invite_by_email.inviter);

  if exists (select 1 from auth.users u where lower(u.email) = addr) then
    return jsonb_build_object('result', 'already_registered');
  end if;

  select w.name into ws_name from public.workspaces w where w.id = ws;
  select coalesce(nullif(p.display_name, ''), 'Someone') into from_name
  from public.profiles p where p.user_id = inviter;

  -- the same address within a day is recorded but not emailed again
  select i.created_at into previous
  from public.email_invites i
  where i.workspace_id = ws and i.email = addr and i.claimed_at is null and i.expires_at > now();

  insert into public.email_invites (workspace_id, email, role, invited_by)
  values (ws, addr, member_role, inviter)
  on conflict (workspace_id, email) do update
    set role = excluded.role, invited_by = excluded.invited_by, created_at = now(),
        expires_at = now() + interval '14 days', claimed_at = null;

  return jsonb_build_object(
    'result', 'ok', 'send', previous is null or previous < now() - interval '1 day',
    'workspace_name', coalesce(ws_name, ''), 'inviter_name', coalesce(from_name, 'Someone'));
end;
$$;

revoke execute on function public.invite_by_email(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.invite_by_email(uuid, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- my_invitations now first claims email invites for the caller's CONFIRMED address, so the
-- existing prompt picks them up with no client change.
-- ----------------------------------------------------------------------------
drop function if exists public.my_invitations();

create function public.my_invitations()
returns table (
  workspace_id text,
  workspace_name text,
  member_role text,
  invited_by_name text,
  invited_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  my_email text;
begin
  select lower(u.email) into my_email
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;

  if my_email is not null then
    insert into public.workspace_members (workspace_id, user_id, role, membership, invited_by)
    select i.workspace_id, auth.uid(), i.role, 'pending', i.invited_by
    from public.email_invites i
    where i.email = my_email
      and i.claimed_at is null
      and i.expires_at > now()
      -- the inviter must still be an admin there
      and exists (
        select 1 from public.workspace_members a
        where a.workspace_id = i.workspace_id and a.user_id = i.invited_by
          and a.membership = 'active' and a.role = 'admin'
      )
    on conflict on constraint workspace_members_pkey do update
      set role = excluded.role, membership = 'pending', invited_by = excluded.invited_by, created_at = now()
      where public.workspace_members.membership not in ('active', 'pending');

    update public.email_invites i
    set claimed_at = now()
    where i.email = my_email and i.claimed_at is null;
  end if;

  return query
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
end;
$$;

grant execute on function public.my_invitations() to authenticated;

-- ----------------------------------------------------------------------------
-- Notifications come from membership changes, so every path that invites or answers is covered.
-- ----------------------------------------------------------------------------
create or replace function public.notify_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ws_name text;
begin
  select w.name into ws_name from public.workspaces w where w.id = new.workspace_id;

  if new.membership = 'pending' and (tg_op = 'INSERT' or old.membership is distinct from 'pending') then
    insert into public.notifications (user_id, kind, workspace_id, actor_name, workspace_name)
    select new.user_id, 'invite_received', new.workspace_id,
           coalesce((select nullif(p.display_name, '') from public.profiles p where p.user_id = new.invited_by), 'Someone'),
           coalesce(ws_name, '');
  elsif tg_op = 'UPDATE' and old.membership = 'pending' and new.membership in ('active', 'declined')
        and new.invited_by is not null and new.invited_by <> new.user_id then
    insert into public.notifications (user_id, kind, workspace_id, actor_name, workspace_name)
    select new.invited_by,
           case when new.membership = 'active' then 'invite_accepted' else 'invite_declined' end,
           new.workspace_id,
           coalesce((select nullif(p.display_name, '') from public.profiles p where p.user_id = new.user_id), 'Someone'),
           coalesce(ws_name, '');
  end if;
  return new;
end;
$$;

create trigger workspace_members_notify
  after insert or update of membership on public.workspace_members
  for each row execute function public.notify_membership_change();

-- ----------------------------------------------------------------------------
-- Mark read: all of mine, or just the given ones.
-- ----------------------------------------------------------------------------
create or replace function public.mark_notifications_read(ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hit int;
begin
  update public.notifications n
  set read_at = now()
  where n.user_id = auth.uid() and n.read_at is null and (ids is null or n.id = any (ids));
  get diagnostics hit = row_count;
  return hit;
end;
$$;

grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
