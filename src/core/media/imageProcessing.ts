/**
 * imageProcessing — the validate → decode → downscale → WebP → hash pipeline
 * (design/media-blocks.md §2, §4). Pure functions, no Vue and no DB, so this same module runs
 * inside the Worker and is unit-testable on its own.
 *
 * This is the SECURITY BOUNDARY for uploads. Three deliberate gates:
 *   1. size cap BEFORE any decoding (cheap rejection, no decompression-bomb work)
 *   2. magic-byte sniff — the file's real type, never the extension or the browser-supplied MIME
 *   3. a real decode (createImageBitmap) + re-encode through a canvas. Only decoded PIXELS survive,
 *      so embedded scripts / polyglot payloads / malformed trailing data are discarded — and EXIF
 *      (GPS, camera, PII) is stripped as a side effect.
 */

import { sha256 } from '@noble/hashes/sha2.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB, per spec
export const MAX_EDGE = 2560; // longest-edge cap: guards decompression bombs + keeps blobs sane
export const WEBP_QUALITY = 0.8;

export interface ProcessedImage {
  blob: Blob; // image/webp
  checksum: string; // SHA-256 hex of the encoded bytes
  width: number;
  height: number;
  originalSize: number;
}

export class ImageProcessingError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

/** Real type from the leading bytes — never trust `file.type` or the extension. */
export async function sniffImageType(file: Blob): Promise<string | null> {
  const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const at = (i: number, bytes: number[]) => bytes.every((b, k) => buf[i + k] === b);

  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at(0, [0x42, 0x4d])) return 'image/bmp';
  // RIFF....WEBP
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  // ISO-BMFF: ....ftyp(avif|heic|heif|mif1)
  if (at(4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
    if (['avif', 'avis'].includes(brand)) return 'image/avif';
    if (['heic', 'heix', 'heif', 'mif1'].includes(brand)) return 'image/heic';
  }
  return null;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * SHA-256 of the encoded bytes — the attachment's dedup key and the primary key of `blobs`.
 *
 * `crypto.subtle` is **secure-context only**, the same gate that made every write fail on a LAN
 * address (design/ui-test-plan.md §K). Over `http://192.168.x.x` it is simply not there, so this
 * threw a bare TypeError and the upload died before a byte was stored.
 *
 * The fallback runs the SAME ALGORITHM rather than a cheaper hash, and that is the whole point.
 * This string decides whether two uploads are the same file: if an HTTP origin and an HTTPS origin
 * disagreed about it, the same photo would store twice and a block synced from one device would
 * point at a `blobs` row the other has never heard of. `@noble/hashes` returns exactly what
 * WebCrypto returns, which `sha256Hex.test.ts` asserts directly rather than taking on trust.
 *
 * Imported statically, though only the fallback path uses it. `await import()` here would be a code
 * split, and this module is also compiled into the image Worker, whose output format is `iife` —
 * which cannot code-split at all, so the build simply fails. Not worth changing the worker format
 * over: the whole of `@noble/hashes/sha2` is a few KB.
 */
export async function sha256Hex(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // native whenever it exists, which on any origin the app really ships on is always
  if (crypto.subtle) {
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  }
  return toHex(sha256(bytes));
}

/** Fit within MAX_EDGE, preserving aspect ratio. Never upscales. */
export function fitDimensions(w: number, h: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/**
 * The full pipeline. Throws ImageProcessingError with a user-safe message at every gate.
 * Requires createImageBitmap + OffscreenCanvas (present in modern browsers and in Workers).
 *
 * `maxEdge` defaults to the 2560px cap every attached image gets. It is a parameter because the
 * avatar wants a much smaller one: it is displayed at 88px, it is the one image that gets copied
 * into a database row and sent to every other device (profile.service.ts), and 2560px of a face
 * nobody will ever see at that size is bytes on a wire for nothing.
 */
export async function processImage(
  file: Blob,
  originalSize = file.size,
  maxEdge = MAX_EDGE,
): Promise<ProcessedImage> {
  // (1) size gate — before any decode work
  if (originalSize > MAX_UPLOAD_BYTES) {
    throw new ImageProcessingError('That image is larger than 5 MB.', 'media/too-large');
  }
  if (originalSize === 0) {
    throw new ImageProcessingError('That file is empty.', 'media/empty');
  }

  // (2) magic-byte gate
  const sniffed = await sniffImageType(file);
  if (!sniffed) {
    throw new ImageProcessingError('That file isn’t a supported image.', 'media/unsupported-type');
  }

  // (3) real decode — anything that isn't genuinely decodable dies here
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageProcessingError('That image couldn’t be read — it may be corrupt.', 'media/decode-failed');
  }

  try {
    const { width, height } = fitDimensions(bitmap.width, bitmap.height, maxEdge);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageProcessingError('Couldn’t process that image.', 'media/no-canvas');

    // re-encode from pixels only: drops EXIF and any non-pixel payload riding along
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
    if (!blob) throw new ImageProcessingError('Couldn’t convert that image.', 'media/encode-failed');

    return { blob, checksum: await sha256Hex(blob), width, height, originalSize };
  } finally {
    bitmap.close();
  }
}
