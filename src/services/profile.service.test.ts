/**
 * The profile: one per account, and the rescue of what the old global keys held.
 *
 * The test that matters most is the first one. `meta['displayName']` and `meta['avatar']` were a
 * single namespace, so the device had exactly one identity — sign out as one person, in as another,
 * and the second was greeted by the first one's name and photograph. On a shared machine that is
 * one person's face shown under another person's account, and no amount of care in the UI could
 * have prevented it while the storage worked that way.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/core/db/schema';
import { profileService, profileIdFor, LOCAL_PROFILE } from './profile.service';

/*
 * The image pipeline needs a Worker, OffscreenCanvas and a real decoder — none of which exist in
 * jsdom. Stubbed to a deterministic checksum so these tests are about the PROFILE: which account a
 * name belongs to, and what survives a migration. `imageProcessing` has its own suite.
 */
vi.mock('@/core/media/imageClient', () => ({
  processImageFile: vi.fn(async (file: File) => ({
    blob: new Blob([await file.arrayBuffer()], { type: 'image/webp' }),
    checksum: `sum-${file.size}`,
    width: 64,
    height: 64,
    originalSize: file.size,
  })),
}));

const ALICE = 'user-alice';
const BOB = 'user-bob';

const png = () => new File([new Uint8Array([1, 2, 3, 4])], 'a.png', { type: 'image/png' });

beforeEach(async () => {
  await Promise.all([db.profiles.clear(), db.meta.clear(), db.blobs.clear()]);
  // the migration memoises per module load; clear what it would have found so it is a no-op
  vi.resetModules();
});

describe('whose profile is it', () => {
  it('KEEPS TWO ACCOUNTS APART ON ONE DEVICE', async () => {
    await profileService.setName(ALICE, 'Alice');
    await profileService.setName(BOB, 'Bob');

    expect((await profileService.get(ALICE)).displayName).toBe('Alice');
    expect((await profileService.get(BOB)).displayName).toBe('Bob');
  });

  it('does not show a signed-in person the device’s signed-out profile', async () => {
    await profileService.setName(null, 'Whoever had this laptop');

    expect((await profileService.get(ALICE)).displayName).toBe('');
  });

  it('gives a signed-out device a real profile rather than an absence', async () => {
    // signed-out is a supported permanent state here: someone with no account still has a name
    await profileService.setName(null, 'Just me');

    expect((await profileService.get(undefined)).displayName).toBe('Just me');
    expect(profileIdFor(null)).toBe(LOCAL_PROFILE);
  });

  it('returns a blank profile rather than null for an account that has set nothing', async () => {
    const row = await profileService.get('nobody');

    expect(row).toMatchObject({ id: 'nobody', displayName: '', avatarChecksum: null });
  });
});

describe('the avatar', () => {
  it('is stored as bytes in blobs and a pointer on the profile', async () => {
    /*
     * It used to be a base64 data URL of the raw file, inline in a database row — read in full on
     * every Settings mount and copied into every export. The pointer is what makes it the same kind
     * of object as every other image in the app.
     */
    const checksum = await profileService.setAvatar(ALICE, png());

    expect((await profileService.get(ALICE)).avatarChecksum).toBe(checksum);
    const stored = await db.blobs.get(checksum);
    expect(stored?.mime, 'compressed on the way in, like any other image').toBe('image/webp');
  });

  it('clearing it leaves the bytes alone — that store is shared', async () => {
    // the same picture may be a block on a page; deleting by checksum here would blank it there
    const checksum = await profileService.setAvatar(ALICE, png());

    await profileService.clearAvatar(ALICE);

    expect((await profileService.get(ALICE)).avatarChecksum).toBeNull();
    expect(await db.blobs.get(checksum), 'still referenced elsewhere, for all this knows').toBeDefined();
  });

  it('one account clearing its picture does not touch another’s', async () => {
    await profileService.setAvatar(ALICE, png());
    await profileService.setAvatar(BOB, png());

    await profileService.clearAvatar(ALICE);

    expect((await profileService.get(BOB)).avatarChecksum).not.toBeNull();
  });
});

describe('carrying the old device profile across', () => {
  it('rescues the name and the picture from the pre-v8 keys', async () => {
    await db.meta.bulkPut([
      { key: 'displayName', value: 'Farhan' },
      { key: 'avatar', value: 'data:image/png;base64,AQIDBA==' },
    ]);
    const { profileService: fresh } = await import('./profile.service');

    const row = await fresh.get(null);

    expect(row.displayName).toBe('Farhan');
    expect(row.avatarChecksum, 'the picture came too, not just the name').not.toBeNull();
    expect(await db.blobs.get(row.avatarChecksum!)).toBeDefined();
  });

  it('lands on the signed-out profile even when somebody is signed in', async () => {
    /*
     * Those keys were written with no account attached, by whoever was holding the device.
     * Attributing them to whichever account happens to be signed in now is a guess, and the guess
     * puts one person's face on another person's profile — the exact bug this table prevents.
     */
    await db.meta.put({ key: 'displayName', value: 'Farhan' });
    const { profileService: fresh } = await import('./profile.service');

    await fresh.get(ALICE);

    expect((await db.profiles.get(LOCAL_PROFILE))?.displayName).toBe('Farhan');
    expect((await db.profiles.get(ALICE))?.displayName ?? '').toBe('');
  });

  it('removes the old keys once, so it cannot run twice and fight a rename', async () => {
    await db.meta.put({ key: 'displayName', value: 'Farhan' });
    const { profileService: fresh } = await import('./profile.service');

    await fresh.get(null);
    await fresh.setName(null, 'Renamed');
    const { profileService: later } = await import('./profile.service');
    await later.get(null);

    expect(await db.meta.get('displayName')).toBeUndefined();
    expect((await db.profiles.get(LOCAL_PROFILE))?.displayName).toBe('Renamed');
  });

  it('does nothing at all when there is nothing to carry', async () => {
    const { profileService: fresh } = await import('./profile.service');

    await fresh.get(null);

    expect(await db.profiles.count(), 'a blank read must not write a row').toBe(0);
  });
});
