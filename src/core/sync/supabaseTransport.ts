/**
 * SupabaseTransport — the real server behind `SyncTransport`.
 *
 * Everything hard about sync (the outbox, the invariant that an operation leaves it only on a
 * confirmed ACK, backoff, conflict parking) already lives in `SyncEngine` and was proven against
 * `MockTransport`. This file is deliberately thin: two RPC calls, and the translation between the
 * client's vocabulary and Postgres's. That thinness is the point of the interface — see
 * ARCHITECTURE.md §7.3.
 *
 * ── The one rule this file must never break ──────────────────────────────────────────────────────
 * `push` REJECTS when the batch did not reach the server, and RESOLVES with one outcome per
 * operation when it did. The engine reads those two differently and cannot recover from a mix-up:
 * a rejection means "unknown", so the operations stay queued and are sent again; a resolution is
 * taken as the server's word. Turning a network failure into a `rejected` outcome would quietly
 * throw away the user's writing. So every failure path here THROWS.
 *
 * ── Signed out is a failure, not an empty result ─────────────────────────────────────────────────
 * Same reasoning. Returning "no outcomes" for a signed-out push would let the engine treat the
 * batch as answered-with-silence; throwing leaves it queued, so signing in later drains what was
 * written while signed out. Which is exactly what an offline-first app promises.
 */
import { supabase, isAuthConfigured } from '@/core/auth/supabase';
import { SyncError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { deviceId } from './deviceId';
import { toServerPayload, toClientPayload, toServerRow } from './payloadCase';
import type { Operation, PullResult, PushResult, PushOutcome, SyncTransport } from './types';

const log = logger.scoped('sync');

/** the JSON `sync_push` answers with, before it is narrowed to `PushOutcome` */
interface RawOutcome {
  id: string;
  status: string;
  version?: number;
  serverVersion?: number;
  serverPayload?: Record<string, unknown>;
  deletedAt?: number;
  reason?: string;
}

export class SupabaseTransport implements SyncTransport {
  readonly name = 'Supabase';

  private client() {
    if (!isAuthConfigured || !supabase) {
      throw new SyncError('Sync is not configured on this build', 'sync/unconfigured');
    }
    return supabase;
  }

  /**
   * The access token, or a throw. Read fresh on every call rather than cached: it expires, and
   * supabase-js refreshes it in the background, so a captured one goes stale exactly during the
   * long offline stretch this app is built for.
   */
  private async requireSession() {
    const { data, error } = await this.client().auth.getSession();
    if (error) throw new SyncError(error.message, 'sync/session-unavailable', error);
    if (!data.session) throw new SyncError('Sign in to sync your notes', 'sync/signed-out');
    return data.session;
  }

  async push(ops: Operation[]): Promise<PushResult> {
    await this.requireSession();
    const device = await deviceId();

    const { data, error } = await this.client().rpc('sync_push', {
      device,
      ops: ops.map((op) => ({
        id: op.id,
        entity: op.entity,
        entityId: op.entityId,
        type: op.type,
        version: op.version,
        payload: toServerPayload(op.payload),
      })),
    });

    // Any error here is "the batch did not land, or we cannot tell" — both mean unacknowledged.
    if (error) throw new SyncError(error.message, 'sync/push-failed', error);
    if (!Array.isArray(data)) {
      throw new SyncError('The server answered a push with something other than a list of outcomes', 'sync/bad-response');
    }

    return { outcomes: (data as RawOutcome[]).map((o) => this.outcome(o)) };
  }

  /**
   * Narrow one raw outcome, and be strict about it.
   *
   * An unrecognised status is treated as a rejection rather than assumed to be an ack. Guessing
   * "ack" would delete a queue row on the strength of a status this client does not understand —
   * the one deletion in the whole engine, made on a shrug.
   */
  private outcome(o: RawOutcome): PushOutcome {
    switch (o.status) {
      case 'ack':
        return { id: o.id, status: 'ack', version: o.version ?? 0 };
      case 'conflict':
        return {
          id: o.id,
          status: 'conflict',
          serverVersion: o.serverVersion ?? 0,
          serverPayload: toServerRow(o.serverPayload ?? {}),
        };
      case 'deleted':
        return {
          id: o.id,
          status: 'deleted',
          serverVersion: o.serverVersion ?? 0,
          deletedAt: o.deletedAt ?? Date.now(),
        };
      case 'rejected':
        return { id: o.id, status: 'rejected', reason: o.reason ?? 'The server refused this change' };
      default:
        log.warn('unknown push outcome', { id: o.id, status: o.status });
        return { id: o.id, status: 'rejected', reason: `Unrecognised server response: ${o.status}` };
    }
  }

  async pull(cursor: number, limit = 500): Promise<PullResult> {
    await this.requireSession();
    const device = await deviceId();

    const { data, error } = await this.client().rpc('sync_pull', {
      device,
      cursor_seq: cursor,
      max_rows: limit,
    });

    if (error) throw new SyncError(error.message, 'sync/pull-failed', error);

    const result = data as { ops?: unknown[]; cursor?: number } | null;
    if (!result || !Array.isArray(result.ops)) {
      throw new SyncError('The server answered a pull without a list of operations', 'sync/bad-response');
    }

    const ops = (result.ops as Array<Record<string, unknown>>).map<Operation>((o) => ({
      id: String(o.id),
      entity: String(o.entity),
      entityId: String(o.entityId),
      type: String(o.type),
      version: Number(o.version),
      createdAt: Number(o.createdAt),
      payload: toClientPayload((o.payload as Record<string, unknown>) ?? {}),
    }));

    /*
     * The cursor comes back UNCHANGED on an empty page, and is the last seq actually included when
     * the page was capped — never the table's maximum. Trusting a local `Math.max` over the ops
     * instead would work until a pull returned nothing, at which point the cursor would fall back
     * to 0 and the next pull would re-deliver the account's entire history.
     */
    return { ops, cursor: Number(result.cursor ?? cursor) };
  }
}
