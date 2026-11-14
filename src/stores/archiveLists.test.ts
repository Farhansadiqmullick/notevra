import { describe, it, expect } from 'vitest';
import type { NoteRow, WorkspaceRow } from '@/core/db/schema';
import { archiveLists } from './archiveLists';

const ws = (id: string, over: Partial<WorkspaceRow> = {}): WorkspaceRow => ({
  id, ownerId: 'me', name: id, kind: 'shared', role: 'owner', membership: 'active',
  updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1, ...over,
});
const note = (id: string, workspaceId: string, over: Partial<NoteRow> = {}): NoteRow => ({
  id, workspaceId, title: id, type: 'single', archived: 0, favorite: 0,
  deletedAt: null, updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1, ...over,
});

describe('archiveLists', () => {
  it('lists archived and trashed pages of spaces you are in', () => {
    const r = archiveLists([ws('a')], [note('kept', 'a'), note('shelved', 'a', { archived: 1 }), note('binned', 'a', { deletedAt: 5 })]);
    expect(r.archived.map((n) => n.id)).toEqual(['shelved']);
    expect(r.trashedNotes.map((n) => n.id)).toEqual(['binned']);
  });

  it('leaves out pages of a space you left', () => {
    const r = archiveLists([ws('gone', { membership: 'left' })], [note('s', 'gone', { archived: 1 }), note('b', 'gone', { deletedAt: 5 })]);
    expect(r.archived).toEqual([]);
    expect(r.trashedNotes).toEqual([]);
  });

  it('counts a trashed project once, with its pages under it', () => {
    const r = archiveLists(
      [ws('p', { deletedAt: 100 })],
      [note('with-project', 'p', { deletedAt: 100 }), note('before', 'p', { deletedAt: 50 }), note('archived-in-p', 'p', { archived: 1, deletedAt: 100 })],
    );
    expect(r.trashedProjects).toEqual([{ id: 'p', name: 'p', deletedAt: 100, pages: 2 }]);
    expect(r.trashedNotes.map((n) => n.id)).toEqual(['before']);
    expect(r.archived).toEqual([]);
  });

  it('keeps pages whose space has not synced to this device yet', () => {
    expect(archiveLists([], [note('x', 'unknown', { archived: 1 })]).archived.map((n) => n.id)).toEqual(['x']);
  });

  it('drops a purged project', () => {
    expect(archiveLists([ws('p', { deletedAt: 1, purgedAt: 2 })], []).trashedProjects).toEqual([]);
  });
});
