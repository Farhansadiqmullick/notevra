/**
 * quarantine — the shelf this device puts a library on when it changes hands.
 *
 * ── The problem it removes ───────────────────────────────────────────────────────────────────────
 *
 * Signing into an account the local database does not belong to used to offer two answers, and both
 * were wrong. Push the local library into the new account, and a shared browser uploads one
 * person's notes into another person's account — and two starter libraries with per-install ids
 * become two Personal workspaces that can never merge. Delete it, and you are destroying the only
 * copy of something that was never on a server: `discardUntouchedSeed` did exactly that, on an
 * inference that turned out to be wrong, and emptied a browser.
 *
 * A shelf makes the question reversible. Rows move here whole, the screen is clear for the
 * account's own library to arrive, and nothing has been decided yet. The decision can then be taken
 * calmly, from a settings screen, by somebody who can see what is on the shelf — instead of at
 * sign-in by code guessing from timestamps.
 *
 * ── The rule that gives the shelf its meaning ────────────────────────────────────────────────────
 *
 * **While real work sits here, this device does not push.** Not a safety interlock bolted on — it
 * is what makes setting rows aside honest. A device that quarantined your notes and carried on
 * uploading everything else would have quietly decided the question it claimed to be asking. So
 * `blocking()` holds the push half until the shelf is cleared, the sidebar says so in place of
 * "All changes synced", and pulling continues throughout: reading is how the account's library
 * arrives, and it takes nothing away.
 *
 * Demo rows are exempt from the hold. A starter library nobody wrote in is not work, and stopping
 * sync to ask about it would make a correct rule into an irritating one. They are still shelved and
 * still recoverable — they simply do not raise the banner.
 */
import { db, type BlockRow, type NoteRow, type QuarantineRow, type TombstoneRow, type WorkspaceRow } from '@/core/db/schema';
import { logger } from '@/core/logging/logger';
import { markLocalWrite } from './dirty';

const log = logger.scoped('quarantine');

type Entity = QuarantineRow['entity'];
type AnyRow = WorkspaceRow | NoteRow | BlockRow | TombstoneRow;

const keyOf = (entity: Entity, id: string) => `${entity}:${id}`;

/**
 * Cached so `blocking()` can be asked on every flush without a database read.
 *
 * `null` means "not looked yet" rather than "nothing there" — a device that booted with a full
 * shelf must not push while the first read is still in flight. Every mutation below refreshes it,
 * so it cannot drift from the table it describes.
 */
let blockingCache: boolean | null = null;

/** Does real work sit on the shelf? Demo rows do not count. */
export async function blocking(): Promise<boolean> {
  if (blockingCache === null) await refreshBlocking();
  return blockingCache === true;
}

async function refreshBlocking(): Promise<void> {
  blockingCache = (await db.quarantine.filter((r) => r.demo === 0).count()) > 0;
}

/** Warm the cache at boot, before the engine's first flush can ask. */
export async function initQuarantine(): Promise<void> {
  await refreshBlocking();
}

export interface ShelfSummary {
  total: number;
  /** rows that are somebody's work — the ones that hold up syncing */
  real: number;
  demo: number;
  notes: number;
  blocks: number;
  workspaces: number;
  /** which account wrote what is on the shelf */
  accounts: (string | null)[];
  at: number | null;
}

export async function summary(): Promise<ShelfSummary> {
  const rows = await db.quarantine.toArray();
  return {
    total: rows.length,
    real: rows.filter((r) => r.demo === 0).length,
    demo: rows.filter((r) => r.demo === 1).length,
    notes: rows.filter((r) => r.entity === 'note').length,
    blocks: rows.filter((r) => r.entity === 'block').length,
    workspaces: rows.filter((r) => r.entity === 'workspace').length,
    accounts: [...new Set(rows.map((r) => r.account))],
    at: rows.length ? Math.min(...rows.map((r) => r.at)) : null,
  };
}

/** What to show on the resolve screen — notes first, since those are what a person recognises. */
export async function shelved(limit = 200): Promise<QuarantineRow[]> {
  const rows = await db.quarantine.orderBy('at').limit(limit).toArray();
  const rank: Record<Entity, number> = { workspace: 0, note: 1, block: 2, tombstone: 3 };
  return rows.sort((a, b) => rank[a.entity] - rank[b.entity] || a.at - b.at);
}

/* ---------- putting things on the shelf ---------- */

/**
 * Move this device's whole library onto the shelf.
 *
 * One transaction across every table involved, because a half-shelved library is the worst of both
 * outcomes: notes gone from the sidebar while their blocks are still collected for pushing, or
 * workspaces set aside while the notes that hang off them remain and render into nothing.
 *
 * `demo` marks rows the starter seed created and nobody has since edited. They are shelved on the
 * same terms as everything else — recoverable, exportable — and exempt from the hold on pushing.
 */
export async function shelveLibrary(args: {
  account: string | null;
  seededIds: string[];
}): Promise<ShelfSummary> {
  const seeded = new Set(args.seededIds);
  const at = Date.now();

  await db.transaction(
    'rw',
    [db.workspaces, db.notes, db.blocks, db.tombstones, db.quarantine],
    async () => {
      const [workspaces, notes, blocks, tombstones] = await Promise.all([
        db.workspaces.toArray(),
        db.notes.toArray(),
        db.blocks.toArray(),
        db.tombstones.toArray(),
      ]);

      const entries: QuarantineRow[] = [
        ...workspaces.map((r) => entry('workspace', r, r.name, seeded, args.account, at)),
        ...notes.map((r) => entry('note', r, r.title, seeded, args.account, at)),
        ...blocks.map((r) => entry('block', r, r.text ?? '', seeded, args.account, at)),
        ...tombstones.map((r) => entry('tombstone', r, `deleted ${r.entity}`, seeded, args.account, at)),
      ];

      await db.quarantine.bulkPut(entries);
      await Promise.all([
        db.workspaces.bulkDelete(workspaces.map((r) => r.id)),
        db.notes.bulkDelete(notes.map((r) => r.id)),
        db.blocks.bulkDelete(blocks.map((r) => r.id)),
        db.tombstones.bulkDelete(tombstones.map((r) => r.id)),
      ]);
    },
  );

  await refreshBlocking();
  const s = await summary();
  log.info('set this device’s library aside', { total: s.total, real: s.real, demo: s.demo });
  return s;
}

/**
 * Set aside a starter library that the account has made redundant — the replacement for
 * `discardUntouchedSeed`, with its two faults corrected.
 *
 * The situation is a device joining an account that already has a library: it booted with a starter
 * set of its own, ids are minted per install so the two can never merge, and pushing both gives the
 * account two Personal workspaces and two of every demo page. Something has to go, and it should be
 * the one nobody wrote.
 *
 * ── The two corrections ──────────────────────────────────────────────────────────────────────────
 *
 * **`appliedFromServer` is passed in, not inferred.** The old version asked the rows — "something
 * here has `syncedVersion > 0`, so a library must have arrived" — which is equally true of this
 * device's own push coming back acknowledged. A browser read its own acknowledgements as the
 * account's library and deleted the library it had just uploaded. A count returned by `pull()`
 * cannot be forged by a push, because a push does not produce one.
 *
 * **The rows are shelved, not deleted.** Marked `demo`, so they neither raise the banner nor hold
 * up syncing; still on the shelf, so a wrong call here is recoverable rather than final.
 *
 * Both guards below have to hold. A starter page somebody has written in is their work whatever its
 * id says, and a page they wrote themselves is not a seeded id at all — either one means this
 * device is carrying something of its own, and then nothing here is redundant.
 */
export async function shelveUntouchedSeed(args: {
  account: string | null;
  seededIds: string[];
  appliedFromServer: number;
  serverCursor: number;
}): Promise<number> {
  /*
   * Either piece of evidence will do, and needing the second one is a lesson about what `applied`
   * actually measures.
   *
   * `appliedFromServer` is what THIS CALL wrote. A pull also runs on a twenty-second timer, so when
   * that one gets there first it applies the account's library and sign-in's own pull — working
   * perfectly, moments later — correctly applies nothing. Reading that zero as "the account is
   * empty" left a device showing two Personal workspaces and two of every starter page, which is
   * the exact outcome this function exists to prevent, produced by a pull that had just succeeded.
   *
   * The cursor does not have that problem. `sync_pull` excludes this device's own operations, so a
   * cursor above zero means another device has put a library in this account — a fact that survives
   * whichever pull happened to notice it, and one this device cannot manufacture by pushing.
   */
  if (!args.appliedFromServer && args.serverCursor <= 0) return 0; // the account has nothing of its own
  if (!args.seededIds.length) return 0; // never seeded: an import, or a library that arrived by sync

  const seeded = new Set(args.seededIds);
  const [workspaces, notes, blocks] = await Promise.all([
    db.workspaces.toArray(),
    db.notes.toArray(),
    db.blocks.toArray(),
  ]);
  const all = [...workspaces, ...notes, ...blocks];

  const everySeededRowUntouched = args.seededIds.every((id) => {
    const row = all.find((r) => r.id === id);
    return !row || (row.version === 1 && !(row as NoteRow).deletedAt);
  });
  // anything unsent that the seed did not create is this person's own work, made on this device
  const wroteSomething = all.some((r) => r.syncedVersion === 0 && !seeded.has(r.id));
  if (!everySeededRowUntouched || wroteSomething) return 0;

  const at = Date.now();
  const entries: QuarantineRow[] = [];
  const ids = { workspaces: [] as string[], notes: [] as string[], blocks: [] as string[] };

  for (const r of workspaces.filter((r) => seeded.has(r.id))) {
    entries.push(entry('workspace', r, r.name, seeded, args.account, at));
    ids.workspaces.push(r.id);
  }
  for (const r of notes.filter((r) => seeded.has(r.id))) {
    entries.push(entry('note', r, r.title, seeded, args.account, at));
    ids.notes.push(r.id);
  }
  for (const r of blocks.filter((r) => seeded.has(r.id))) {
    entries.push(entry('block', r, r.text ?? '', seeded, args.account, at));
    ids.blocks.push(r.id);
  }
  if (!entries.length) return 0;

  await db.transaction('rw', [db.workspaces, db.notes, db.blocks, db.quarantine], async () => {
    await db.quarantine.bulkPut(entries);
    await Promise.all([
      db.workspaces.bulkDelete(ids.workspaces),
      db.notes.bulkDelete(ids.notes),
      db.blocks.bulkDelete(ids.blocks),
    ]);
  });

  await refreshBlocking();
  log.info('the account had its own library; this device’s starter set stepped aside', {
    rows: entries.length,
  });
  return entries.length;
}

function entry(
  entity: Entity,
  row: AnyRow,
  label: string,
  seeded: Set<string>,
  account: string | null,
  at: number,
): QuarantineRow {
  /*
   * "Demo" is the seed's id AND an untouched version. A starter page somebody has written in is
   * their work whatever its id says, and the version is the only field that knows the difference.
   */
  const untouchedSeed = seeded.has(row.id) && row.version === 1;
  return {
    key: keyOf(entity, row.id),
    entity,
    id: row.id,
    row,
    label: (label || '').slice(0, 120),
    account,
    demo: untouchedSeed ? 1 : 0,
    at,
  };
}

/* ---------- taking things off it ---------- */

/**
 * Put the shelf back into the library, as this account's content.
 *
 * Restored rows are marked as never sent — `syncedVersion` stays where it was but `version` is
 * bumped through `markLocalWrite`, so they go up as this account's own writing. That is the honest
 * reading of the action: you are not re-attaching them to the account that wrote them, you are
 * adopting them into the one signed in now.
 */
export async function restoreAll(): Promise<number> {
  const rows = await db.quarantine.toArray();
  if (!rows.length) return 0;

  await db.transaction(
    'rw',
    [db.workspaces, db.notes, db.blocks, db.tombstones, db.quarantine],
    async () => {
      for (const q of rows) {
        const original = q.row as AnyRow;
        const restored = { ...original, syncedVersion: 0, ...markLocalWrite(original.version) };
        if (q.entity === 'workspace') await db.workspaces.put(restored as WorkspaceRow);
        else if (q.entity === 'note') await db.notes.put(restored as NoteRow);
        else if (q.entity === 'block') await db.blocks.put(restored as BlockRow);
        else await db.tombstones.put(restored as TombstoneRow);
      }
      await db.quarantine.clear();
    },
  );

  await refreshBlocking();
  log.info('restored the shelf into this account', { rows: rows.length });
  return rows.length;
}

/**
 * Empty the shelf for good.
 *
 * The only destructive operation in this file, and it is reachable exactly one way: a person
 * pressing a button that says so, having been shown what is on the shelf and offered an export
 * first. Nothing here ever calls it on anybody's behalf.
 */
export async function discardAll(): Promise<number> {
  const n = await db.quarantine.count();
  await db.quarantine.clear();
  await refreshBlocking();
  log.info('discarded the shelf', { rows: n });
  return n;
}

/**
 * Clear only the demo rows.
 *
 * Used when the shelf holds nothing but a starter library: there is nothing for a person to decide,
 * so it is tidied away rather than left to accumulate across sign-ins.
 */
export async function discardDemo(): Promise<number> {
  const keys = await db.quarantine.filter((r) => r.demo === 1).primaryKeys();
  if (keys.length) await db.quarantine.bulkDelete(keys as string[]);
  await refreshBlocking();
  return keys.length;
}
