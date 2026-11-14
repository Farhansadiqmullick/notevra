/**
 * base64 — Blob ⇄ base64 for carrying media inside the JSON export (design/media-blocks.md §8).
 * Chunked on purpose: `String.fromCharCode(...bigArray)` blows the call stack on large images, and
 * `atob`/`btoa` need a binary string, so both directions walk the buffer in 32 KB slices.
 */

const CHUNK = 0x8000; // 32 KB — comfortably under the argument-count limit

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
