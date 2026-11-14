/**
 * `sha256Hex` on an origin that is not a secure context.
 *
 * Same class of bug as `newId` (see core/db/newId.test.ts): `crypto.subtle` is secure-context only,
 * so opening the app over a LAN address — which is how it gets tested on a phone — made image
 * upload throw before a byte was stored.
 *
 * The assertion that matters is not "the fallback returns a hash". It is that the fallback returns
 * **the same hash**. This value is the attachment dedup key and the primary key of the `blobs`
 * table, so two origins disagreeing about it would store the same photo twice and leave a synced
 * block pointing at a row the other device has never heard of.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { sha256Hex } from './imageProcessing';

const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');

/** what a non-secure origin looks like: `crypto` is there, `crypto.subtle` is not */
function withoutSubtle() {
  Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis.crypto, 'subtle', original);
});

/** FIPS 180-4 published vectors — an independent check on both paths, not just on each other */
const VECTORS: [string, string][] = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
];

describe('sha256Hex', () => {
  it.each(VECTORS)('matches the published digest for %j', async (input, expected) => {
    expect(await sha256Hex(new Blob([input]))).toBe(expected);
  });

  it.each(VECTORS)('matches it without crypto.subtle too — %j', async (input, expected) => {
    withoutSubtle();
    expect(await sha256Hex(new Blob([input]))).toBe(expected);
  });

  it('does not throw on a non-secure origin — the bug that killed every upload', async () => {
    withoutSubtle();
    await expect(sha256Hex(new Blob(['anything']))).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('the two paths agree on real binary, so dedup survives crossing origins', async () => {
    // random bytes, not text: a WebP blob is what this actually hashes, and a bug in how bytes are
    // fed to the digest would hide behind ASCII
    const bytes = new Uint8Array(64 * 1024);
    crypto.getRandomValues(bytes);
    const blob = new Blob([bytes]);

    const secure = await sha256Hex(blob);
    withoutSubtle();
    const insecure = await sha256Hex(blob);

    expect(insecure).toBe(secure);
  });

  it('agrees across a block boundary, where a padding bug would show', async () => {
    // 55/56/57 and 63/64/65 straddle the points where SHA-256 needs an extra 64-byte block
    for (const size of [55, 56, 57, 63, 64, 65, 119, 120, 121]) {
      const blob = new Blob([new Uint8Array(size).fill(0xab)]);

      if (original) Object.defineProperty(globalThis.crypto, 'subtle', original);
      const secure = await sha256Hex(blob);
      withoutSubtle();
      expect(await sha256Hex(blob), `length ${size}`).toBe(secure);
    }
  });
});
