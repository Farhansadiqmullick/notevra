/**
 * attachment.service — the write path for media (design/media-blocks.md §1–2). Components never
 * touch the blob store or the attachments table directly; they call this.
 *
 * Flow: File → processImageFile (validate/WebP/hash, in a Worker) → storage.put (dedup by checksum)
 *     → attachments row (which note/block uses it) → the caller writes the tiny pointer onto the
 *       block via blockService. Bytes never enter the block.
 */
import { db, newId, type AttachmentRow } from '@/core/db/schema';
import { processImageFile } from '@/core/media/imageClient';
import { storage } from '@/core/media/storage';
import { logger } from '@/core/logging/logger';

const log = logger.scoped('attachment.service');

export interface AttachedImage {
  checksum: string; // the block's pointer (props.attachmentId)
  width: number;
  height: number;
  size: number; // stored (WebP) size
  originalSize: number;
}

export const attachmentService = {
  /** Process + store an image file, and record the attachment for this block. */
  async attachImage(file: File, ctx: { noteId: string; blockId: string }): Promise<AttachedImage> {
    const processed = await processImageFile(file); // throws ImageProcessingError on any gate
    const stored = await storage.put(processed.blob, {
      checksum: processed.checksum,
      width: processed.width,
      height: processed.height,
    });

    // one attachment row per (block, checksum) use; the blob itself is shared/deduped
    const existing = await db.attachments
      .where('blockId')
      .equals(ctx.blockId)
      .filter((a) => a.checksum === processed.checksum)
      .first();

    if (!existing) {
      const row: AttachmentRow = {
        id: newId(),
        noteId: ctx.noteId,
        blockId: ctx.blockId,
        checksum: processed.checksum,
        mime: stored.mime,
        size: stored.size,
        storageKey: processed.checksum,
      };
      await db.attachments.add(row);
    }

    log.debug('attachImage', {
      checksum: processed.checksum, from: processed.originalSize, to: stored.size,
    });
    return {
      checksum: processed.checksum,
      width: processed.width,
      height: processed.height,
      size: stored.size,
      originalSize: processed.originalSize,
    };
  },

  /**
   * Drop this block's link to a stored image. The blob is garbage-collected only when no other
   * attachment references that checksum (refcount by query — cheap at this scale).
   */
  async detach(blockId: string, checksum: string): Promise<void> {
    await db.attachments.where('blockId').equals(blockId).filter((a) => a.checksum === checksum).delete();
    const stillUsed = await db.attachments.where('checksum').equals(checksum).count();
    if (stillUsed === 0) await storage.delete(checksum);
    log.debug('detach', { blockId, checksum, blobDeleted: stillUsed === 0 });
  },
};
