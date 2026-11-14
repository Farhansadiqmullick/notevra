/**
 * exporter — client-side data export. Because everything lives in IndexedDB, export is a pure
 * browser operation: dump every table to JSON, no server round-trip (the flip side of the bulk
 * import in SCALE_IMPORT_TESTING.md). `importer.ts` reverses this.
 *
 * MEDIA: uploaded images are carried **inline as base64** under `data.blobs` (decision 2026-08-15,
 * design/media-blocks.md §8), so an export→import round-trip restores on-device images too — at the
 * cost of a ~33% size premium on that media. Remote image/video URLs cost nothing (they're just
 * strings in a block). A ZIP export is the scale answer when libraries get large.
 */
import { db } from './schema';
import { blobToBase64 } from '@/core/media/base64';

/**
 * The wire format id, written into every export file and checked by `importer.ts` on the way back.
 *
 * It says `modern-todo` and it STAYS that way even though the app is called BlocNote now. This
 * string is data, not a label: it is already sitting inside every file anyone has exported, and
 * renaming it would make all of them fail to import with "unrecognized file" — the app would reject
 * its own backups. The user-facing strings around it (the download filename, the error message, the
 * dropzone hint) were renamed; this one is deliberately left alone.
 *
 * If it ever does change, the importer has to accept BOTH — see the note at `importer.ts`.
 */
export const EXPORT_FORMAT = 'modern-todo/export';
// v2 adds `data.blobs` (base64 media); v3 adds `data.profiles`; v4 adds `data.quarantine`
export const EXPORT_VERSION = 4;

export interface ExportedBlob {
  checksum: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: number;
  data: string; // base64, no data: prefix
}

export async function exportAll(): Promise<string> {
  const [workspaces, notes, blocks, tags, note_tags, attachments, meta, profiles, quarantine, blobRows] = await Promise.all([
    db.workspaces.toArray(),
    db.notes.toArray(),
    db.blocks.toArray(),
    db.tags.toArray(),
    db.note_tags.toArray(),
    db.attachments.toArray(),
    db.meta.toArray(),
    // the name and the avatar POINTER; the picture's bytes ride along in `blobs` like any other
    // image, which is the whole reason the avatar was moved out of `meta`
    db.profiles.toArray(),
    /*
     * The quarantine shelf, and this is not optional.
     *
     * Settings offers "save a copy first" beside the button that empties the shelf permanently —
     * those rows are on no server, so the export is the only copy that would survive. An export
     * that quietly skipped them would make that offer a lie at the exact moment somebody was
     * relying on it.
     */
    db.quarantine.toArray(),
    db.blobs.toArray(),
  ]);

  // encode media last — it's the expensive part, and only pays for what actually exists
  const blobs: ExportedBlob[] = [];
  for (const b of blobRows) {
    blobs.push({
      checksum: b.checksum,
      mime: b.mime,
      size: b.size,
      width: b.width,
      height: b.height,
      createdAt: b.createdAt,
      data: await blobToBase64(b.blob),
    });
  }

  const payload = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: { workspaces, notes, blocks, tags, note_tags, attachments, meta, profiles, quarantine, blobs },
  };
  return JSON.stringify(payload, null, 2);
}

/** Rough byte estimate of what an export would weigh, for the Settings warning. */
export async function estimateExportSize(): Promise<{ mediaBytes: number; mediaCount: number }> {
  const blobs = await db.blobs.toArray();
  const raw = blobs.reduce((n, b) => n + b.size, 0);
  return { mediaBytes: Math.round(raw * 1.37), mediaCount: blobs.length }; // base64 ≈ +33% + JSON overhead
}

/**
 * Trigger a browser download of the export JSON.
 *
 * Three details here are not ceremony — each one is a browser that otherwise silently downloads
 * nothing, which is the worst possible failure for a backup button:
 *
 *   1. **The anchor is put in the document.** Chrome fires `click()` on a detached element, but
 *      Firefox ignores it entirely — the button appeared dead there and threw no error.
 *   2. **The object URL is revoked on a later tick, not on the next line.** Revoking synchronously
 *      after `click()` races the download the click just started; the browser is free to have read
 *      nothing yet, and cancels. Small exports usually survive it, which is what makes it nasty —
 *      it starts failing once media pushes the file to a few MB (base64 adds ~33%), so it breaks on
 *      exactly the libraries that most need backing up.
 *   3. **`rel="noopener"`.** Belt and braces on the synthetic anchor.
 *
 * Throws whatever `exportAll` throws — the caller reports it. It used to be fire-and-forget, so a
 * failure mid-encode left the user looking at a button that had visibly done nothing.
 */
export async function downloadExport(): Promise<void> {
  const json = await exportAll();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = `notevra-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
