-- ============================================================================
-- 0011 — roles are enforced: guest reads, member writes inside pages, admin deletes pages.
-- ============================================================================

-- Write access: an active admin or member. Guests read only.
create or replace function public.can_write_workspace(ws text)
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
      and m.role in ('admin', 'member')
  );
$$;

create or replace function public.can_write_note(n text)
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
      and m.role in ('admin', 'member')
  );
$$;

-- `owns_workspace` / `owns_note` stay as the read check; writes move to the helpers above.
drop policy notes_rw       on public.notes;
drop policy tags_rw        on public.tags;
drop policy blocks_rw      on public.blocks;
drop policy note_tags_rw   on public.note_tags;
drop policy attachments_rw on public.attachments;

create policy notes_read   on public.notes for select using (public.owns_workspace(workspace_id));
create policy notes_insert on public.notes for insert with check (public.can_write_workspace(workspace_id));
create policy notes_update on public.notes for update
  using (public.can_write_workspace(workspace_id)) with check (public.can_write_workspace(workspace_id));
create policy notes_delete on public.notes for delete using (public.is_workspace_admin(workspace_id));

create policy tags_read   on public.tags for select using (public.owns_workspace(workspace_id));
create policy tags_insert on public.tags for insert with check (public.can_write_workspace(workspace_id));
create policy tags_update on public.tags for update
  using (public.can_write_workspace(workspace_id)) with check (public.can_write_workspace(workspace_id));
create policy tags_delete on public.tags for delete using (public.can_write_workspace(workspace_id));

create policy blocks_read   on public.blocks for select using (public.owns_note(note_id));
create policy blocks_insert on public.blocks for insert with check (public.can_write_note(note_id));
create policy blocks_update on public.blocks for update
  using (public.can_write_note(note_id)) with check (public.can_write_note(note_id));
create policy blocks_delete on public.blocks for delete using (public.can_write_note(note_id));

create policy note_tags_read   on public.note_tags for select using (public.owns_note(note_id));
create policy note_tags_insert on public.note_tags for insert with check (public.can_write_note(note_id));
create policy note_tags_update on public.note_tags for update
  using (public.can_write_note(note_id)) with check (public.can_write_note(note_id));
create policy note_tags_delete on public.note_tags for delete using (public.can_write_note(note_id));

create policy attachments_read   on public.attachments for select using (public.owns_note(note_id));
create policy attachments_insert on public.attachments for insert with check (public.can_write_note(note_id));
create policy attachments_update on public.attachments for update
  using (public.can_write_note(note_id)) with check (public.can_write_note(note_id));
create policy attachments_delete on public.attachments for delete using (public.can_write_note(note_id));

-- Deleting a page is a soft delete (an UPDATE), which a policy cannot tell apart from an edit.
create or replace function public.notes_delete_admin_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() is null for service_role and migrations, which are not users.
  if old.deleted_at is null and new.deleted_at is not null
     and auth.uid() is not null
     and not public.is_workspace_admin(new.workspace_id) then
    raise exception 'only an admin can delete a page' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger notes_delete_admin_only_trg
  before update of deleted_at on public.notes
  for each row execute function public.notes_delete_admin_only();

-- ============================================================================
-- sync_push — identical to 0003 except every UPDATE checks it changed a row.
-- ============================================================================
create or replace function public.sync_push(device text, ops jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  op          jsonb;
  outcomes    jsonb := '[]'::jsonb;
  op_id       text;
  op_entity   text;
  op_type     text;
  op_payload  jsonb;
  op_version  integer;
  target      text;
  cur_version integer;
  cur_deleted timestamptz;
  cur_row     jsonb;
  found       boolean;
  applied     boolean;
  fail_reason text;
  touched     integer;
begin
  if jsonb_typeof(ops) <> 'array' then
    raise exception 'ops must be a JSON array' using errcode = '22023';
  end if;

  for op in select * from jsonb_array_elements(ops)
  loop
    op_id      := op ->> 'id';
    op_entity  := op ->> 'entity';
    op_type    := op ->> 'type';
    op_payload := coalesce(op -> 'payload', '{}'::jsonb);
    op_version := (op ->> 'version')::integer;
    target     := op ->> 'entityId';

    found := false;
    cur_version := null;
    cur_deleted := null;
    cur_row := null;
    applied := false;
    fail_reason := null;
    touched := 1;

    if op_entity = 'note' then
      select n.version, n.deleted_at, to_jsonb(n) into cur_version, cur_deleted, cur_row
      from public.notes n where n.id = target;
      found := cur_row is not null;
    elsif op_entity = 'block' then
      select b.version, b.deleted_at, to_jsonb(b) into cur_version, cur_deleted, cur_row
      from public.blocks b where b.id = target;
      found := cur_row is not null;
    elsif op_entity = 'workspace' then
      select w.version, null::timestamptz, to_jsonb(w) into cur_version, cur_deleted, cur_row
      from public.workspaces w where w.id = target;
      found := cur_row is not null;
    else
      outcomes := outcomes || jsonb_build_object(
        'id', op_id, 'status', 'rejected', 'reason', format('unknown entity %s', op_entity));
      continue;
    end if;

    if found and cur_deleted is not null and op_type not like 'Delete%' then
      outcomes := outcomes || jsonb_build_object(
        'id', op_id,
        'status', 'deleted',
        'serverVersion', cur_version,
        'deletedAt', (extract(epoch from cur_deleted) * 1000)::bigint);
      continue;
    end if;

    if found and op_type like 'Create%' and cur_version >= op_version then
      outcomes := outcomes || jsonb_build_object('id', op_id, 'status', 'ack', 'version', cur_version);
      continue;
    end if;

    if found and cur_version >= op_version and op_type not like 'Delete%' then
      outcomes := outcomes || jsonb_build_object(
        'id', op_id,
        'status', 'conflict',
        'serverVersion', cur_version,
        'serverPayload', cur_row);
      continue;
    end if;

    if not found and op_type not like 'Create%' then
      outcomes := outcomes || jsonb_build_object(
        'id', op_id, 'status', 'rejected', 'reason', 'entity no longer exists');
      continue;
    end if;

    begin
      if op_entity = 'note' then
        if not found then
          insert into public.notes (id, workspace_id, title, type, properties, archived, favorite, version)
          values (
            target,
            op_payload ->> 'workspace_id',
            coalesce(op_payload ->> 'title', ''),
            coalesce(op_payload ->> 'type', 'single'),
            coalesce(op_payload -> 'properties', '{}'::jsonb),
            coalesce((op_payload ->> 'archived')::boolean, false),
            coalesce((op_payload ->> 'favorite')::boolean, false),
            op_version);
        elsif op_type like 'Delete%' then
          update public.notes set deleted_at = now(), version = op_version where id = target;
          get diagnostics touched = row_count;
        else
          update public.notes set
            title      = coalesce(op_payload ->> 'title', title),
            properties = coalesce(op_payload -> 'properties', properties),
            archived   = coalesce((op_payload ->> 'archived')::boolean, archived),
            favorite   = coalesce((op_payload ->> 'favorite')::boolean, favorite),
            deleted_at = case when op_payload ? 'deleted_at' and op_payload ->> 'deleted_at' is null
                              then null else deleted_at end,
            version    = op_version
          where id = target;
          get diagnostics touched = row_count;
        end if;

      elsif op_entity = 'block' then
        if not found then
          insert into public.blocks (id, note_id, parent_block, position, type, text, checked, props, version)
          values (
            target,
            op_payload ->> 'note_id',
            op_payload ->> 'parent_block',
            coalesce((op_payload ->> 'position')::double precision, 0),
            coalesce(op_payload ->> 'type', 'paragraph'),
            op_payload ->> 'text',
            coalesce((op_payload ->> 'checked')::boolean, false),
            coalesce(op_payload -> 'props', '{}'::jsonb),
            op_version);
        elsif op_type like 'Delete%' then
          update public.blocks set deleted_at = now(), version = op_version where id = target;
          get diagnostics touched = row_count;
        else
          update public.blocks set
            parent_block = case when op_payload ? 'parent_block'
                                then op_payload ->> 'parent_block' else parent_block end,
            position     = coalesce((op_payload ->> 'position')::double precision, position),
            type         = coalesce(op_payload ->> 'type', type),
            text         = case when op_payload ? 'text' then op_payload ->> 'text' else text end,
            checked      = coalesce((op_payload ->> 'checked')::boolean, checked),
            props        = coalesce(op_payload -> 'props', props),
            deleted_at   = case when op_payload ? 'deleted_at' and op_payload ->> 'deleted_at' is null
                                then null else deleted_at end,
            version      = op_version
          where id = target;
          get diagnostics touched = row_count;
        end if;

      elsif op_entity = 'workspace' then
        if not found then
          insert into public.workspaces (id, owner_id, name, version)
          values (target, auth.uid(), coalesce(op_payload ->> 'name', 'Personal'), op_version);
        else
          update public.workspaces set
            name = coalesce(op_payload ->> 'name', name), version = op_version
          where id = target;
          get diagnostics touched = row_count;
        end if;
      end if;

      -- RLS filters a disallowed UPDATE to 0 rows without raising; without this it would be logged and acked.
      if touched = 0 then
        raise exception 'permission denied: your role cannot change this %', op_entity
          using errcode = '42501';
      end if;

      insert into public.sync_ops (device_id, entity, entity_id, type, payload, version)
      values (device, op_entity, target, op_type, op_payload, op_version);

      applied := true;
    exception
      when foreign_key_violation
        or check_violation
        or not_null_violation
        or unique_violation
        or invalid_text_representation
        or numeric_value_out_of_range
        or string_data_right_truncation
        or datatype_mismatch
        or insufficient_privilege then
        fail_reason := SQLERRM;
    end;

    if applied then
      outcomes := outcomes || jsonb_build_object('id', op_id, 'status', 'ack', 'version', op_version);
    else
      outcomes := outcomes || jsonb_build_object('id', op_id, 'status', 'rejected', 'reason', fail_reason);
    end if;
  end loop;

  return outcomes;
end;
$$;

grant execute on function public.sync_push(text, jsonb) to authenticated;
