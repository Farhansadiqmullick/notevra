/**
 * seed.ts — what a database starts life with, and the fixture it used to start life with.
 *
 * `seedIfEmpty` is first run: one empty Personal workspace, no pages. `seedSampleLibrary` is the
 * demo library that mirrors the design screenshots (Groceries, Week of 27 July, the flat
 * inspection) — still here as a fixture, no longer wired to first run. The reasoning for the split
 * is on `seedIfEmpty` itself.
 *
 * Real user writes go through services + newId(); everything here is install-time only.
 */
import { logger } from '@/core/logging/logger';
import { canonicalPersonal } from './personal';
import { db, newId } from './schema';

const log = logger.scoped('seed');

const now = Date.now();
/*
 * Seeded rows are UNSENT, like anything else the server has not acknowledged.
 *
 * This is the whole reason `backfillOutbox` can be deleted: the seed no longer needs to tell sync
 * it happened, because `syncedVersion: 0` already says so. The seed writes rows; sync notices.
 * Neither imports the other (design/sync-rebuild.md §7).
 */
const base = { updatedAt: now, version: 1, syncedVersion: 0, dirty: 1 as const, deletedAt: null } as const;

/**
 * Backfill workspace kind/membership on databases seeded before those fields existed. Idempotent
 * and cheap: only writes rows that are missing `kind`. (No Dexie version bump needed — these
 * fields aren't indexed.)
 */
export async function migrateWorkspaces(): Promise<void> {
  const rows = await db.workspaces.toArray();
  const patches = rows
    .filter((w) => !w.kind)
    .map((w) => ({
      ...w,
      kind: w.id === 'ws-personal' ? ('personal' as const) : ('shared' as const),
      role: w.id === 'ws-personal' ? ('owner' as const) : ('member' as const),
      membership: 'active' as const,
    }));
  if (patches.length) await db.workspaces.bulkPut(patches);
}

/**
 * Every seeded id carries a token unique to this install. THIS IS NOT COSMETIC.
 *
 * The ids below are authored as readable constants — `ws-personal`, `note-groceries` — and they
 * used to be written to the database exactly like that, on every install, everywhere. A Postgres
 * primary key is GLOBAL, so the first account ever to sync claimed `ws-personal` for the whole
 * server and no second account could create it again. The push came back
 * `duplicate key value violates unique constraint "workspaces_pkey"`, and because every note's
 * foreign key walks up to a workspace, RLS then refused every note hanging off it too. The account
 * did not fail to sync one row; it failed to sync anything, ever, with no way to recover.
 *
 * That is fatal in production the moment a second person installs the app — nothing to do with the
 * test accounts that surfaced it here.
 *
 * The token is minted once and kept, so re-seeding this install is still idempotent, and the
 * authored ids stay readable in this file and in the debugger.
 */
const TOKEN_KEY = 'seed.installToken';
const SEED_IDS_KEY = 'seed.ids';
const HOME_NOTE_KEY = 'seed.homeNoteId';

async function installToken(): Promise<string> {
  const existing = await db.meta.get(TOKEN_KEY);
  if (typeof existing?.value === 'string' && existing.value) return existing.value;
  const token = newId().slice(0, 8);
  await db.meta.put({ key: TOKEN_KEY, value: token });
  return token;
}

/** authored id → the id actually stored. Applied to ids AND to every reference to one. */
const scope = (token: string) => (id: string) => `${id}-${token}`;

/**
 * What a new install starts with: one empty workspace, and nothing to read.
 *
 * It used to start with the demo library below — six pages about somebody else's groceries and
 * somebody else's sprint. That was written when there was no backend and every screen needed rows
 * to render, and it long outlived the reason: a person opening this app for the first time is
 * handed a stranger's notes and has to work out which of it is theirs, or delete it page by page.
 *
 * It was also the root of a whole class of sync bug rather than an aesthetic problem. Two installs
 * each mint a starter library with ids of their own, so signing both into one account produces two
 * Personal workspaces and two of every page that no amount of merging can reconcile — the thing
 * `shelveUntouchedSeed` exists to catch after the fact. An empty install has nothing to collide
 * with, which removes the case instead of handling it.
 *
 * The one workspace is not a hedge. `createPage` needs somewhere to put a page and returns silently
 * without it (App.vue), so "blank" with no workspace at all is a New page button that does nothing.
 * An empty Personal space is the smallest thing that leaves the app working, and it is still a
 * seeded id — so it steps aside on its own if this device later signs into an account that already
 * has a library.
 */
export async function seedIfEmpty(): Promise<void> {
  const count = await db.workspaces.count();
  if (count > 0) return await migrateWorkspaces(); // already seeded — just top up new fields

  const token = await installToken();
  const id = scope(token)('ws-personal');

  await db.transaction('rw', db.workspaces, db.meta, async () => {
    await db.workspaces.put({
      id, ownerId: 'me', name: 'Personal', kind: 'personal', role: 'owner', membership: 'active',
      updatedAt: now, version: 1, syncedVersion: 0, dirty: 1 as const,
    } as never);
    /*
     * Recorded exactly as the demo library records its rows, and for the same reason: this is the
     * list sign-in reads to tell "the starter set nobody wrote in" from "things this person wrote
     * before they had an account". An empty workspace is firmly the former.
     *
     * No home note is recorded — there is no page to open, and `homeNoteId()` returning null is
     * already the case App.vue handles.
     */
    await db.meta.put({ key: SEED_IDS_KEY, value: [id] });
  });

  log.info('new install: an empty library');
}

/**
 * The demo library — Groceries, Week of 27 July, the flat inspection.
 *
 * DELIBERATELY NOT WIRED TO FIRST RUN any more; see `seedIfEmpty` above. It is kept because it is
 * the only fixture that exercises every page type, block type and property shape this app renders,
 * which makes it worth a "Load sample content" button in Settings — one call — rather than worth
 * deleting. Nothing calls it today.
 *
 * Note if you do wire it up: it OVERWRITES `seed.ids` rather than adding to it, so the empty
 * workspace `seedIfEmpty` made would drop off that list.
 */
export async function seedSampleLibrary(): Promise<void> {
  const token = await installToken();
  const s = scope(token);
  /*
   * Collected as the rows are written, then stored.
   *
   * This is what lets a SECOND device signing into the same account tell "the untouched starter
   * library, safe to discard" from "things this person wrote before signing in, which must be
   * pushed" — see `adoptServerLibrary` in core/sync/backfill.ts. Without the list, the two are
   * indistinguishable and the only safe choice is to keep both, which is how one account ends up
   * with two Personal workspaces.
   */
  const seeded: string[] = [];

  await db.transaction('rw', db.workspaces, db.notes, db.blocks, db.meta, async () => {
    // workspaces: one personal space you own, one shared group space you're a member of
    const workspaces = [
      { id: 'ws-personal', ownerId: 'me', name: 'Personal', kind: 'personal', role: 'owner', membership: 'active', updatedAt: now, version: 1, syncedVersion: 0, dirty: 1 as const },
      { id: 'ws-kernel', ownerId: 'maya', name: 'Kernel Labs', kind: 'shared', role: 'member', membership: 'active', updatedAt: now, version: 1, syncedVersion: 0, dirty: 1 as const },
    ];

    // notes — one of each type, matching the mockups
    const notes = [
      { id: 'note-groceries', workspaceId: 'ws-personal', title: 'Groceries', type: 'archive', archived: 0, favorite: 0, properties: { tags: ['household', 'recurring'] }, ...base },
      { id: 'note-week', workspaceId: 'ws-personal', title: 'Week of 27 July', type: 'planning', archived: 0, favorite: 0, properties: { range: '27 Jul – 2 Aug' }, ...base },
      { id: 'note-flat', workspaceId: 'ws-personal', title: 'Flat inspection', type: 'single', archived: 0, favorite: 0, properties: { tags: ['inspection', 'deposit'], edited: 'Edited yesterday · v3', status: 'Scheduled', owner: 'Aarav', ownerInitials: 'AR', due: 'Mon, 28 Jul', priority: 'high', linked: ['note-groceries', 'note-week'] }, ...base },
      { id: 'note-sync', workspaceId: 'ws-kernel', title: 'Sync engine spec', type: 'planning', archived: 0, favorite: 0, ...base },
      { id: 'note-triage', workspaceId: 'ws-kernel', title: 'Bug triage', type: 'archive', archived: 0, favorite: 0, ...base },
    ];

    // top-level task blocks for Groceries (the Archive list)
    const blocksGroceries = [
      block('blk-g1', 'note-groceries', null, 0, 'task', 'Coffee beans — the Ethiopian one', 0, { priority: 'medium', due: 'Sat, 26 Jul', tags: ['coffee', 'recurring'] }),
      block('blk-g2', 'note-groceries', null, 1, 'task', 'Oat milk × 4', 0, { tags: ['recurring'] }),
      block('blk-g3', 'note-groceries', null, 2, 'task', 'Filters for the AeroPress', 0, {}),
      block('blk-g4', 'note-groceries', null, 3, 'task', 'Dal, rice, and the good chilli powder', 0, { tags: ['pantry'] }),
      block('blk-g5', 'note-groceries', null, 4, 'task', 'Bin bags + dish soap', 1, {}), // done

      // child blocks of the coffee item → shown in the detail pane
      block('blk-g1-p', 'note-groceries', 'blk-g1', 0, 'paragraph', 'Whole bean, medium roast. The one Maya brought to the offsite — bag had a blue label. Ask them to grind for AeroPress if the burr grinder is still broken.', 0, {}),
      block('blk-g1-s1', 'note-groceries', 'blk-g1', 1, 'task', 'Check the roast date is under 3 weeks', 0, {}),
      block('blk-g1-s2', 'note-groceries', 'blk-g1', 2, 'task', 'Ask if they still stock the natural process', 0, {}),
      block('blk-g1-s3', 'note-groceries', 'blk-g1', 3, 'task', 'Budget: under ₹900', 0, {}),
    ];

    // Planning doc — "Week of 27 July" (mirrors mockup 2b)
    const blocksWeek = [
      block('blk-w-h1', 'note-week', null, 0, 'heading', 'Week of 27 July', 0, { level: 1, deck: 'Ship the sync queue, survive the flat inspection, and read something that isn’t a changelog.' }),
      block('blk-w-h2a', 'note-week', null, 1, 'heading', 'Must land this week', 0, { level: 2, counter: true }),
      block('blk-w-t1', 'note-week', null, 2, 'task', 'Finish the sync queue flush + backoff', 0, { priority: 'high', due: 'Fri, 31 Jul', assignee: 'MK' }),
      block('blk-w-t1s', 'note-week', 'blk-w-t1', 0, 'task', 'Jittered backoff, capped at 5 min', 0, {}),
      block('blk-w-t2', 'note-week', null, 3, 'task', 'Flat inspection — be home by 6', 0, { priority: 'medium', due: 'Today, 18:00' }),
      block('blk-w-t3', 'note-week', null, 4, 'task', 'Order the standing desk riser', 0, {}),
      block('blk-w-h2b', 'note-week', null, 5, 'heading', 'Notes from the spec review', 0, { level: 2 }),
      block('blk-w-p1', 'note-week', null, 6, 'paragraph', 'The client is immediately consistent; the server is eventually consistent. Every row below is its own block — the note itself holds no content.', 0, {}),
      block('blk-w-call', 'note-week', null, 7, 'callout', 'Decide the batch-compression threshold before Phase 3 starts, or the Edge Function contract changes twice.', 0, { tone: 'warn' }),
      block('blk-w-q', 'note-week', null, 8, 'quote', 'An operation leaves the queue only after a confirmed server ACK.', 0, { attribution: 'sync-engine.md, §6.1' }),
      block('blk-w-ul', 'note-week', null, 9, 'bulleted', '', 0, { items: ['Conflicts stay narrow because entities are blocks, not documents', 'Last-writer-wins for trivial fields; prompt for real content collisions'] }),
      block('blk-w-ol', 'note-week', null, 10, 'numbered', '', 0, { items: ['Write locally, then queue the operation', 'Emit the event — sync, search and activity all subscribe', 'Flush the batch when the network returns'] }),
      block('blk-w-tog', 'note-week', null, 11, 'toggle', 'Open questions for Maya', 0, { count: 3, items: ['Do we compress before or after signing?', 'Retry cap — 5 min or exponential to 30?', 'Who owns the Edge Function contract doc?'] }),
      block('blk-w-code', 'note-week', null, 12, 'code', '', 0, { language: 'TypeScript', filename: 'core/db/schema.ts', code: "db.version(1).stores({\n  notes:      'id, workspaceId, updatedAt',\n  blocks:     'id, noteId, parentBlock, position',\n  sync_queue: 'id, entity, status, createdAt',\n});" }),
      block('blk-w-h2c', 'note-week', null, 13, 'heading', 'Phase table', 0, { level: 2 }),
      block('blk-w-tbl', 'note-week', null, 14, 'table', '', 0, { headers: ['Phase', 'Target', 'Status'], rows: [['2 — Sync engine', '8 Aug', 'In progress'], ['3 — Supabase + RLS', '22 Aug', 'Queued']] }),
      block('blk-w-h2d', 'note-week', null, 15, 'heading', 'References', 0, { level: 2 }),
      block('blk-w-bm', 'note-week', null, 16, 'bookmark', '', 0, { title: 'Dexie.js — liveQuery reference', url: 'dexie.org/docs/liveQuery()' }),
      block('blk-w-img', 'note-week', null, 17, 'image', '', 0, { caption: 'Image block — whiteboard photo from the review' }),
      block('blk-w-div', 'note-week', null, 18, 'divider', '', 0, {}),
    ];

    // Single doc — "Flat inspection" (mirrors mockup 2c: one item, decision callout)
    const blocksFlat = [
      block('blk-f-t1', 'note-flat', null, 0, 'task', 'Photograph the water damage by the window', 0, { priority: 'high', due: 'Mon, 28 Jul' }),
      block('blk-f-t2', 'note-flat', null, 1, 'task', 'Confirm the deposit-return timeline in writing', 0, {}),
      block('blk-f-p', 'note-flat', null, 2, 'paragraph', 'The agent said the cleaning charge stands unless we show the flat was professionally cleaned. We have the receipt from March, so the charge shouldn’t apply.', 0, {}),
      block('blk-f-call', 'note-flat', null, 3, 'callout', 'Decision: dispute the cleaning charge — attach the March receipt.', 0, { tone: 'success' }),
      block('blk-f-q', 'note-flat', null, 4, 'quote', 'Keep it factual and short; attach evidence, not opinions.', 0, { attribution: 'Tenancy notes' }),
      block('blk-f-div', 'note-flat', null, 5, 'divider', '', 0, {}),
    ];

    /*
     * Rewrite every id and every reference to one, in one pass, immediately before writing.
     *
     * Done here rather than by editing the ~50 literals above on purpose: the rows cross-reference
     * each other five different ways (`workspaceId`, `noteId`, `parentBlock`, `properties.linked`),
     * and a hand-edited suffix missed on ONE of them produces a note in a workspace that does not
     * exist, or a block orphaned from its parent. That failure is silent — the row is simply not
     * rendered — and it would be indistinguishable from the seed not having run.
     */
    const scopedWorkspaces = workspaces.map((w) => ({ ...w, id: s(w.id) }));
    const scopedNotes = notes.map((note) => {
      // two of the seeded notes carry no `properties` at all, so this is read off a loose record
      // rather than a union that only sometimes has the key
      const n = note as Record<string, unknown> & { id: string; workspaceId: string };
      const props = n.properties as Record<string, unknown> | undefined;
      // `linked` holds NOTE IDS — the one place a reference hides inside free-form JSON, and the
      // one most easily missed, because a stale link renders as a dead "Linked pages" chip rather
      // than as an error
      const linked = props?.linked;
      return {
        ...n,
        id: s(n.id),
        workspaceId: s(n.workspaceId),
        ...(Array.isArray(linked) ? { properties: { ...props, linked: (linked as string[]).map(s) } } : {}),
      };
    });
    const scopedBlocks = [...blocksGroceries, ...blocksWeek, ...blocksFlat].map((b) => ({
      ...b,
      id: s(b.id),
      noteId: s(b.noteId),
      parentBlock: b.parentBlock ? s(b.parentBlock) : null,
    }));

    await db.workspaces.bulkPut(scopedWorkspaces as never);
    await db.notes.bulkPut(scopedNotes as never);
    await db.blocks.bulkPut(scopedBlocks as never);

    seeded.push(
      ...scopedWorkspaces.map((w) => w.id),
      ...scopedNotes.map((n) => n.id),
      ...scopedBlocks.map((b) => b.id),
    );
    await db.meta.put({ key: SEED_IDS_KEY, value: seeded });
    /*
     * Which page a fresh install opens on.
     *
     * `ui.store` used to hardcode `note-groceries`, which only worked because that id was identical
     * everywhere. Recording it here keeps the same opening page without a literal — and it has to
     * be recorded rather than derived, because the obvious derivation is wrong: Dexie returns rows
     * in primary-key order, so "the first workspace" is `ws-kernel-…` sorting before
     * `ws-personal-…`, and the app would open a SHARED space's planning doc instead of your own.
     */
    await db.meta.put({ key: HOME_NOTE_KEY, value: s('note-groceries') });
  });
}

/** the note a fresh install opens on, if this install was seeded at all */
export async function homeNoteId(): Promise<string | null> {
  const row = await db.meta.get(HOME_NOTE_KEY);
  return typeof row?.value === 'string' ? row.value : null;
}

/**
 * The ids this install seeded, or an empty list once anything has replaced them.
 *
 * Read by the sign-in path to decide whether the local library is still the untouched starter set.
 */
export async function seededIds(): Promise<string[]> {
  const row = await db.meta.get(SEED_IDS_KEY);
  return Array.isArray(row?.value) ? (row.value as string[]) : [];
}

/**
 * WHAT USED TO BE HERE: `discardUntouchedSeed()`.
 *
 * It answered "is the starter library still the starter library, and has the account got one of its
 * own?" and, if both were yes, DELETED the seeded rows outright. Two things were wrong with that.
 *
 * The inference: "the account has a library" was read as `syncedVersion > 0` on some local row —
 * a value set both by a pull applying somebody else's row and by your own push coming back
 * acknowledged. A device that flushed its seed a moment earlier read its own acknowledgements as
 * the account's library and deleted the library it had just uploaded.
 *
 * The remedy: deletion. Even with the inference fixed, the worst case of getting it wrong was
 * permanent, which is far too sharp an edge for a question decided by heuristics at sign-in.
 *
 * Both are now handled by the quarantine shelf (core/sync/quarantine.ts): the local library is set
 * ASIDE rather than destroyed, pushing is held while it sits there, and a person decides — with the
 * rows in front of them — whether to restore, export or discard it. `seededIds()` above is still
 * how "which of these did nobody write?" is answered; it is passed to `shelveLibrary` so an
 * untouched starter set can be shelved quietly instead of raising a banner nobody needs.
 */

/**
 * The id of this install's personal workspace.
 *
 * Looked up by `kind`, never by a constant. `ws-personal` was hardcoded in three places and is now
 * install-specific, but more to the point the constant was always the wrong question: the schema
 * already records which workspace is personal, so asking the data is both correct and survives an
 * imported or pulled library that this install never seeded.
 *
 * Which one, when a device holds two, is `canonicalPersonal`'s answer and not this function's — the
 * sidebar draws its one PERSONAL section from the same rule, and a new page appearing under a
 * heading other than the one it was created from would be the two rules disagreeing on screen. It
 * also settles the duplicate over time: pages written from here on go into the workspace the account
 * already has, rather than deeper into the one only this device knows about.
 *
 * Falls back to the oldest workspace so a library that arrived entirely by sync — where nothing is
 * marked `personal` — still has somewhere to put a new page, rather than throwing at the moment
 * someone presses "New page".
 */
export async function personalWorkspaceId(): Promise<string | null> {
  const all = await db.workspaces.toArray();
  const personal = canonicalPersonal(all);
  if (personal) return personal.id;
  const oldest = all.sort((a, b) => a.updatedAt - b.updatedAt)[0];
  return oldest?.id ?? null;
}

function block(
  id: string, noteId: string, parentBlock: string | null, position: number, type: string,
  text: string, checked: 0 | 1, props: Record<string, unknown>,
) {
  return { id, noteId, parentBlock, position, type, text, checked, props, ...base };
}
