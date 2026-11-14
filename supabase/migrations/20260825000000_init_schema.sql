-- ============================================================================
-- 0001 — the server side of the Library.
--
-- Mirrors the Dexie tables in src/core/db/schema.ts (ARCHITECTURE.md §5), which exist first and
-- stay authoritative for the UI: this app is offline-first, so Postgres is the thing notes sync TO,
-- never the thing screens read from. Nothing in the client talks to this directly — the sync engine
-- speaks `SyncTransport` (src/core/sync/types.ts) and a Supabase implementation of that interface
-- is what will eventually land here.
--
-- FOUR PLACES THE SHAPES DELIBERATELY DIVERGE FROM DEXIE, and why:
--
--   1. `0 | 1` becomes `boolean`. archived / favorite / checked are integers in IndexedDB purely
--      because Dexie cannot index a boolean. That is a storage-engine workaround, not a fact about
--      the data, and carrying it into Postgres would mean a CHECK constraint to re-teach the
--      database what a boolean is.
--
--   2. Epoch milliseconds become `timestamptz`. The client keeps `updatedAt: number` — it is doing
--      arithmetic on those constantly and Date objects in IndexedDB are a trap. Here they are real
--      timestamps, so RLS, retention and reading a row by eye all work. The transport converts in
--      one place, both ways: `new Date(ms).toISOString()` out, `Date.parse(iso)` back. PostgREST
--      emits ISO 8601, which JS parses natively.
--
--   3. camelCase becomes snake_case. Postgres folds unquoted identifiers to lower case, so keeping
--      `workspaceId` would require double quotes on every reference in every policy and index for
--      the rest of the project's life. The adapter renames; SQL stays readable.
--
--   4. `properties` / `props` become `jsonb`, not `json` — jsonb is the one that can be indexed and
--      compared, and the ordering/whitespace it discards was never meaningful here.
--
-- WHAT IS ABSENT ON PURPOSE. Five Dexie tables have no counterpart here and are not oversights:
--
--   sync_queue      the outbox. It is a record of what THIS device has not yet sent; a server copy
--                   would be meaningless.
--   meta            local cursors and per-device preferences (lastPulledAt, deviceId, theme).
--   blobs           binary. Image bytes belong in Supabase Storage, addressed by the checksum in
--                   `attachments`, not in a bytea column inside the hot path.
--   block_versions  local undo history (design/data-safety-and-identity.md §3). Becomes a server
--                   table when history has to survive losing the device; not needed to sync.
--   activity        derived locally from the event bus today. Becomes a server table when a feed
--                   has to show what OTHER people did, which needs the accounts below.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- workspaces
--
-- `owner_id` is the root of every policy in this file: a workspace belongs to exactly one account,
-- and everything else reaches auth.uid() by walking up to here. `kind`/`role`/`membership` exist in
-- the client row already, in anticipation of shared spaces — they are carried through so the shapes
-- match, but nothing enforces them yet. Sharing needs a workspace_members table and policies that
-- consult it; see the note at the bottom of this file.
-- ----------------------------------------------------------------------------
create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  kind        text not null default 'personal' check (kind in ('personal', 'shared')),
  role        text check (role in ('owner', 'admin', 'member')),
  membership  text default 'active' check (membership in ('active', 'left', 'removed')),
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- notes
--
-- A note row carries NO content — that is the rule the whole design rests on (ARCHITECTURE.md §5).
-- Content is in `blocks`, which is what keeps a note list fast no matter how much is written inside
-- the notes.
--
-- `deleted_at` rather than DELETE: a removed note is in Trash and must come back intact. Every read
-- path filters on it. Purging is a later, separate job.
-- ----------------------------------------------------------------------------
create table public.notes (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  title         text not null default '',
  type          text not null check (type in ('archive', 'planning', 'single')),
  properties    jsonb not null default '{}'::jsonb,
  archived      boolean not null default false,
  favorite      boolean not null default false,
  deleted_at    timestamptz,
  version       integer not null default 1,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- blocks
--
-- `position` is a fractional index (double precision), not an integer rank. Inserting between two
-- blocks takes the midpoint of its neighbours, so one insert writes ONE row instead of renumbering
-- every sibling below it — which over sync would be a storm of operations for a single drag.
--
-- `parent_block` is self-referential: nesting is a block inside a block, not a separate table.
-- ----------------------------------------------------------------------------
create table public.blocks (
  id            uuid primary key default gen_random_uuid(),
  note_id       uuid not null references public.notes (id) on delete cascade,
  parent_block  uuid references public.blocks (id) on delete cascade,
  position      double precision not null default 0,
  type          text not null,
  text          text,
  checked       boolean not null default false,
  props         jsonb not null default '{}'::jsonb,
  deleted_at    timestamptz,
  version       integer not null default 1,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- tags + note_tags
--
-- note_tags is a pure join table keyed by the pair, matching Dexie's `[noteId+tagId]` compound key.
-- The pair being the PRIMARY KEY is what makes tagging idempotent: applying a tag twice is one row
-- either way, so a replayed sync operation cannot duplicate it.
-- ----------------------------------------------------------------------------
create table public.tags (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null,
  color         text,
  created_at    timestamptz not null default now(),
  unique (workspace_id, name)
);

create table public.note_tags (
  note_id  uuid not null references public.notes (id) on delete cascade,
  tag_id   uuid not null references public.tags (id) on delete cascade,
  primary key (note_id, tag_id)
);

-- ----------------------------------------------------------------------------
-- attachments
--
-- The pointer table for media. `checksum` is a SHA-256 of the bytes and is the dedup key: the same
-- image attached to ten blocks is one object in Storage. `storage_key` is where those bytes live in
-- the bucket; the bytes themselves are never in this database.
-- ----------------------------------------------------------------------------
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid not null references public.notes (id) on delete cascade,
  block_id     uuid references public.blocks (id) on delete cascade,
  checksum     text not null,
  storage_key  text,
  mime         text,
  size         bigint,
  created_at   timestamptz not null default now()
);

-- ============================================================================
-- Indexes — the Dexie index strings, translated.
--
-- Two extra kinds appear here that IndexedDB had no need for: the foreign-key indexes that make the
-- RLS policies below cheap (an unindexed FK turns every policy check into a sequential scan), and
-- partial indexes on the soft-delete column, since "not in the trash" is the filter on essentially
-- every read.
-- ============================================================================
create index workspaces_owner_idx      on public.workspaces (owner_id);
create index notes_workspace_idx       on public.notes (workspace_id);
create index notes_updated_idx         on public.notes (updated_at);
create index notes_live_idx            on public.notes (workspace_id, archived) where deleted_at is null;
create index blocks_note_idx           on public.blocks (note_id);
create index blocks_parent_idx         on public.blocks (parent_block);
create index blocks_updated_idx        on public.blocks (updated_at);
-- the read every editor session does: this note's live blocks, already in render order
create index blocks_order_idx          on public.blocks (note_id, position) where deleted_at is null;
create index tags_workspace_idx        on public.tags (workspace_id);
create index note_tags_tag_idx         on public.note_tags (tag_id);
create index attachments_note_idx      on public.attachments (note_id);
create index attachments_checksum_idx  on public.attachments (checksum);

-- ============================================================================
-- updated_at — set by the database, not trusted from the client.
--
-- Two reasons this is a trigger rather than a column the client writes:
--
--   1. It is the sync cursor. `pull(cursor)` asks for everything that changed since a point in
--      time, so if updated_at came from client clocks, one device with a wrong clock would write
--      rows into the past and every other device would skip them forever — a silent, permanent
--      data loss with no error anywhere.
--   2. It is the server's own record of when it accepted a write, which is the only clock all
--      participants share.
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_touch before update on public.workspaces
  for each row execute function public.touch_updated_at();
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();
create trigger blocks_touch before update on public.blocks
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Row Level Security.
--
-- Enabled on every table, before there is a single row in any of them. This is not a hardening pass
-- to do later: Supabase hands a browser an anon key and PostgREST exposes these tables directly, so
-- a table with RLS off is a table the entire internet can read and write. Turning it on afterwards
-- means shipping a window where that is true.
--
-- The shape of every policy is the same walk up to an owner:
--   blocks → notes → workspaces.owner_id = auth.uid()
--
-- `using` governs which existing rows you can see and change; `with check` governs what a row is
-- allowed to look like AFTER an insert or update. Both are needed on write policies — `using`
-- alone would let someone move one of their own notes into a workspace belonging to someone else.
-- ============================================================================
alter table public.workspaces  enable row level security;
alter table public.notes       enable row level security;
alter table public.blocks      enable row level security;
alter table public.tags        enable row level security;
alter table public.note_tags   enable row level security;
alter table public.attachments enable row level security;

-- Helper, so the same subquery is not copy-pasted into a dozen policies where one copy could drift
-- and quietly open a hole.
--
-- SECURITY DEFINER with a pinned search_path: it must read workspaces regardless of the caller's
-- own policies (otherwise the policies recurse), and pinning search_path stops a caller shadowing
-- `public` with their own table of the same name — the standard privilege-escalation route for a
-- definer function.
create or replace function public.owns_workspace(ws uuid)
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

create policy workspaces_rw on public.workspaces
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy notes_rw on public.notes
  for all using (public.owns_workspace(workspace_id))
  with check (public.owns_workspace(workspace_id));

create policy tags_rw on public.tags
  for all using (public.owns_workspace(workspace_id))
  with check (public.owns_workspace(workspace_id));

-- blocks, note_tags and attachments hang off a note, so they take one more hop up.
create or replace function public.owns_note(n uuid)
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

create policy blocks_rw on public.blocks
  for all using (public.owns_note(note_id)) with check (public.owns_note(note_id));

create policy note_tags_rw on public.note_tags
  for all using (public.owns_note(note_id)) with check (public.owns_note(note_id));

create policy attachments_rw on public.attachments
  for all using (public.owns_note(note_id)) with check (public.owns_note(note_id));

-- ============================================================================
-- Grants — the half of authorization that RLS does not do.
--
-- These are not redundant with the policies above. Postgres checks table PRIVILEGES first and row
-- policies second: with no GRANT, a query is refused before any policy is consulted, and PostgREST
-- returns `42501 permission denied for table notes` no matter how correct the policy is. Creating
-- tables in a migration does not grant DML — the defaults handed out only REFERENCES/TRIGGER/
-- TRUNCATE, so every table above was unreachable by every role including `authenticated`.
--
-- That combination is worth naming, because it is the one that gets RLS turned off by mistake: the
-- app fails for a logged-in user with a permission error, the error mentions the table, and the fix
-- that appears to work is `disable row level security` — which does make the error go away, by
-- making the table world-readable through the anon key.
--
--   authenticated  full DML. RLS is what narrows this to the caller's own rows; without the grant
--                  the policies never run at all.
--   anon           NOTHING, deliberately. There is no public content in this app — every row
--                  belongs to somebody — so an unauthenticated caller has no reason to reach any
--                  table, and the safest privilege is the one that was never granted.
--   service_role   full DML for server-side work. It bypasses RLS by design, so this key must
--                  never reach the browser; it belongs in server environments only.
-- ============================================================================
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

-- Same story for anything added in a LATER migration: without this, the next table created starts
-- unreachable in exactly the same way and the debugging happens all over again.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- ============================================================================
-- NOT DONE HERE, so the next person is not left guessing what the gaps are:
--
--   * Sharing. Every policy above is single-owner. Shared workspaces need a `workspace_members`
--     table and policies that consult it instead of `owner_id` — `owns_workspace()` exists so that
--     change happens in one function rather than in nine policies.
--   * The push/pull endpoints. Sync is OPERATION-based, not row-based (src/core/sync/types.ts), so
--     the transport does not write these tables directly. It calls something that applies an
--     operation and compares `version` to decide ack vs conflict. Postgres functions in the next
--     migration.
--   * Realtime. Nothing is added to a publication yet; pull-based sync works without it.
--   * Seeding. Deliberately empty — the client seeds its own demo data, and a server seed would
--     collide with it on first sync.
-- ============================================================================
