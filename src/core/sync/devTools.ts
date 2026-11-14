/**
 * devTools — make a conflict happen on purpose.
 *
 * A conflict needs two devices editing the same block from the same version. You cannot produce
 * that by clicking around one browser, and "open a second browser, sign in, go offline, edit, come
 * back" is a five-minute ritual to reach a dialog you may want to try twenty times.
 *
 * So this stages the situation, against WHICHEVER transport is running:
 *
 *   - **Mock** — tell the in-memory server it already holds a newer version of a block.
 *   - **Supabase** — push a real operation to the real server **under a different `device_id`**.
 *     That is not a simulation of another device; by every definition the server uses, it IS one.
 *     Same RPC, same RLS, same conflict rule.
 *
 * Then in both cases: make a local edit to that block, which queues an operation at the old
 * version, and flush. The server answers `conflict`, the engine parks it, the dialog appears.
 */
import { db } from '@/core/db/schema';
import { blockService } from '@/services/block.service';
import { syncEngine, transport } from './index';
import { MockTransport } from './mockTransport';
import { SupabaseTransport } from './supabaseTransport';
import { toServerPayload } from './payloadCase';
import { supabase } from '@/core/auth/supabase';

/** the id the staged edit is attributed to — anything that is not this device's own */
const OTHER_DEVICE = 'staged-other-device';

export const canSimulateConflict = transport instanceof MockTransport || transport instanceof SupabaseTransport;

/** only the mock has state to clear; the real server genuinely holds the newer version */
export const canClearSimulated = transport instanceof MockTransport;

export interface SimulateResult {
  ok: boolean;
  message: string;
}

/** Stage a conflict on the first editable block of `noteId`. */
export async function simulateConflict(noteId: string): Promise<SimulateResult> {
  if (!noteId) return { ok: false, message: 'Open a page first — the conflict needs a block to land on.' };

  const blocks = await db.blocks.where('noteId').equals(noteId).filter((b) => !b.deletedAt).sortBy('position');
  const target = blocks.find((b) => (b.text ?? '').trim().length > 0) ?? blocks[0];
  if (!target) return { ok: false, message: 'That page has no blocks yet — add one and try again.' };

  const theirText = `${target.text ?? ''}\nand a line the other device added`.trim();

  if (transport instanceof MockTransport) {
    transport.conflicts.set(target.id, {
      version: target.version + 3, // comfortably ahead, as a real divergence would be
      payload: { id: target.id, text: theirText },
    });
  } else {
    if (!supabase) return { ok: false, message: 'Supabase is not configured on this build.' };
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return { ok: false, message: 'Sign in first — the other device has to be you.' };

    /*
     * A real push, as another device. The version has to be one ABOVE what this device holds, or
     * the server treats it as the stale one and rejects it instead — the conflict has to be staged
     * from the winning side.
     */
    const { data, error } = await supabase.rpc('sync_push', {
      device: OTHER_DEVICE,
      ops: [
        {
          id: `stage-${Date.now()}`,
          entity: 'block',
          entityId: target.id,
          type: 'UpdateBlock',
          version: target.version + 1,
          payload: toServerPayload({ text: theirText }),
        },
      ],
    });
    if (error) return { ok: false, message: `The other device could not write: ${error.message}` };

    const outcome = Array.isArray(data) ? (data[0] as { status?: string; reason?: string }) : undefined;
    if (outcome?.status !== 'ack') {
      // The usual cause is that this block has never reached the server — sync once, then retry.
      return {
        ok: false,
        message: `The server refused the staged edit (${outcome?.reason ?? outcome?.status ?? 'no answer'}). Try Sync now first.`,
      };
    }
  }

  // the local edit that will collide; it queues at the CURRENT version, which the server now beats
  await blockService.updateBlock(target.id, { text: `${target.text ?? ''}\nand a line you added here`.trim() });
  await syncEngine.flush();

  return { ok: true, message: 'Conflict staged — look for the banner at the bottom right.' };
}

/** Stop the mock server claiming a newer version, so "Keep mine" can actually win afterwards. */
export function clearSimulatedConflicts(): void {
  if (transport instanceof MockTransport) transport.conflicts.clear();
}
