-- 0018 — only someone who can write a space can add to its sync log. See docs/security-review.md #1.

-- The space always comes from the entity itself; a caller-supplied workspace_id is overwritten.
create or replace function public.sync_ops_stamp_workspace()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.workspace_id := case new.entity
    when 'workspace' then new.entity_id
    when 'note'      then (select n.workspace_id from public.notes n where n.id = new.entity_id)
    when 'block'     then (select n.workspace_id
                           from public.blocks b
                           join public.notes n on n.id = b.note_id
                           where b.id = new.entity_id)
    else null
  end;
  return new;
end;
$$;

-- WITH CHECK sees the row after the BEFORE trigger above, so it tests the stamped space.
drop policy sync_ops_insert on public.sync_ops;

create policy sync_ops_insert on public.sync_ops
  for insert with check (
    actor_id = auth.uid()
    and workspace_id is not null
    and public.can_write_workspace(workspace_id)
  );
