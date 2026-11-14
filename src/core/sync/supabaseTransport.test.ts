/**
 * SupabaseTransport, against a stubbed client.
 *
 * What is being tested is not "does Supabase work" — that is `npm run db:verify`, which drives the
 * real functions through PostgREST with real JWTs. It is the half that only exists in TypeScript:
 * the promise `SyncEngine` relies on absolutely, that a push either RESOLVES with the server's
 * verdict or REJECTS, and never converts a failure into a verdict.
 *
 * That distinction is the difference between "your writing is still queued" and "your writing is
 * gone", so every failure path gets a case.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/core/db/schema';
import { resetDeviceIdCache } from './deviceId';
import type { Operation } from './types';

/** what the stubbed `supabase.rpc` will answer with next, per function name */
const answers: Record<string, { data?: unknown; error?: { message: string } }> = {};
const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let session: { access_token: string } | null = { access_token: 'token' };

vi.mock('@/core/auth/supabase', () => ({
  isAuthConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session }, error: null }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return answers[fn] ?? { data: null, error: null };
    },
  },
  requireSupabase: () => null,
}));

const { SupabaseTransport } = await import('./supabaseTransport');

const op = (over: Partial<Operation> = {}): Operation => ({
  id: 'q1',
  entity: 'block',
  entityId: 'blk-1',
  type: 'UpdateBlock',
  version: 2,
  createdAt: 1_700_000_000_000,
  payload: { id: 'blk-1', noteId: 'note-1', text: 'Ship it', checked: 1 },
  ...over,
});

beforeEach(async () => {
  for (const key of Object.keys(answers)) delete answers[key];
  calls.length = 0;
  session = { access_token: 'token' };
  resetDeviceIdCache();
  await db.meta.clear();
});

describe('signing in is not optional for the network, but it is for the app', () => {
  it('push THROWS when nobody is signed in, so the batch stays queued', async () => {
    session = null;
    // resolving with an empty outcome list would let the engine treat every operation as
    // answered-with-silence; throwing is what makes "write now, sign in later" work at all
    await expect(new SupabaseTransport().push([op()])).rejects.toThrow(/sign in/i);
    expect(calls).toHaveLength(0);
  });

  it('pull throws too, rather than reporting an empty server', async () => {
    session = null;
    await expect(new SupabaseTransport().pull(0)).rejects.toThrow(/sign in/i);
  });
});

describe('push', () => {
  it('sends snake_case with real booleans, and a stable device id', async () => {
    answers.sync_push = { data: [{ id: 'q1', status: 'ack', version: 2 }] };
    const transport = new SupabaseTransport();

    await transport.push([op()]);
    await transport.push([op({ id: 'q2' })]);

    const sent = calls[0].args.ops as Array<Record<string, unknown>>;
    expect(sent[0].payload).toEqual({ id: 'blk-1', note_id: 'note-1', text: 'Ship it', checked: true });
    expect(sent[0].entityId, 'the id is the server’s key — never renamed or reshaped').toBe('blk-1');
    // the same browser must not look like two devices, or it pulls back everything it just pushed
    expect(calls[1].args.device).toBe(calls[0].args.device);
    expect(String(calls[0].args.device)).not.toHaveLength(0);
  });

  it('turns a transport error into a REJECTION, not into outcomes', async () => {
    answers.sync_push = { error: { message: 'Failed to fetch' } };
    await expect(new SupabaseTransport().push([op()])).rejects.toThrow('Failed to fetch');
  });

  it('rejects a response that is not a list of outcomes', async () => {
    // "the server answered something we do not understand" is unknown, and unknown means requeue
    answers.sync_push = { data: { oops: true } };
    await expect(new SupabaseTransport().push([op()])).rejects.toThrow(/outcomes/i);
  });

  it('carries a conflict’s server row across in the client’s vocabulary', async () => {
    answers.sync_push = {
      data: [
        {
          id: 'q1',
          status: 'conflict',
          serverVersion: 5,
          serverPayload: {
            id: 'blk-1',
            note_id: 'note-1',
            text: 'their text',
            checked: true,
            version: 5,
            updated_at: '2026-08-26T09:15:00.000Z',
          },
        },
      ],
    };

    const { outcomes } = await new SupabaseTransport().push([op()]);

    expect(outcomes[0]).toMatchObject({ status: 'conflict', serverVersion: 5 });
    const theirs = (outcomes[0] as { serverPayload: Record<string, unknown> }).serverPayload;
    // the dialog diffs this against a camelCase payload; snake_case here means every field reads
    // as a difference and the real one is impossible to find
    expect(theirs).toEqual({ id: 'blk-1', noteId: 'note-1', text: 'their text', checked: 1 });
  });

  it('treats a status it does not recognise as rejected, never as an ack', async () => {
    // acking on a shrug would delete the queue row — the only deletion in the whole engine
    answers.sync_push = { data: [{ id: 'q1', status: 'shrug' }] };

    const { outcomes } = await new SupabaseTransport().push([op()]);

    expect(outcomes[0].status).toBe('rejected');
  });

  it('passes the server’s reason through, so Settings can show why', async () => {
    answers.sync_push = { data: [{ id: 'q1', status: 'rejected', reason: 'permission denied for table blocks' }] };

    const { outcomes } = await new SupabaseTransport().push([op()]);

    expect(outcomes[0]).toEqual({ id: 'q1', status: 'rejected', reason: 'permission denied for table blocks' });
  });
});

describe('pull', () => {
  it('converts operations back and keeps the server’s cursor', async () => {
    answers.sync_pull = {
      data: {
        ops: [
          {
            id: '42',
            entity: 'block',
            entityId: 'blk-9',
            type: 'CreateBlock',
            version: 1,
            createdAt: 1_700_000_000_000,
            payload: { id: 'blk-9', note_id: 'note-1', parent_block: null, checked: false, text: 'from B' },
          },
        ],
        cursor: 42,
      },
    };

    const result = await new SupabaseTransport().pull(0);

    expect(result.cursor).toBe(42);
    expect(result.ops[0].payload).toEqual({
      id: 'blk-9',
      noteId: 'note-1',
      parentBlock: null,
      checked: 0,
      text: 'from B',
    });
  });

  it('keeps the cursor the server returned when the page is empty', async () => {
    // deriving it from the ops instead would fall back to 0 here, and the next pull would
    // re-deliver the account's entire history
    answers.sync_pull = { data: { ops: [], cursor: 42 } };

    expect((await new SupabaseTransport().pull(42)).cursor).toBe(42);
  });

  it('throws on an error rather than reporting nothing happened elsewhere', async () => {
    answers.sync_pull = { error: { message: 'JWT expired' } };
    await expect(new SupabaseTransport().pull(0)).rejects.toThrow('JWT expired');
  });

  it('sends the cursor and limit the function expects', async () => {
    answers.sync_pull = { data: { ops: [], cursor: 7 } };

    await new SupabaseTransport().pull(7, 25);

    expect(calls[0].args).toMatchObject({ cursor_seq: 7, max_rows: 25 });
  });
});
