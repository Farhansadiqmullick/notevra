-- ============================================================================
-- 0002 — the server half of sync: apply an operation, decide ack / conflict / deleted.
--
-- The client's engine speaks `SyncTransport` (src/core/sync/types.ts): push a batch of operations,
-- get exactly one outcome per operation back; pull everything that happened elsewhere since a
-- cursor. This migration is what a Supabase implementation of that interface calls.
--
-- Sync is OPERATION-based, not row-based. The client ships `UpdateBlock {id, text}`, never the whole
-- block — which is what makes two people editing different fields of the same block a non-event
-- instead of a fight. So these functions apply operations; they do not accept row upserts.
--
-- THE CASE / SNAKE_CASE CONTRACT, because it is the easiest thing here to get wrong:
-- payloads arriving in `sync_push` are already snake_case, and `sync_pull` returns snake_case. The
-- client's payloads are camelCase (`parentBlock`, `deletedAt`), and converting them is the
-- TRANSPORT's job, in TypeScript, where it is one function each way and can be unit-tested. SQL
-- never guesses at key names.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The operation log.
--
-- Pull needs to return OPERATIONS, and rows alone cannot produce them: a row tells you a block's
-- position is 3.5, not whether that was a MoveBlock or an UpdateBlock, and replaying the wrong one
-- loses the intent the whole design is built on. So every applied operation is appended here, and
-- pull reads this rather than diffing tables.
--
-- `seq` is a bigserial, and it is the cursor. Deliberately not a timestamp: `updated_at` is set from
-- the server clock and two operations in the same millisecond are ordinary, so a timestamp cursor
-- either re-delivers rows forever (>=) or silently skips them (>). An integer sequence is total and
-- gapless in ordering, and it stays inside JS's safe integer range for longer than this app will
-- exist.
--
-- `device_id` is what stops a device re-applying its own writes: pull excludes the caller's own
-- device rather than the caller's own ACCOUNT, because the whole point is that your other browser
-- is the same account and its edits must arrive.
-- ----------------------------------------------------------------------------
create table public.sync_ops (
  seq        bigserial primary key,
  actor_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id  text not null,
  entity     text not null check (entity in ('block', 'note', 'workspace')),
  entity_id  uuid not null,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  version    integer not null,
  created_at timestamptz not null default now()
);

-- the only read this table ever serves: "my ops, after this cursor, not from this device"
create index sync_ops_pull_idx on public.sync_ops (actor_id, seq);

alter table public.sync_ops enable row level security;

create policy sync_ops_rw on public.sync_ops
  for all using (actor_id = auth.uid()) with check (actor_id = auth.uid());

grant select, insert on public.sync_ops to authenticated;
grant usage, select on sequence public.sync_ops_seq_seq to authenticated;

-- ============================================================================
-- sync_push
--
-- SECURITY INVOKER — the default, and load-bearing. This function writes to notes and blocks on
-- behalf of the caller, so it must run under the caller's own policies: a SECURITY DEFINER version
-- would apply every operation as its owner and cheerfully write into anyone's workspace, turning
-- the RLS in migration 0001 into decoration.
--
-- Returns one outcome per operation, in the order received. The three non-ack outcomes exist
-- because the engine treats them completely differently (src/core/sync/types.ts):
--
--   conflict  someone edited this from the same base version. The op STAYS queued and untouched
--             until a person picks a side — never silently overwritten.
--   deleted   the row was removed by someone else. Its own outcome rather than an ack (which would
--             pretend the write landed on a row nobody will see again) or a rejection (which would
--             retry forever against a row that is never coming back).
--   rejected  terminal and the engine drops it. Only for operations that can never succeed.
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
  target      uuid;
  cur_version integer;
  cur_deleted timestamptz;
  cur_row     jsonb;
  found       boolean;
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
    target     := (op ->> 'entityId')::uuid;

    -- current server state for this entity, if any
    found := false;
    cur_version := null;
    cur_deleted := null;
    cur_row := null;

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

    -- ---------------------------------------------------------------------
    -- Decide. Order matters: a row that is GONE cannot have a version clash, so the delete check
    -- comes first — otherwise an edit of a deleted row reports as an ordinary conflict and the
    -- dialog offers "keep theirs" against a row that no longer exists.
    -- ---------------------------------------------------------------------
    if found and cur_deleted is not null and op_type not like 'Delete%' then
      outcomes := outcomes || jsonb_build_object(
        'id', op_id,
        'status', 'deleted',
        'serverVersion', cur_version,
        'deletedAt', (extract(epoch from cur_deleted) * 1000)::bigint);
      continue;
    end if;

    -- A second delete is agreement, not a clash: both sides want it gone, so let it ack.
    if found and cur_version >= op_version and op_type not like 'Delete%' then
      outcomes := outcomes || jsonb_build_object(
        'id', op_id,
        'status', 'conflict',
        'serverVersion', cur_version,
        'serverPayload', cur_row);
      continue;
    end if;

    if not found and op_type not like 'Create%' then
      -- The outbox is drained in order, so a Create always precedes its Updates from the same
      -- device. Missing here means the row was purged — retrying can never succeed.
      outcomes := outcomes || jsonb_build_object(
        'id', op_id, 'status', 'rejected', 'reason', 'entity no longer exists');
      continue;
    end if;

    -- ---------------------------------------------------------------------
    -- Apply. Every UPDATE uses `coalesce(payload ->> 'x', current)` so an operation patches only
    -- the fields it actually carries — shipping a whole row would undo a concurrent edit to a
    -- field this operation never mentioned, which is precisely what operation-based sync exists
    -- to avoid.
    -- ---------------------------------------------------------------------
    if op_entity = 'note' then
      if not found then
        insert into public.notes (id, workspace_id, title, type, properties, archived, favorite, version)
        values (
          target,
          (op_payload ->> 'workspace_id')::uuid,
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
          (op_payload ->> 'note_id')::uuid,
          (op_payload ->> 'parent_block')::uuid,
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
                              then (op_payload ->> 'parent_block')::uuid else parent_block end,
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

    -- Logged only after a successful apply, inside the same transaction: an operation another
    -- device can pull but that never landed here would be a change appearing on one screen and
    -- nowhere else.
    insert into public.sync_ops (device_id, entity, entity_id, type, payload, version)
    values (device, op_entity, target, op_type, op_payload, op_version);

    outcomes := outcomes || jsonb_build_object('id', op_id, 'status', 'ack', 'version', op_version);
  end loop;

  return outcomes;
end;
$$;

-- ============================================================================
-- sync_pull
--
-- Everything that happened elsewhere since `cursor`, oldest first, excluding this device's own
-- operations. Returns `{ ops, cursor }` matching PullResult.
--
-- The returned cursor is the last `seq` actually included, NOT the table's current max: with a
-- limit, those differ, and returning the max would skip every operation past the limit forever. On
-- an empty result the cursor comes back unchanged.
-- ============================================================================
create or replace function public.sync_pull(device text, cursor_seq bigint default 0, max_rows integer default 500)
returns jsonb
language plpgsql
security invoker
as $$
declare
  rows_out jsonb;
  next_seq bigint;
begin
  select
    coalesce(jsonb_agg(x order by x.seq), '[]'::jsonb),
    coalesce(max(x.seq), cursor_seq)
  into rows_out, next_seq
  from (
    select
      o.seq,
      o.seq::text     as id,
      o.entity        as entity,
      o.entity_id     as "entityId",
      o.type          as type,
      o.payload       as payload,
      o.version       as version,
      (extract(epoch from o.created_at) * 1000)::bigint as "createdAt"
    from public.sync_ops o
    where o.actor_id = auth.uid()
      and o.seq > cursor_seq
      and o.device_id <> device
    order by o.seq
    limit max_rows
  ) x;

  -- `seq` is the cursor, not part of the operation; strip it from what the client sees
  return jsonb_build_object(
    'ops', coalesce((select jsonb_agg(e - 'seq') from jsonb_array_elements(rows_out) e), '[]'::jsonb),
    'cursor', next_seq);
end;
$$;

grant execute on function public.sync_push(text, jsonb) to authenticated;
grant execute on function public.sync_pull(text, bigint, integer) to authenticated;

-- ============================================================================
-- KNOWN LIMIT, worth writing down rather than discovering later:
--
-- `seq` is assigned when a row is inserted, not when its transaction commits, so two concurrent
-- pushes can commit out of order — 5 lands before 4 — and a device that pulls in that window
-- advances its cursor past 4 and never sees it. With one account and a couple of browsers the
-- window is microseconds and pushes are effectively serialised, so this is not reachable in
-- practice yet.
--
-- The fix, when there are enough writers to reach it, is to stop trusting the sequence alone and
-- only hand out operations from transactions known to have committed — `pg_snapshot_xmin
-- (pg_current_snapshot())` as a watermark, or a commit-ordered log. Both are a change to `sync_pull`
-- only; the client's cursor contract does not move.
-- ============================================================================
