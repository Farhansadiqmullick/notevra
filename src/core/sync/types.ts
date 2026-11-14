/**
 * Sync contracts (ARCHITECTURE.md §6, §7.3).
 *
 * The engine talks to a `SyncTransport`, never to Supabase. Supabase is *an implementation* of this
 * interface — so the engine can be built and fully tested now, against an in-memory server, and the
 * cloud can be swapped in later without the engine changing.
 *
 * Sync is OPERATION-based, not row-based: we ship "UpdateBlock {id, text}", not the whole block.
 * That's what makes two people editing different fields of the same block a non-event.
 */

/** One queued operation, as it goes over the wire. */
export interface Operation {
  /** the sync_queue row id — the server echoes it back so we know what was acknowledged */
  id: string;
  entity: string; // 'block' | 'note' | 'workspace'
  entityId: string;
  type: string; // 'CreateBlock' | 'UpdateBlock' | 'MoveBlock' | 'DeleteBlock' | …
  payload: Record<string, unknown>;
  /** the local version this operation produced — the server compares it to its own */
  version: number;
  createdAt: number;
}

/**
 * What the server decided about one pushed operation.
 *
 * `conflict` carries the server's side so the user can be offered a real choice ("keep mine" /
 * "keep theirs") instead of a merge dialog full of Git vocabulary.
 */
export type PushOutcome =
  | { id: string; status: 'ack'; version: number }
  | { id: string; status: 'conflict'; serverVersion: number; serverPayload: Record<string, unknown> }
  /**
   * The entity this operation edits was DELETED by someone else
   * (design/data-safety-and-identity.md §2).
   *
   * This is its own outcome rather than an `ack` or a `rejected`, because both of those lose the
   * edit silently: acking pretends the write landed on a row nobody will ever see again, and
   * rejecting retries forever against a row that is never coming back. Only a person knows whether
   * "I was still writing that" beats "I meant to remove it", so it parks like a conflict and asks.
   */
  | { id: string; status: 'deleted'; serverVersion: number; deletedAt: number; deletedBy?: string }
  | { id: string; status: 'rejected'; reason: string };

export interface PushResult {
  outcomes: PushOutcome[];
}

export interface PullResult {
  ops: Operation[];
  /** cursor to store in meta.lastPulledAt — pass it back on the next pull */
  cursor: number;
}

export interface SyncTransport {
  /** for logs and the Settings screen ("Mock server", "Supabase") */
  readonly name: string;
  /**
   * Send a batch. MUST resolve with one outcome per operation, or REJECT if the batch never
   * reached the server — a rejection means "unknown", and unknown operations stay queued.
   */
  push(ops: Operation[]): Promise<PushResult>;
  /** Everything that happened elsewhere since `cursor`. */
  pull(cursor: number, limit?: number): Promise<PullResult>;
}

/**
 * The answers a person can give a parked conflict (design/conflict-keep-both.md).
 *
 * `both` is not a merge — it keeps the server's copy on the original row and puts your version in a
 * NEW block below it. Two blocks, two authors, nothing invented.
 *
 * `merged` is the one answer where the app invents nothing BECAUSE A PERSON WROTE IT. The dialog
 * hands over both sides with git-style markers around the part that actually differs; whatever comes
 * back is pushed as the resolution. It behaves exactly like `mine` from there on — the merged text
 * IS your version now — which is the only rule that keeps this explainable.
 */
export type ConflictKeep = 'mine' | 'theirs' | 'both' | 'merged';

/** Extra capabilities and answers a resolution may need. */
export interface ResolveOptions {
  /** required for `both`; see ForkConflict */
  fork?: ForkConflict;
  /**
   * Required for `merged`: fields to override on the operation before it is re-queued. A partial
   * payload rather than a bare string, because which field is being merged (`text` on a block,
   * `title` on a page) is the DIALOG's business — the engine has no opinion about it.
   */
  merged?: Record<string, unknown>;
}

/**
 * How `both` gets its copy made. The engine lives in core/ and must not import services/, so the
 * ability to write a block is injected — the same trick as `SyncTransport`.
 */
export type ForkConflict = (row: ForkSubject) => Promise<void>;

/**
 * The three things a fork actually needs, named separately from the row that carries them.
 *
 * A conflict lived on an outbox row under the queue model and lives in its own table under the
 * state model, and the fork does not care which — it needs what to copy and where to put it.
 * Typing this against either row shape would have coupled the dialog to a storage decision it has
 * no stake in.
 */
export interface ForkSubject {
  entity: string;
  entityId: string;
  /** the version of the fields you wrote — what the copy is made FROM */
  localPayload: Record<string, unknown>;
}

/** A conflict the user still has to decide about; parked in the queue row until they do. */
export interface ConflictInfo {
  serverVersion: number;
  serverPayload: Record<string, unknown>;
  at: number;
  /**
   * 'version' — both sides edited, pick one.
   * 'deleted' — the other side removed the thing you edited; the choice is resurrect or accept.
   * Absent means 'version' (rows parked before this existed).
   */
  kind?: 'version' | 'deleted';
  /** when the other side deleted it, for 'deleted' conflicts */
  deletedAt?: number;
}
