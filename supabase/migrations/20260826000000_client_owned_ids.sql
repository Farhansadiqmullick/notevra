-- ============================================================================
-- 0003 — entity ids become `text`, and one bad operation stops poisoning a batch.
--
-- Both changes come from the same discovery, made while writing the Supabase transport: **the
-- client is the id authority in this app, and the server was refusing ids it had no business
-- refusing.**
--
-- ── Why `uuid` was the wrong type here ──────────────────────────────────────────────────────────
-- An offline-first app has to be able to create a note on a plane. That means ids are minted on the
-- device, before any server has seen them — `gen_random_uuid()` as a column default was decoration
-- from the first day, because nothing ever inserts without an id.
--
-- Once the server does not GENERATE ids, insisting on their FORMAT buys nothing and costs real
-- data. The seeded library (`src/core/db/seed.ts`) uses readable stable ids — `ws-personal`,
-- `note-groceries`, `blk-g1` — precisely so re-running the seed cannot duplicate rows. Those are
-- legitimate rows a person has been writing in for weeks. Under `uuid` every one of them was
-- unsyncable, and not quietly: `(op ->> 'entityId')::uuid` raises 22P02, which aborted the whole
-- `sync_push` call, which requeued all 25 operations in the batch, which sent them again. A single
-- demo note was enough to livelock sync for an entire account — nothing would EVER sync, and the
-- only symptom would be a queue depth that never fell.
--
-- So: `text`, with a length check. The check is the part worth keeping — it catches a client bug
-- (an id that is empty, or a whole document pasted into an id field) without inventing a format the
-- client never agreed to.
--
-- ── Why per-operation error handling ────────────────────────────────────────────────────────────
-- The livelock above is a class, not an incident. Any operation that raises — a foreign key to a
-- note that was purged, a check constraint, a bad enum — takes its 24 innocent neighbours down with
-- it and retries forever. `SyncTransport`'s contract already has the right answer for "this can
-- never succeed": `rejected`. The batch just had no way to say it about one member.
--
-- Only DATA errors are converted. A deadlock or a serialization failure is transient, and turning
-- one of those into `rejected` would throw away a write the user made — so those still raise and
-- the batch retries, which is the safe direction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ids → text
--
-- Foreign keys have to come off before the referenced types can move; re-added identically
-- afterwards. The order matters only in that every column in a key pair must end up the same type,
-- so they are altered together between the drop and the re-add.
-- ----------------------------------------------------------------------------
-- Policies reference these columns, and Postgres refuses to alter a column a policy depends on
-- (0A000). They are dropped and recreated VERBATIM below — the authorization model does not change
-- here, only the type of the thing it compares. The `owns_*` helpers have to be recreated too,
-- since their parameter types are half of that comparison.
drop policy notes_rw       on public.notes;
drop policy tags_rw        on public.tags;
drop policy blocks_rw      on public.blocks;
drop policy note_tags_rw   on public.note_tags;
drop policy attachments_rw on public.attachments;
drop function public.owns_workspace(uuid);
drop function public.owns_note(uuid);

alter table public.attachments drop constraint attachments_block_id_fkey;
alter table public.attachments drop constraint attachments_note_id_fkey;
alter table public.blocks      drop constraint blocks_note_id_fkey;
alter table public.blocks      drop constraint blocks_parent_block_fkey;
alter table public.note_tags   drop constraint note_tags_note_id_fkey;
alter table public.note_tags   drop constraint note_tags_tag_id_fkey;
alter table public.notes       drop constraint notes_workspace_id_fkey;
alter table public.tags        drop constraint tags_workspace_id_fkey;

alter table public.workspaces  alter column id           drop default,
                               alter column id           type text using id::text;
alter table public.notes       alter column id           drop default,
                               alter column id           type text using id::text,
                               alter column workspace_id type text using workspace_id::text;
alter table public.blocks      alter column id           drop default,
                               alter column id           type text using id::text,
                               alter column note_id      type text using note_id::text,
                               alter column parent_block type text using parent_block::text;
alter table public.tags        alter column id           drop default,
                               alter column id           type text using id::text,
                               alter column workspace_id type text using workspace_id::text;
alter table public.note_tags   alter column note_id      type text using note_id::text,
                               alter column tag_id       type text using tag_id::text;
alter table public.attachments alter column id           drop default,
                               alter column id           type text using id::text,
                               alter column note_id      type text using note_id::text,
                               alter column block_id     type text using block_id::text;

-- the operation log points at the same entities and has to move with them
alter table public.sync_ops    alter column entity_id    type text using entity_id::text;

alter table public.attachments add constraint attachments_block_id_fkey
  foreign key (block_id) references public.blocks (id) on delete cascade;
alter table public.attachments add constraint attachments_note_id_fkey
  foreign key (note_id) references public.notes (id) on delete cascade;
alter table public.blocks      add constraint blocks_note_id_fkey
  foreign key (note_id) references public.notes (id) on delete cascade;
alter table public.blocks      add constraint blocks_parent_block_fkey
  foreign key (parent_block) references public.blocks (id) on delete cascade;
alter table public.note_tags   add constraint note_tags_note_id_fkey
  foreign key (note_id) references public.notes (id) on delete cascade;
alter table public.note_tags   add constraint note_tags_tag_id_fkey
  foreign key (tag_id) references public.tags (id) on delete cascade;
alter table public.notes       add constraint notes_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.tags        add constraint tags_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces (id) on delete cascade;

-- The one rule left about the shape of an id. Not a format — a sanity bound, so a client bug lands
-- as a rejected operation the user can be told about instead of as a 4KB primary key.
alter table public.workspaces  add constraint workspaces_id_len  check (length(id) between 1 and 64);
alter table public.notes       add constraint notes_id_len       check (length(id) between 1 and 64);
alter table public.blocks      add constraint blocks_id_len      check (length(id) between 1 and 64);
alter table public.tags        add constraint tags_id_len        check (length(id) between 1 and 64);
alter table public.attachments add constraint attachments_id_len check (length(id) between 1 and 64);

-- ----------------------------------------------------------------------------
-- The helpers and policies again, identical to 0001 apart from the parameter type. The reasoning
-- for SECURITY DEFINER and the pinned search_path is written out there and has not changed: the
-- helper must read `workspaces` regardless of the caller's own policies, or the policies recurse.
-- ----------------------------------------------------------------------------
create or replace function public.owns_workspace(ws text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = ws and w.owner_id = auth.uid()
  );
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
    join public.workspaces w on w.id = nt.workspace_id
    where nt.id = n and w.owner_id = auth.uid()
  );
$$;

create policy notes_rw on public.notes
  for all using (public.owns_workspace(workspace_id))
  with check (public.owns_workspace(workspace_id));

create policy tags_rw on public.tags
  for all using (public.owns_workspace(workspace_id))
  with check (public.owns_workspace(workspace_id));

create policy blocks_rw on public.blocks
  for all using (public.owns_note(note_id)) with check (public.owns_note(note_id));

create policy note_tags_rw on public.note_tags
  for all using (public.owns_note(note_id)) with check (public.owns_note(note_id));

create policy attachments_rw on public.attachments
  for all using (public.owns_note(note_id)) with check (public.owns_note(note_id));

-- ============================================================================
-- sync_push — same logic as 0002, with two changes:
--   * no `::uuid` casts on entity ids
--   * each operation applies inside its own exception block
--
-- Everything else (the outcome vocabulary, the delete-before-conflict ordering, the coalesce
-- patching) is unchanged and the comments in 0002 still explain it.
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

    -- A Create for a row the server already holds, at a version at least as new, is AGREEMENT —
    -- the same shape of rule as "a second delete is not a clash".
    --
    -- This is what makes signing in on a second browser survivable. Both devices backfill their
    -- local library (src/core/sync/backfill.ts), so the second one sends a Create for every row the
    -- first one already sent. Read as a version clash, that is hundreds of conflicts asking the
    -- user to arbitrate differences that do not exist. Nothing is applied — the ack says "already
    -- here", so a stale copy cannot overwrite a newer server row on its way past.
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

    -- ---------------------------------------------------------------------
    -- Apply, inside its own subtransaction.
    --
    -- The exception list is deliberately narrow: these are the codes that mean "this operation is
    -- wrong and will be wrong every time" — a bad id, a parent that does not exist, a value the
    -- column will not hold. `others` is NOT caught, so a deadlock or a lost connection still aborts
    -- the batch and the engine retries it, which is the direction that cannot lose a write.
    -- ---------------------------------------------------------------------
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
        end if;

      elsif op_entity = 'workspace' then
        if not found then
          insert into public.workspaces (id, owner_id, name, version)
          values (target, auth.uid(), coalesce(op_payload ->> 'name', 'Personal'), op_version);
        else
          update public.workspaces set
            name = coalesce(op_payload ->> 'name', name), version = op_version
          where id = target;
        end if;
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
        -- RLS refusing the row lands here, and it is the one most likely to fire in practice: a
        -- block whose note does not exist fails `blocks_rw`'s WITH CHECK *before* the foreign key
        -- is ever consulted, so 42501 is what a genuinely orphaned operation actually raises. It
        -- belongs with the terminal codes — the caller is not allowed to write this row, and
        -- sending it 8 more times will not change that. The engine still retries with backoff
        -- first and shows SQLERRM in Settings, so a grant that was misconfigured surfaces as a
        -- readable "permission denied for table blocks" rather than as a silent stall.
        or insufficient_privilege then
        -- SQLERRM names the actual column or constraint, which is what the outbox row shows in
        -- Settings. A generic "rejected" would leave the user with a stuck operation and no clue.
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
