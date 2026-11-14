-- ============================================================================
-- 0013 — a page can move out of a space you are alone in (Personal → a project), and arrives whole.
-- ============================================================================

-- Only from a space nobody else is in: leaving a shared one would strand copies on its members' devices.
create or replace function public.can_move_page_out(ws text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.is_workspace_admin(ws)
     and not exists (
       select 1 from public.workspace_members m
       where m.workspace_id = ws
         and m.user_id <> auth.uid()
         and m.membership = 'active'
     );
$$;

-- sync_push — identical to 0012 except a note UPDATE may change workspace_id, and a move re-announces the page.
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
  moved       boolean;
begin
  if jsonb_typeof(ops) <> 'array' then
    raise exception 'ops must be a JSON array' using errcode = '22023';
  end if;

  -- Held until commit and taken before any seq is drawn; one global key, since a pull spans spaces.
  perform pg_advisory_xact_lock(hashtext('public.sync_push'));

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
    moved := false;

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
          moved := op_payload ->> 'workspace_id' is not null
               and op_payload ->> 'workspace_id' <> cur_row ->> 'workspace_id';
          if moved and not public.can_move_page_out(cur_row ->> 'workspace_id') then
            raise exception 'a page can only move out of a space nobody else is in'
              using errcode = '42501';
          end if;

          -- The destination is checked by notes_update's WITH CHECK: you must be able to write there.
          update public.notes set
            workspace_id = coalesce(op_payload ->> 'workspace_id', workspace_id),
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

      -- The destination's members never saw this page's ops, which were stamped with the old space.
      -- Re-announce it as Creates at current versions: new to them, a no-op for anyone who already has it.
      if moved then
        insert into public.sync_ops (device_id, entity, entity_id, type, payload, version)
        select device, 'note', n.id, 'CreateNote',
               jsonb_build_object(
                 'workspace_id', n.workspace_id, 'title', n.title, 'type', n.type,
                 'properties', n.properties, 'archived', n.archived, 'favorite', n.favorite,
                 'deleted_at', n.deleted_at),
               n.version
        from public.notes n where n.id = target;

        insert into public.sync_ops (device_id, entity, entity_id, type, payload, version)
        select device, 'block', b.id, 'CreateBlock',
               jsonb_build_object(
                 'note_id', b.note_id, 'parent_block', b.parent_block, 'position', b.position,
                 'type', b.type, 'text', b.text, 'checked', b.checked, 'props', b.props,
                 'deleted_at', b.deleted_at),
               b.version
        from public.blocks b where b.note_id = target
        order by b.parent_block nulls first, b.position;
      end if;

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
