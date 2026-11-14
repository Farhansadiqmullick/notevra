-- ============================================================================
-- 0006 — sync_pull stops being per-account and starts being per-space
--
-- The gap 0005 left open, asserted in db:verify so it could not be mistaken for working:
--
--   ✓ KNOWN GAP: a member still pulls none of the admin's ops
--
-- 0005 made a member able to READ a shared space and WRITE to it. It did not make their edits
-- arrive anywhere. `sync_pull` filtered `actor_id = auth.uid()`, so two people in one space would
-- each see the other's pages, each be able to type in them, and never once see what the other
-- typed. design/collaboration-and-sharing.md §4.3 calls this the highest-risk item in the plan, for
-- the reason that it fails *upward*: sharing appears to work, so nobody looks here.
--
-- ── This migration is ALSO meant to change nothing for one account ──────────────────────────────
-- For a single user, every operation in a space they are a member of is their own, so the old
-- predicate and the new one select the same rows. db:verify must return the same 36 it did before,
-- with one exception that is the entire point: the KNOWN GAP assertion flips from 0 to a real
-- count. That is the last free correctness check this rewrite gets.
--
-- ── Why a denormalised workspace_id, rather than a join in the predicate ────────────────────────
-- Visibility is a question about the space an operation belongs to, and `sync_ops` did not record
-- one — it had to be recovered by walking block → note → workspace, per row, on the hottest read in
-- the system: every device polls this on a timer, forever. Worse, that walk is only correct while
-- the entity still exists, and an operation's whole job is to outlive the state it describes.
--
-- So the space is stamped on the row at write time, by a trigger rather than by editing `sync_push`
-- — one place, no 200-line function to reproduce for a one-line change, and any future writer gets
-- it for free.
-- ============================================================================

alter table public.sync_ops
  add column workspace_id text references public.workspaces (id) on delete cascade;

-- ----------------------------------------------------------------------------
-- Stamp the space on every operation as it is written.
--
-- SECURITY DEFINER because it resolves `notes` and `blocks` on behalf of a caller whose own policies
-- are irrelevant to the question — the row is being written, its provenance is not the writer's to
-- assert, and RLS here would make the stamp depend on who happened to push it.
--
-- Leaves a non-null value alone, so a future writer that knows its own workspace can say so.
-- ----------------------------------------------------------------------------
create or replace function public.sync_ops_stamp_workspace()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.workspace_id is null then
    new.workspace_id := case new.entity
      when 'workspace' then new.entity_id
      when 'note'      then (select n.workspace_id from public.notes n where n.id = new.entity_id)
      when 'block'     then (select n.workspace_id
                             from public.blocks b
                             join public.notes n on n.id = b.note_id
                             where b.id = new.entity_id)
      else null
    end;
  end if;
  return new;
end;
$$;

create trigger sync_ops_stamp_workspace_trg
  before insert on public.sync_ops
  for each row execute function public.sync_ops_stamp_workspace();

-- ----------------------------------------------------------------------------
-- Backfill, by the same walk the trigger does.
--
-- `sync_push` only records an operation after it has applied it, so every existing row refers to an
-- entity that existed at that moment, and deletes here are soft — the rows are still there to be
-- walked. Anything that does not resolve is an operation about something no client could apply
-- anyway; it stays NULL and is filtered out below rather than being handed to somebody.
-- ----------------------------------------------------------------------------
update public.sync_ops o set workspace_id = case o.entity
  when 'workspace' then o.entity_id
  when 'note'      then (select n.workspace_id from public.notes n where n.id = o.entity_id)
  when 'block'     then (select n.workspace_id
                         from public.blocks b
                         join public.notes n on n.id = b.note_id
                         where b.id = o.entity_id)
  else null
end
where o.workspace_id is null;

-- The pull is `workspace_id in (…) and seq > cursor order by seq`, so this is the index that serves
-- it — leading column the equality, trailing column the range and the sort. `sync_ops_pull_idx`
-- (actor_id, seq) is left in place: it no longer serves the pull, but `actor_id` is attribution now
-- and "everything this person did" is a query the activity feed will want.
create index sync_ops_space_idx on public.sync_ops (workspace_id, seq);

-- ----------------------------------------------------------------------------
-- The spaces I am in, as a set the planner can use.
--
-- SECURITY DEFINER for the usual reason, and returning a set rather than a boolean deliberately:
-- `is_member(o.workspace_id)` would be a function call per candidate row, where `in (select …)` is
-- one small scan the planner can hash and probe the index with.
-- ----------------------------------------------------------------------------
create or replace function public.my_workspace_ids()
returns setof text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select m.workspace_id
  from public.workspace_members m
  where m.user_id = auth.uid()
    and m.membership = 'active';
$$;

-- ----------------------------------------------------------------------------
-- The operation log itself has to open, or none of the above is reachable.
--
-- This is the half that is easy to miss, and it fails invisibly: `sync_pull` is SECURITY INVOKER,
-- so RLS on `sync_ops` applies to the caller. With `sync_ops_rw` still saying `actor_id =
-- auth.uid()`, a member's pull filters rows the policy has already removed — the new predicate is
-- correct, runs, and matches nothing, because the only rows it was ever shown were the member's
-- own. A rewrite of the function alone looks complete and changes nothing.
--
-- Read and write part company here, permanently:
--
--   read   — every operation in a space I am in. This is what makes another person's edits arrive,
--            and it is a deliberate widening: `device_id` and the shape of somebody's editing
--            session become visible to everyone in the space. That is also what lets the activity
--            feed say who did something, which is the feature it pays for.
--   write  — my own operations only, unchanged. `actor_id` defaults to auth.uid() and the check
--            keeps it honest: being in a space lets you READ its history, never author somebody
--            else's entry in it.
-- ----------------------------------------------------------------------------
drop policy sync_ops_rw on public.sync_ops;

create policy sync_ops_read on public.sync_ops
  for select using (
    workspace_id is not null
    and workspace_id in (select public.my_workspace_ids())
  );

create policy sync_ops_insert on public.sync_ops
  for insert with check (actor_id = auth.uid());

-- ----------------------------------------------------------------------------
-- The pull itself. Everything above the WHERE clause is unchanged.
-- ----------------------------------------------------------------------------
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
    where o.seq > cursor_seq
      -- operations on entities I can currently see. `actor_id` stops being the filter here and
      -- becomes attribution — which is what finally lets an activity feed say WHO did something
      -- rather than only what happened.
      and o.workspace_id is not null
      and o.workspace_id in (select public.my_workspace_ids())
      -- A device still never receives its own operations back. Narrowed from `device_id <> device`
      -- to my own ops from this device: device ids are minted by clients, so two accounts can hold
      -- the same string, and the old form would have silently dropped a collaborator's operations
      -- for as long as that collision lasted. Identical for one account, where every op is mine.
      and not (o.actor_id = auth.uid() and o.device_id = device)
    order by o.seq
    limit max_rows
  ) x;

  -- `seq` is the cursor, not part of the operation; strip it from what the client sees
  return jsonb_build_object(
    'ops', coalesce((select jsonb_agg(e - 'seq') from jsonb_array_elements(rows_out) e), '[]'::jsonb),
    'cursor', next_seq);
end;
$$;

-- ============================================================================
-- STILL NOT DONE, and now reachable — the commit-ordering hazard recorded at the tail of 0002.
--
-- `seq` is assigned at INSERT, not at COMMIT, so two concurrent pushes can commit out of order: a
-- device pulling in that window advances its cursor past an operation it never saw. 0002 judged it
-- unreachable "with one account and a couple of browsers", and it was right. This migration is what
-- retires that premise — concurrent writers in one space are now the ordinary case, not a
-- contrivance.
--
-- The fix it describes is unchanged and belongs in its own migration: hand out operations only from
-- transactions known to have committed (`pg_snapshot_xmin(pg_current_snapshot())` as a watermark).
-- The client's cursor contract does not move, so it is a change to this function only.
-- ============================================================================
