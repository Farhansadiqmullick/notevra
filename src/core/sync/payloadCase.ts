/**
 * The one place the client's vocabulary and Postgres's vocabulary are translated into each other.
 *
 * The divergences are deliberate and documented in `supabase/migrations/…_init_schema.sql`: Dexie
 * cannot index a boolean so `checked` is `0 | 1`, and Postgres folds unquoted identifiers to lower
 * case so `parentBlock` would need double quotes in every policy and index forever. Rather than
 * bend either side, the transport renames — which is why this is TypeScript and not SQL. It is one
 * function each way and can be tested without a database.
 *
 * TWO RULES THAT MATTER MORE THAN THEY LOOK:
 *
 * 1. **The map is explicit, not a camelCase→snake_case algorithm.** A generic converter renames
 *    every key it is handed, including ones it has never heard of — so the day someone adds a field
 *    it is silently renamed on the way out and back, and the bug shows up as data that syncs but
 *    arrives under a key nothing reads. An explicit table passes unknown keys through untouched,
 *    which is the failure mode you can see.
 *
 * 2. **`props` and `properties` are opaque.** They hold the USER's JSON — a due date, a language, a
 *    table's headers — and their inner keys are not ours to rename. Running the converter into them
 *    would turn `props.dueDate` into `props.due_date` on one device and back into something else on
 *    the next, quietly rewriting the shape every screen reads.
 */

/** client name → server name. Everything absent from this table is already identical on both sides. */
const TO_SERVER: Record<string, string> = {
  noteId: 'note_id',
  parentBlock: 'parent_block',
  workspaceId: 'workspace_id',
  ownerId: 'owner_id',
  blockId: 'block_id',
  storageKey: 'storage_key',
  deletedAt: 'deleted_at',
  updatedAt: 'updated_at',
  createdAt: 'created_at',
};

const TO_CLIENT: Record<string, string> = Object.fromEntries(
  Object.entries(TO_SERVER).map(([client, server]) => [server, client]),
);

/** `0 | 1` here, `boolean` there — see divergence (1) in the migration */
const BOOLEANS = new Set(['checked', 'archived', 'favorite']);

/** user JSON: renamed as a key, never descended into */
const OPAQUE = new Set(['props', 'properties']);

/** epoch milliseconds here, `timestamptz` there — client-side names */
const TIMESTAMPS = new Set(['deletedAt', 'updatedAt', 'createdAt']);

/**
 * Bookkeeping the client keeps for itself, stripped out of a server ROW before anyone compares it
 * to a local one. `version` already travels as `serverVersion` on the outcome, and `updated_at` /
 * `created_at` are set by the server's own clock on every write — so all three differ from the
 * local copy *always*, and leaving them in makes the conflict dialog list four differences where
 * the user made one.
 */
const NOT_CONTENT = new Set(['version', 'updatedAt', 'createdAt']);

export type Payload = Record<string, unknown>;

/** An operation payload on its way to Postgres. */
export function toServerPayload(payload: Payload): Payload {
  const out: Payload = {};
  for (const [key, value] of Object.entries(payload)) {
    const name = TO_SERVER[key] ?? key;
    // `0 | 1` only — a value that is already a boolean, or is neither, is passed through as it is
    out[name] = BOOLEANS.has(key) && (value === 0 || value === 1) ? value === 1 : value;
  }
  return out;
}

/**
 * An operation payload on its way back.
 *
 * Two shapes arrive here and both are handled: an operation payload that this app pushed earlier
 * (numbers for timestamps, because that is what was sent), and a real Postgres ROW carried on a
 * conflict outcome (ISO 8601 strings, because that is what `to_jsonb` produces). Parsing only
 * strings leaves the first shape alone.
 */
export function toClientPayload(payload: Payload): Payload {
  const out: Payload = {};
  for (const [key, value] of Object.entries(payload)) {
    const name = TO_CLIENT[key] ?? key;
    if (OPAQUE.has(name)) {
      out[name] = value;
    } else if (BOOLEANS.has(name) && typeof value === 'boolean') {
      out[name] = value ? 1 : 0;
    } else if (TIMESTAMPS.has(name) && typeof value === 'string') {
      const ms = Date.parse(value);
      out[name] = Number.isNaN(ms) ? value : ms;
    } else {
      out[name] = value;
    }
  }
  return out;
}

/**
 * A server row, as the conflict dialog should see it: the client's vocabulary, content only.
 *
 * The dialog diffs this against the operation the user was trying to send, key by key. Without the
 * rename every single field would read as a difference (`note_id` vs `noteId`), and without the
 * strip the three bookkeeping fields would be differences on every conflict there has ever been.
 */
export function toServerRow(row: Payload): Payload {
  const converted = toClientPayload(row);
  for (const key of NOT_CONTENT) delete converted[key];
  return converted;
}
