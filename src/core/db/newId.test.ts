/**
 * `newId` on an origin that is not a secure context.
 *
 * This is a regression test for a bug that made the app look completely broken on a phone: opened
 * over a LAN address (`http://192.168.x.x`), `crypto.randomUUID` does not exist, so every write
 * that minted an id threw and nothing saved — while IndexedDB itself worked perfectly, which is
 * what made it read as "the database isn't persisting".
 *
 * Cheap to test and impossible to notice by hand on localhost, where the API is always present.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { newId } from './schema';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const original = crypto.randomUUID;
afterEach(() => {
  Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true, writable: true });
});

/** what a non-secure origin looks like: the method is absent, the rest of `crypto` is not */
function withoutRandomUUID() {
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });
}

describe('newId', () => {
  it('returns a v4 UUID when crypto.randomUUID exists', () => {
    expect(newId()).toMatch(V4);
  });

  it('still returns a v4 UUID where crypto.randomUUID does not exist', () => {
    withoutRandomUUID();
    expect(newId()).toMatch(V4);
  });

  it('does not throw on a non-secure origin — the bug that stopped every write', () => {
    withoutRandomUUID();
    expect(() => newId()).not.toThrow();
  });

  it('produces distinct ids from the fallback', () => {
    withoutRandomUUID();
    // ids are a row's identity across devices once sync lands; a collision merges two people's work
    const ids = new Set(Array.from({ length: 2000 }, newId));
    expect(ids.size).toBe(2000);
  });
});
