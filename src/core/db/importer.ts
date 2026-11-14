/**
 * importer — restore/merge a BlocNote export back into IndexedDB. The mirror image of
 * `exporter.ts`. It follows the SCALE_IMPORT_TESTING.md rules at a pragmatic scale:
 *
 *   validate envelope → per-table, validate each row (bad rows quarantined, never abort) →
 *   write in CHUNKED bulkPut transactions (~800 rows) → yield to the UI between chunks →
 *   report { done, failed } progress.
 *
 * Idempotent: every row carries a stable id, and `bulkPut` upserts — importing the same file
 * twice yields the same DB, never duplicates. This is a LOCAL import (writes straight to Dexie,
 * no per-row sync ops — see SCALE_IMPORT_TESTING.md §1.5). The Worker + NDJSON streaming version
 * for 500k-row files is a later upgrade; for restoring an export this chunked pass is enough.
 */
import { db } from './schema';
import { EXPORT_FORMAT } from './exporter';
import { eventBus } from '@/core/events/eventBus';
import { ValidationError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { base64ToBlob } from '@/core/media/base64';
import { importKeepZip, isZip } from './keepImport';
import type { Table } from 'dexie';

const log = logger.scoped('importer');

/**
 * Envelope ids this importer will open.
 *
 * A list rather than a single value, because the id inside a file can never be changed retroactively
 * — every export already written carries whatever it carried. So the rule for renaming it is: add
 * the new one here, keep the old one, and old backups keep restoring. `EXPORT_FORMAT` is always the
 * one being WRITTEN; this is everything we can still READ.
 */
const ACCEPTED_FORMATS: string[] = [EXPORT_FORMAT];

const CHUNK = 800;
const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

export interface ImportProgress {
  table: string;
  done: number; // rows written so far (all tables)
  total: number; // rows to write (all valid + invalid)
  failed: number; // rows quarantined so far
  complete?: boolean;
}
export interface ImportResult {
  done: number;
  failed: number;
  byTable: Record<string, number>;
  errors: string[];
  /** a sentence for the person, when a count of records would mean nothing to them */
  summary?: string;
}

type Row = Record<string, unknown>;
const isObj = (r: unknown): r is Row => !!r && typeof r === 'object' && !Array.isArray(r);
const hasId = (r: unknown): r is Row => isObj(r) && typeof r.id === 'string';

/**
 * Tables restored, in dependency order (parents before children), with a per-row validator and an
 * optional `transform` for rows that aren't plain JSON (media blobs arrive base64-encoded).
 */
interface TablePlan {
  name: string;
  table: Table;
  valid: (r: unknown) => boolean;
  transform?: (r: Row) => Row;
}
function plan(): TablePlan[] {
  return [
    { name: 'workspaces', table: db.workspaces as Table, valid: hasId },
    { name: 'notes', table: db.notes as Table, valid: hasId },
    { name: 'blocks', table: db.blocks as Table, valid: (r: unknown) => hasId(r) && typeof (r as Row).noteId === 'string' },
    { name: 'tags', table: db.tags as Table, valid: hasId },
    { name: 'note_tags', table: db.note_tags as Table, valid: (r: unknown) => isObj(r) && typeof r.noteId === 'string' && typeof r.tagId === 'string' },
    { name: 'attachments', table: db.attachments as Table, valid: hasId },
    { name: 'meta', table: db.meta as Table, valid: (r: unknown) => isObj(r) && typeof r.key === 'string' },
    // profiles (export v3+). Older exports have no `profiles` key and simply skip this table;
    // their name and avatar are still in `meta`, where profile.service picks them up.
    { name: 'profiles', table: db.profiles as Table, valid: hasId },
    /*
     * The quarantine shelf (export v4+). Restored to the SHELF, not to the library: these rows were
     * set aside on purpose, and an import that silently put somebody's previous account's notes
     * back into the open library would undo the decision the shelf exists to hold. Older exports
     * have no `quarantine` key and skip this table.
     */
    { name: 'quarantine', table: db.quarantine as Table, valid: (r: unknown) => isObj(r) && typeof r.key === 'string' },
    {
      // media (export v2+): base64 → Blob. Older v1 exports simply have no `blobs` key.
      name: 'blobs',
      table: db.blobs as Table,
      valid: (r: unknown) => isObj(r) && typeof r.checksum === 'string' && typeof r.data === 'string',
      transform: (r) => ({
        checksum: r.checksum,
        blob: base64ToBlob(r.data as string, (r.mime as string) || 'image/webp'),
        mime: (r.mime as string) || 'image/webp',
        size: (r.size as number) ?? 0,
        width: r.width,
        height: r.height,
        createdAt: (r.createdAt as number) ?? Date.now(),
      }),
    },
  ];
}

/** Read a File and import it: a Notevra export (.json), or a Google Keep Takeout (.zip). */
export async function importFromFile(file: File, onProgress?: (p: ImportProgress) => void): Promise<ImportResult> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new ValidationError('Could not read the file.', 'import/read-failed');
  }
  // sniff the bytes, not the name: a zip renamed by a download manager is still a zip
  if (isZip(bytes)) return importKeepZip(bytes, onProgress);
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ValidationError('That file isn’t valid JSON.', 'import/bad-json');
  }
  return importPayload(payload, onProgress);
}

/** Import an already-parsed export payload. Throws only for an unrecognized envelope. */
export async function importPayload(payload: unknown, onProgress?: (p: ImportProgress) => void): Promise<ImportResult> {
  // ACCEPTED_FORMATS, not a literal: this check and the string the exporter stamps in have to agree,
  // and they were two separate copies of the same text sitting in two files. Changing one would have
  // made the app reject its own exports, with the two lines far enough apart to not look related.
  if (!isObj(payload) || !ACCEPTED_FORMATS.includes(payload.format as string) || !isObj(payload.data)) {
    throw new ValidationError('Unrecognized file — expected a Notevra export.', 'import/bad-format');
  }
  const data = payload.data as Record<string, unknown>;
  const tables = plan();

  const total = tables.reduce((n, t) => n + (Array.isArray(data[t.name]) ? (data[t.name] as unknown[]).length : 0), 0);
  const result: ImportResult = { done: 0, failed: 0, byTable: {}, errors: [] };

  for (const t of tables) {
    const rows = Array.isArray(data[t.name]) ? (data[t.name] as unknown[]) : [];
    const good: Row[] = [];
    for (const r of rows) {
      if (t.valid(r)) good.push(r as Row);
      else {
        result.failed++;
        if (result.errors.length < 50) result.errors.push(`${t.name}: skipped a malformed row`);
      }
    }

    let written = 0;
    // media rows are far larger than plain records — write them in small batches so a library of
    // photos can't blow past IndexedDB's per-transaction limits or stall the frame
    const chunkSize = t.name === 'blobs' ? 20 : CHUNK;
    for (let i = 0; i < good.length; i += chunkSize) {
      const slice = good.slice(i, i + chunkSize);
      const batch = t.transform ? slice.map(t.transform) : slice;
      await t.table.bulkPut(batch); // one transaction per chunk (Dexie wraps it); upsert = idempotent
      written += batch.length;
      result.done += batch.length;
      onProgress?.({ table: t.name, done: result.done, total, failed: result.failed });
      await yieldToUI(); // let liveQuery + the progress bar catch up
    }
    result.byTable[t.name] = written;
  }

  onProgress?.({ table: 'done', done: result.done, total, failed: result.failed, complete: true });
  log.info('import complete', { done: result.done, failed: result.failed, byTable: result.byTable });

  // Dexie's liveQuery notices these writes on its own, so the page redraws — but anything derived
  // and held in MEMORY does not, because a bulk import deliberately skips per-row events (§1.5).
  // The search index was the casualty: imported rows stayed invisible to ⌘K until the next reload
  // rebuilt the index from scratch. One announcement, and every such consumer can invalidate.
  eventBus.emit('data.bulk-changed', { source: 'import', rows: result.done });

  return result;
}
