-- ============================================================================
-- 0004 — profiles: the one row per account that makes you the same person on every device.
--
-- Until this migration the name and the avatar lived only in IndexedDB (`db.profiles`, schema v8).
-- That is correct for a signed-OUT device — "local" belongs to the browser holding it — but for an
-- account it meant the identity stopped at the device boundary: sign in on a second browser and you
-- were greeted by an empty field and a placeholder circle, with nothing on screen explaining why.
--
-- ── Why this table is NOT part of the sync engine ────────────────────────────────────────────────
-- Everything else syncs as OPERATIONS through `sync_ops` (migration 0002), because notes and blocks
-- have concurrent editors and field-level conflicts worth resolving. A profile has neither. It is
-- one row, one writer (you), two or three fields, and the honest resolution for "you renamed
-- yourself on your phone and your laptop" is last-write-wins — there is no merge of two names that
-- anyone would want. Routing it through the op log would mean a new entity in the reconciler, a new
-- op type in the apply function, and a conflict dialog for a question that does not need asking.
--
-- ── Why the avatar bytes are IN this row ─────────────────────────────────────────────────────────
-- Migration 0001 says image bytes belong in Storage, addressed by checksum, "not in a bytea column
-- inside the hot path". That rule is about ATTACHMENTS: unbounded in number, unbounded in size, and
-- read on every note open. An avatar is none of those. It is one image per account, capped at 512px
-- by the client before it is ever stored (see AVATAR_EDGE in profile.service.ts), which lands around
-- 40 KB of WebP — 55 KB once base64'd.
--
-- Keeping it here buys atomicity, which is the part that matters: the row and the picture arrive in
-- the same statement, so there is no window where the profile points at a checksum whose bytes
-- failed to upload — the exact failure that would show a broken image on the other device with no
-- way to tell whether it was still coming. `profiles_avatar_pair` below enforces that at the
-- database. When avatars grow (multiple sizes, animation), they move to Storage with the rest.
--
-- ── Why `updated_at` has no touch trigger, unlike every other table ──────────────────────────────
-- Elsewhere the server owns `updated_at` because it is the PULL CURSOR, and a client with a wrong
-- clock writing rows into the past would make every other device skip them forever (0001 §updated_at).
-- Nothing pages through this table — there is one row and it is fetched by primary key — so it is
-- not a cursor. What it is instead is the last-write-wins comparison against `ProfileRow.updatedAt`,
-- an epoch-milliseconds value from the client's own clock, and comparing two clocks decides the
-- wrong winner. One writer, one clock, no cursor: the client sets it, and `now()` is only the
-- default for a row that somehow arrives without one.
-- ============================================================================

create table public.profiles (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  display_name    text not null default '',
  -- SHA-256 of the avatar bytes: the same content hash the client's `blobs` table is keyed by, so a
  -- device that already holds this picture can skip decoding it again.
  avatar_checksum text,
  avatar_mime     text,
  -- base64 of the processed WebP. Null and `avatar_checksum` null together, or both present.
  avatar_data     text,
  updated_at      timestamptz not null default now(),

  constraint profiles_avatar_pair
    check ((avatar_checksum is null) = (avatar_data is null))
);

-- ----------------------------------------------------------------------------
-- RLS. Same reasoning as 0001: PostgREST exposes this table to the browser directly, so it is on
-- before the first row exists. The policy is the simplest one in the schema — no walk up to an
-- owner, because the primary key IS the owner.
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_rw on public.profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 0001 set default privileges for future tables, so this is belt-and-braces — but an explicit grant
-- costs nothing and the failure it prevents (`42501 permission denied`, which looks like a broken
-- policy and gets "fixed" by disabling RLS) costs a great deal.
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;
-- `anon` is granted nothing, deliberately. Every row here belongs to somebody.
