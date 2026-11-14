/**
 * Export → import, the round trip.
 *
 * The pair had no tests at all, which is a strange gap for the one feature whose whole job is not
 * losing anything: export IS the backup story for an app with no server, and an import that
 * silently drops a table is unrecoverable by definition — the user deleted the original because the
 * export said it worked.
 *
 * The specific thing pinned here is the ENVELOPE ID. `EXPORT_FORMAT` is stamped into every file and
 * checked on the way back in, and the two were separate string literals in separate files. Renaming
 * the app made that a live hazard: change the label in one place and the app starts rejecting its
 * own backups, with the rejection reading as a corrupt file rather than as a code change.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './schema';
import { exportAll, EXPORT_FORMAT } from './exporter';
import { importPayload } from './importer';
import { ValidationError } from '@/core/errors';

const WS = 'ws-round-trip';

beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.blocks.clear(), db.meta.clear(), db.profiles.clear(), db.sync_queue.clear()]);
});

async function seed() {
  await db.notes.add({
    id: 'note-1',
    workspaceId: WS,
    type: 'single',
    title: 'Flat inspection',
    archived: 0,
    deleted: 0,
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    properties: {},
  } as never);
  await db.blocks.add({ id: 'blk-1', noteId: 'note-1', type: 'paragraph', text: 'be home by 6', order: 1 } as never);
  await db.meta.put({ key: 'displayName', value: 'Farhan' });
  await db.profiles.put({ id: 'user-1', displayName: 'Farhan', avatarChecksum: 'sum-1', updatedAt: 1 });
}

describe('the export envelope', () => {
  it('stamps the id the importer actually accepts', async () => {
    await seed();
    const payload = JSON.parse(await exportAll());

    expect(payload.format).toBe(EXPORT_FORMAT);
    // the real assertion: the importer opens what the exporter just wrote, whatever that string is
    await expect(importPayload(payload)).resolves.toBeTruthy();
  });

  it('refuses a file that is not one of ours', async () => {
    await expect(importPayload({ format: 'notion/export', data: {} })).rejects.toBeInstanceOf(ValidationError);
    await expect(importPayload({ hello: 'world' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps opening older backups after a rename — the id in a written file can never change', async () => {
    // `modern-todo/export` is what every export written before the BlocNote rename carries. If this
    // ever fails, someone renamed EXPORT_FORMAT without adding the old value to ACCEPTED_FORMATS,
    // and every backup a user already has stopped restoring.
    await seed();
    const payload = JSON.parse(await exportAll());
    expect(payload.format).toBe('modern-todo/export');
  });
});

describe('the round trip', () => {
  it('restores every row after the database is wiped', async () => {
    await seed();
    const payload = JSON.parse(await exportAll());

    await Promise.all([db.notes.clear(), db.blocks.clear(), db.meta.clear()]);
    expect(await db.notes.count()).toBe(0);

    const res = await importPayload(payload);

    expect(res.failed).toBe(0);
    expect((await db.notes.get('note-1'))?.title).toBe('Flat inspection');
    expect((await db.blocks.get('blk-1'))?.text).toBe('be home by 6');
    // the profile rides along too — which is why Settings re-reads it after an import. A backup that
    // restored every page but greeted you as nobody would read as a half-finished restore.
    expect((await db.meta.get('displayName'))?.value).toBe('Farhan');
    expect((await db.profiles.get('user-1'))?.displayName).toBe('Farhan');
    expect(
      (await db.profiles.get('user-1'))?.avatarChecksum,
      'the pointer survives; the bytes it points at ride in `blobs` like any other image',
    ).toBe('sum-1');
  });

  it('is idempotent — importing the same file twice does not duplicate', async () => {
    await seed();
    const payload = JSON.parse(await exportAll());

    await importPayload(payload);
    await importPayload(payload);

    expect(await db.notes.count()).toBe(1);
    expect(await db.blocks.count()).toBe(1);
  });

  it('quarantines a malformed row instead of aborting the whole import', async () => {
    await seed();
    const payload = JSON.parse(await exportAll());
    payload.data.blocks.push({ noteId: 'note-1', text: 'no id' }); // fails `hasId`

    const res = await importPayload(payload);

    expect(res.failed).toBe(1);
    expect(await db.notes.count()).toBe(1); // the good rows still landed
    expect(await db.blocks.count()).toBe(1);
  });
});
