// "Undo my change": put the server's copy back over a local change the server refused for permission.
import { db } from '@/core/db/schema';
import { supabase, isAuthConfigured } from '@/core/auth/supabase';
import { logger } from '@/core/logging/logger';
import { toClientPayload } from './payloadCase';

const log = logger.scoped('undo-rejected');

/** Only refusals that a retry can never fix are offered for undo. */
export const isPermissionRefusal = (reason: string | null | undefined) => !!reason && /permission denied/i.test(reason);

const TABLES = { workspace: () => db.workspaces, note: () => db.notes, block: () => db.blocks } as const;
type UndoEntity = keyof typeof TABLES;

export interface UndoResult {
  restored: number;
  /** refused rows the server has never had a copy of; they stay as they are */
  notOnServer: number;
}

export async function undoRefusedChanges(): Promise<UndoResult> {
  const result: UndoResult = { restored: 0, notOnServer: 0 };
  if (!isAuthConfigured || !supabase) return result;

  const refused = (await db.push_state.toArray()).filter(
    (s) => isPermissionRefusal(s.lastError) && s.entity in TABLES,
  );

  for (const s of refused) {
    const entity = s.entity as UndoEntity;
    // the server's latest saved operation is the whole row (sync_ops.payload), tag colours included
    const { data, error } = await supabase
      .from('sync_ops')
      .select('type, version, payload, created_at')
      .eq('entity', entity)
      .eq('entity_id', s.entityId)
      .order('seq', { ascending: false })
      .limit(1);
    if (error) {
      log.warn('could not read the server copy', { key: s.id, detail: error.message });
      continue;
    }
    const op = data?.[0];
    if (!op) {
      result.notOnServer++;
      continue;
    }

    const version = op.version as number;
    const fields = String(op.type).startsWith('Delete')
      ? { deletedAt: Date.parse(op.created_at as string) }
      : (() => {
          const { id: _id, ...rest } = toClientPayload(op.payload as Record<string, unknown>);
          // a workspace op with no colours means "no colours", not "keep the refused ones"
          return entity === 'workspace' && !('tagColors' in rest) ? { ...rest, tagColors: undefined } : rest;
        })();

    await TABLES[entity]().update(s.entityId, {
      ...fields,
      updatedAt: Date.now(),
      version,
      syncedVersion: version,
      dirty: 0,
    } as never);
    await db.push_state.delete(s.id);
    result.restored++;
  }

  log.info('undo refused changes', result);
  return result;
}
