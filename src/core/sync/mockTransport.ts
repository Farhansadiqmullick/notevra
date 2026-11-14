/**
 * MockTransport — an in-memory server, good enough to prove the engine before Supabase exists.
 *
 * It's not a stub that always says yes. The hard parts of sync are the failures, so this one can be
 * told to produce them on demand: network errors, ACK loss (the server applied the write but the
 * response never arrived — the case that makes naive engines lose data or duplicate it), version
 * conflicts, and latency. The engine's test suite drives all of them through here.
 *
 * It also keeps a durable-ish op log so `pull` can hand back "what other devices did", which is how
 * inbound sync gets tested without a second browser.
 */
import type { Operation, PullResult, PushResult, PushOutcome, SyncTransport } from './types';

export interface MockOptions {
  /** artificial round-trip time */
  latencyMs?: number;
}

export class MockTransport implements SyncTransport {
  readonly name = 'Mock server';

  /** the server's operation log — what a real `sync_events` table would hold */
  readonly log: Operation[] = [];
  /** highest version the server has seen per entity, for conflict detection */
  readonly versions = new Map<string, number>();

  /** fail the next N pushes with a network error (batch never lands) */
  failNext = 0;
  /** apply the next N pushes but reject the response — the ACK-loss case */
  dropAckNext = 0;
  /** entityIds the server should report a conflict for, with the version it holds */
  conflicts = new Map<string, { version: number; payload: Record<string, unknown> }>();
  /** operations the server rejects outright, by entityId */
  rejects = new Map<string, string>();
  /** entityIds someone else deleted on the server, with the version and time of that delete */
  deleted = new Map<string, { version: number; at: number }>();

  pushes = 0;
  pulls = 0;

  constructor(private opts: MockOptions = {}) {}

  private wait() {
    const ms = this.opts.latencyMs ?? 0;
    return ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  async push(ops: Operation[]): Promise<PushResult> {
    this.pushes++;
    await this.wait();

    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('network unreachable');
    }

    // apply first, answer second — the same order a real server uses, which is exactly why an ACK
    // can be lost after the write has already happened
    const outcomes: PushOutcome[] = ops.map((op) => {
      // checked before the version conflict: a row that is gone can't have a version clash, and
      // reporting one would send the user a dialog offering to keep text nothing will ever show
      // a second delete is agreement, not a clash — only an EDIT of a removed row is the conflict
      const gone = this.deleted.get(op.entityId);
      /*
       * An undelete is recognised by the OPERATION, not by a null in the payload.
       *
       * It used to be `'deletedAt' in payload && payload.deletedAt === null`, which worked only
       * because operation payloads were narrow: a queued `UpdateBlock` mentioned `deletedAt`
       * exactly when somebody meant it. The state model pushes whole rows, so every live row
       * carries `deletedAt: null` — and under that heuristic every ordinary edit read as "bring it
       * back", which silently turned a deletion-elsewhere conflict into an accepted resurrection.
       *
       * It also brings this mock into line with `sync_push`, which has no payload heuristic at all
       * and decides purely on the operation type. A test server that is more permissive than the
       * real one is worse than no test server.
       */
      const undelete = op.type.startsWith('Restore');
      if (gone && !op.type.startsWith('Delete') && !undelete) {
        return { id: op.id, status: 'deleted' as const, serverVersion: gone.version, deletedAt: gone.at };
      }
      const conflict = this.conflicts.get(op.entityId);
      if (conflict && op.version <= conflict.version) {
        return {
          id: op.id,
          status: 'conflict' as const,
          serverVersion: conflict.version,
          serverPayload: conflict.payload,
        };
      }
      const reason = this.rejects.get(op.entityId);
      if (reason) return { id: op.id, status: 'rejected' as const, reason };

      this.log.push({ ...op });
      this.versions.set(op.entityId, op.version);
      // an accepted undelete brings the row back, so it must stop reporting as deleted
      if (undelete) this.deleted.delete(op.entityId);
      if (op.type.startsWith('Delete')) this.deleted.set(op.entityId, { version: op.version, at: op.createdAt });
      return { id: op.id, status: 'ack' as const, version: op.version };
    });

    if (this.dropAckNext > 0) {
      this.dropAckNext--;
      throw new Error('connection reset after write'); // applied, but the client never hears it
    }

    return { outcomes };
  }

  async pull(cursor: number, limit = 100): Promise<PullResult> {
    this.pulls++;
    await this.wait();
    const ops = this.log.filter((o) => o.createdAt > cursor).slice(0, limit);
    return { ops, cursor: ops.length ? ops[ops.length - 1].createdAt : cursor };
  }

  /** test helper: pretend another device did something */
  seedRemote(op: Operation) {
    this.log.push(op);
    this.versions.set(op.entityId, op.version);
  }
}
