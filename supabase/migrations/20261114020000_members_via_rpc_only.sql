-- 0019 — membership rows are written only through RPCs, so nobody joins without accepting. See docs/security-review.md #2.

create or replace function public.remove_member(ws text, target uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  their_role text;
  admins     int;
begin
  if not public.is_workspace_admin(ws) then
    return 'not_admin';
  end if;

  select m.role into their_role
  from public.workspace_members m
  where m.workspace_id = ws and m.user_id = target and m.membership = 'active';

  if their_role is null then
    return 'not_a_member';
  end if;

  -- same rule as leave_workspace: a space must keep one admin
  if their_role = 'admin' then
    select count(*) into admins
    from public.workspace_members m
    where m.workspace_id = ws and m.membership = 'active' and m.role = 'admin';
    if admins <= 1 then
      return 'last_admin';
    end if;
  end if;

  update public.workspace_members
  set membership = 'removed'
  where workspace_id = ws and user_id = target;

  return 'removed';
end;
$$;

revoke execute on function public.remove_member(text, uuid) from public, anon;
grant execute on function public.remove_member(text, uuid) to authenticated;

-- the direct-write door: share_workspace, respond_to_invitation, leave_workspace and remove_member replace it
drop policy workspace_members_write on public.workspace_members;
