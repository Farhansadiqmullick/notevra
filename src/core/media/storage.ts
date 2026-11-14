/**
 * StorageProvider — where media bytes actually live (design/media-blocks.md §1).
 *
 * Blocks never know which provider is active; they only ever hold a `checksum` pointer. That's what
 * lets us swap the backing store per platform without touching a single block component:
 *   - web/PWA now  → IndexedDbStorage (this file): a Dexie `blobs` table, deduped by content hash
 *   - web at scale → OPFS (a real private folder tree) — M5
 *   - desktop      → Tauri fs (appDataDir/attachments/<checksum>.webp)
 *   - mobile       → native filesystem plugin
 */
import { db, type BlobRow } from '@/core/db/schema';
import { logger } from '@/core/logging/logger';

const log = logger.scoped('storage');

export interface StoredBlob {
  checksum: string;
  size: number;
  mime: string;
  width?: number;
  height?: number;
}

export interface StorageProvider {
  /** Store bytes under their content hash. Idempotent: re-storing the same bytes is a no-op. */
  put(blob: Blob, meta: { checksum: string; width?: number; height?: number }): Promise<StoredBlob>;
  /** An object URL for rendering. Callers MUST revoke it (see useObjectUrl). */
  url(checksum: string): Promise<string | null>;
  get(checksum: string): Promise<BlobRow | undefined>;
  delete(checksum: string): Promise<void>;
}

export const indexedDbStorage: StorageProvider = {
  async put(blob, meta) {
    const existing = await db.blobs.get(meta.checksum);
    if (existing) {
      // same content hash = same bytes; dedup wins, nothing to write
      log.debug('put: dedup hit', { checksum: meta.checksum });
      return { checksum: existing.checksum, size: existing.size, mime: existing.mime, width: existing.width, height: existing.height };
    }
    const row: BlobRow = {
      checksum: meta.checksum,
      blob,
      mime: blob.type || 'application/octet-stream',
      size: blob.size,
      width: meta.width,
      height: meta.height,
      createdAt: Date.now(),
    };
    await db.blobs.put(row);
    log.debug('put: stored', { checksum: row.checksum, size: row.size });
    return { checksum: row.checksum, size: row.size, mime: row.mime, width: row.width, height: row.height };
  },

  get(checksum) {
    return db.blobs.get(checksum);
  },

  async url(checksum) {
    const row = await db.blobs.get(checksum);
    return row ? URL.createObjectURL(row.blob) : null;
  },

  async delete(checksum) {
    await db.blobs.delete(checksum);
  },
};

/** The active provider. Swapping platforms = swapping this binding. */
export const storage: StorageProvider = indexedDbStorage;
