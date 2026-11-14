/**
 * The wire contract between Dexie and Postgres.
 *
 * Worth pinning hard, because every way of getting this wrong produces data that syncs
 * *successfully* and arrives wrong — a checkbox that comes back unticked, a block that lands under
 * no parent, a user property renamed out from under the screen that reads it. None of it throws,
 * none of it shows up in a push outcome, and the only place it can be caught is here.
 */
import { describe, it, expect } from 'vitest';
import { toServerPayload, toClientPayload, toServerRow } from './payloadCase';

describe('names', () => {
  it('renames the fields Postgres folds', () => {
    expect(toServerPayload({ noteId: 'n1', parentBlock: 'b1', workspaceId: 'w1' })).toEqual({
      note_id: 'n1',
      parent_block: 'b1',
      workspace_id: 'w1',
    });
  });

  it('leaves alone the ones that are already the same on both sides', () => {
    const same = { id: 'b1', type: 'task', text: 'Ship it', position: 1.5, version: 3 };
    expect(toServerPayload(same)).toEqual(same);
  });

  it('passes an UNKNOWN key through untouched, in both directions', () => {
    // the failure this protects: a generic camelCase→snake_case converter renames a field nobody
    // taught it about, so the write lands under a key nothing on the other device reads
    expect(toServerPayload({ someNewField: 1 })).toEqual({ someNewField: 1 });
    expect(toClientPayload({ some_new_field: 1 })).toEqual({ some_new_field: 1 });
  });
});

describe('booleans', () => {
  it('0 and 1 become false and true', () => {
    expect(toServerPayload({ checked: 1, archived: 0, favorite: 1 })).toEqual({
      checked: true,
      archived: false,
      favorite: true,
    });
  });

  it('and come back as 0 and 1, because Dexie cannot index a boolean', () => {
    expect(toClientPayload({ checked: false, archived: true })).toEqual({ checked: 0, archived: 1 });
  });

  it('survives a round trip in both states', () => {
    for (const checked of [0, 1]) {
      expect(toClientPayload(toServerPayload({ checked })).checked).toBe(checked);
    }
  });

  it('does not touch a number that is not 0 or 1', () => {
    // `position: 1` is not a boolean; only the three known flag fields are converted at all
    expect(toServerPayload({ position: 1 })).toEqual({ position: 1 });
  });
});

describe('props and properties are the user’s, not ours', () => {
  it('does not descend into props', () => {
    const props = { dueDate: '2026-08-26', parentBlock: 'not a field, a user key', checked: 1 };
    expect(toServerPayload({ props }).props).toEqual(props);
  });

  it('does not descend into properties on the way back either', () => {
    const properties = { note_id: 'a user key that looks like ours', archived: true };
    expect(toClientPayload({ properties }).properties).toEqual(properties);
  });
});

describe('timestamps', () => {
  it('leaves epoch milliseconds alone — that is what an operation payload carries', () => {
    expect(toClientPayload({ deleted_at: 1_700_000_000_000 })).toEqual({ deletedAt: 1_700_000_000_000 });
  });

  it('parses the ISO strings a real Postgres ROW carries', () => {
    const iso = '2026-08-26T09:15:00.000Z';
    expect(toClientPayload({ deleted_at: iso })).toEqual({ deletedAt: Date.parse(iso) });
  });

  it('leaves an unparseable string as it is rather than writing NaN into the row', () => {
    expect(toClientPayload({ deleted_at: 'sometime' })).toEqual({ deletedAt: 'sometime' });
  });
});

describe('null is a value, not an absence', () => {
  it('keeps deletedAt: null — it is how an undelete is expressed', () => {
    // sync_push tests `payload ? 'deleted_at' and payload ->> 'deleted_at' is null`; dropping the
    // key would turn "bring this block back" into "change nothing"
    expect(toServerPayload({ deletedAt: null })).toEqual({ deleted_at: null });
    expect('deleted_at' in toServerPayload({ deletedAt: null })).toBe(true);
  });

  it('keeps a null parent — a block moved to the top level', () => {
    expect(toServerPayload({ parentBlock: null })).toEqual({ parent_block: null });
  });
});

describe('a full block survives the round trip', () => {
  it('comes back exactly as it went', () => {
    const block = {
      id: 'blk-1',
      noteId: 'note-1',
      parentBlock: null,
      position: 2.5,
      type: 'task',
      text: 'Ship the scheduler',
      checked: 1,
      props: { priority: 'high', dueDate: 'Fri' },
      deletedAt: null,
      updatedAt: 1_700_000_000_000,
      version: 4,
    };

    expect(toClientPayload(toServerPayload(block))).toEqual(block);
  });
});

describe('toServerRow — what the conflict dialog is allowed to compare', () => {
  const row = {
    id: 'blk-1',
    note_id: 'note-1',
    text: 'their text',
    checked: true,
    version: 9,
    updated_at: '2026-08-26T09:15:00.000Z',
    created_at: '2026-08-20T09:15:00.000Z',
  };

  it('speaks the client’s vocabulary, so the diff is about content and not about spelling', () => {
    const theirs = toServerRow(row);
    expect(theirs.noteId).toBe('note-1');
    expect(theirs.checked).toBe(1);
    expect(theirs.note_id).toBeUndefined();
  });

  it('strips the three fields that differ on EVERY conflict', () => {
    // version travels as `serverVersion` on the outcome, and both timestamps come from the
    // server's own clock — leaving them in lists four differences where the user made one
    const theirs = toServerRow(row);
    expect(theirs.version).toBeUndefined();
    expect(theirs.updatedAt).toBeUndefined();
    expect(theirs.createdAt).toBeUndefined();
  });

  it('keeps deletedAt, which is a real difference a person needs to see', () => {
    const iso = '2026-08-26T09:15:00.000Z';
    expect(toServerRow({ ...row, deleted_at: iso }).deletedAt).toBe(Date.parse(iso));
  });
});
