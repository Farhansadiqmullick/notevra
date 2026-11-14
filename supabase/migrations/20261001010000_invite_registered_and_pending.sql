-- ============================================================================
-- 0016 — a registered email is invited in-app; admins can list and cancel pending invites.
-- See design/email-invites-and-notifications.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Same checks as 0015. A confirmed account now gets a pending membership ('invited', no email);
-- only an address with no account is emailed ('ok').
-- ----------------------------------------------------------------------------
create or replace function public.invite_by_email(inviter uuid, ws text, address text, member_role text default 'member')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  addr      text := lower(btrim(coalesce(address, '')));
  target    uuid;
  confirmed boolean;
  state     text;
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

  select u.id, u.email_confirmed_at is not null into target, confirmed
  from auth.users u
  where lower(u.email) = addr;

  if target is not null and confirmed then
    select m.membership into state
    from public.workspace_members m
    where m.workspace_id = ws and m.user_id = target;

    if state = 'active' then
      return jsonb_build_object('result', 'already_member');
    elsif state = 'pending' then
      return jsonb_build_object('result', 'already_invited');
    end if;

    insert into public.workspace_members (workspace_id, user_id, role, membership, invited_by)
    values (ws, target, member_role, 'pending', inviter)
    on conflict (workspace_id, user_id) do update
      set role = excluded.role, membership = 'pending', invited_by = excluded.invited_by, created_at = now();

    return jsonb_build_object('result', 'invited', 'send', false);
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

  -- an account that exists but never confirmed claims this once it confirms; a sign-up link would only confuse it
  if target is not null then
    return jsonb_build_object('result', 'ok', 'send', false);
  end if;

  return jsonb_build_object(
    'result', 'ok', 'send', previous is null or previous < now() - interval '1 day',
    'workspace_name', coalesce(ws_name, ''), 'inviter_name', coalesce(from_name, 'Someone'));
end;
$$;

revoke execute on function public.invite_by_email(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.invite_by_email(uuid, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- Everyone still waiting to answer, for the Share dialog. Admins only; others get no rows.
-- ----------------------------------------------------------------------------
create or replace function public.pending_invites(ws text)
returns table (
  user_id uuid,
  email text,
  display_name text,
  member_role text,
  invited_at timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select m.user_id, null::text, coalesce(nullif(p.display_name, ''), 'Someone'), m.role, m.created_at
  from public.workspace_members m
  left join public.profiles p on p.user_id = m.user_id
  where m.workspace_id = ws and m.membership = 'pending' and public.is_workspace_admin(ws)
  union all
  select null::uuid, i.email, null::text, i.role, i.created_at
  from public.email_invites i
  where i.workspace_id = ws and i.claimed_at is null and i.expires_at > now() and public.is_workspace_admin(ws)
  order by 5 desc;
$$;

grant execute on function public.pending_invites(text) to authenticated;

-- ----------------------------------------------------------------------------
-- Cancel one: by account (pending → removed) or by address (row deleted).
-- ----------------------------------------------------------------------------
create or replace function public.cancel_invite(ws text, target uuid default null, address text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hit int := 0;
begin
  if not public.is_workspace_admin(ws) then
    return 'not_admin';
  end if;

  if target is not null then
    update public.workspace_members
    set membership = 'removed'
    where workspace_id = ws and user_id = target and membership = 'pending';
    get diagnostics hit = row_count;
    -- their bell should not keep pointing at an invitation that no longer exists
    delete from public.notifications n
    where n.user_id = target and n.workspace_id = ws and n.kind = 'invite_received';
  elsif address is not null then
    delete from public.email_invites
    where workspace_id = ws and email = lower(btrim(address)) and claimed_at is null;
    get diagnostics hit = row_count;
  end if;

  return case when hit > 0 then 'cancelled' else 'no_invitation' end;
end;
$$;

grant execute on function public.cancel_invite(text, uuid, text) to authenticated;
