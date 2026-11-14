/**
 * One personal space, however many rows say so.
 *
 * The failure these cover looked like this on screen: PERSONAL, three pages, then PERSONAL again
 * with the two pages somebody had actually written that evening. Two `kind: 'personal'` workspace
 * rows — the one this install seeded, and the one that arrived when it signed into an account that
 * already had a library — and a sidebar drawn one section per row.
 *
 * So the tests are about the SHAPE the sidebar is handed, not about the rows underneath it: nothing
 * here merges, moves or deletes anything, and a test that passed by rewriting the data would be
 * testing the wrong fix (core/db/personal.ts says why).
 */
import { describe, it, expect } from 'vitest';
import type { NoteRow, WorkspaceRow } from '@/core/db/schema';
import { sidebarGroups } from './notes.store';

const ws = (id: string, over: Partial<WorkspaceRow> = {}): WorkspaceRow => ({
  id, ownerId: 'me', name: 'Personal', kind: 'personal', role: 'owner', membership: 'active',
  updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1, ...over,
});
const note = (id: string, workspaceId: string, over: Partial<NoteRow> = {}): NoteRow => ({
  id, workspaceId, title: id, type: 'single', archived: 0, favorite: 0,
  deletedAt: null, updatedAt: 1, version: 1, syncedVersion: 0, dirty: 1, ...over,
});

/** the account's library arrived first; this install's own seeded space is the newer of the two */
const account = ws('ws-account', { updatedAt: 100, syncedVersion: 4, version: 4, dirty: 0 });
const local = ws('ws-local-seed', { updatedAt: 500 });

describe('the one personal section', () => {
  it('draws two personal workspaces as a single section', () => {
    const groups = sidebarGroups([account, local], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe('Personal');
  });

  it('lists pages written on this device below the ones the account already had', () => {
    const notes = [
      note('mine-1', local.id),
      note('theirs-1', account.id),
      note('mine-2', local.id),
      note('theirs-2', account.id),
    ];
    expect(sidebarGroups([account, local], notes)[0]!.notes.map((n) => n.id)).toEqual([
      'theirs-1', 'theirs-2', 'mine-1', 'mine-2',
    ]);
  });

  it('carries the canonical workspace’s id, so collapsing the section survives the fold', () => {
    // the id is what `toggleGroup` remembers; taking it from whichever row Dexie returned first
    // would move the collapse state to a different section the moment a pull reordered the table
    expect(sidebarGroups([local, account], [])[0]!.id).toBe(account.id);
  });

  it('leaves shared spaces alone — there can be any number of those', () => {
    const kernel = ws('ws-kernel', { name: 'Kernel Labs', kind: 'shared', role: 'member' });
    const groups = sidebarGroups([kernel, account, local], [note('spec', kernel.id)]);
    expect(groups.map((g) => g.name)).toEqual(['Kernel Labs', 'Personal']);
    expect(groups[0]!.shared).toBe(true);
    expect(groups[0]!.notes.map((n) => n.id)).toEqual(['spec']);
  });

  it('folds the section in at the canonical workspace’s position, not at the end', () => {
    const kernel = ws('ws-kernel', { name: 'Kernel Labs', kind: 'shared', updatedAt: 200 });
    expect(sidebarGroups([account, kernel, local], []).map((g) => g.name)).toEqual([
      'Personal', 'Kernel Labs',
    ]);
  });

  it('still hides trashed and archived pages, from every personal workspace', () => {
    const notes = [
      note('kept', account.id),
      note('binned', account.id, { deletedAt: 900 }),
      note('shelved', local.id, { archived: 1 }),
      note('kept-local', local.id),
    ];
    expect(sidebarGroups([account, local], notes)[0]!.notes.map((n) => n.id)).toEqual([
      'kept', 'kept-local',
    ]);
  });

  it('is unchanged for the ordinary case of exactly one personal workspace', () => {
    const groups = sidebarGroups([account], [note('page', account.id)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe(account.id);
    expect(groups[0]!.notes.map((n) => n.id)).toEqual(['page']);
  });

  it('does not fold an unsorted workspace in — held imports are not your personal space', () => {
    // `kind: 'unsorted'` is where an import parks rows that have no home yet, and `collectDirty`
    // refuses to push them. Quietly listing them under PERSONAL would say they had arrived.
    const held = ws('ws-unsorted', { name: 'Unsorted', kind: 'unsorted', updatedAt: 700 });
    expect(sidebarGroups([account, local, held], []).map((g) => g.name)).toEqual([
      'Personal', 'Unsorted',
    ]);
  });
});

/**
 * A project is a workspace you made, and the sidebar must not mistake it for someone else's.
 *
 * Both failures here are silent and neither throws. A project created as `kind: 'personal'`
 * DISAPPEARS — folded into the one Personal section with its pages absorbed. And a project badged
 * SHARED announces that other people can see notes nobody has been invited to, which is the bug
 * design/retire-the-demo-shared-space.md exists about.
 */
describe('a project you created', () => {
  /** what `workspaceService.createProject()` writes: shared kind, admin role, active */
  const project = ws('ws-kernel', {
    name: 'Kernel Labs', kind: 'shared', role: 'admin', updatedAt: 700,
  });

  it('appears as its own section, beside PERSONAL and not inside it', () => {
    const groups = sidebarGroups([account, local, project], []);
    expect(groups.map((g) => g.name)).toEqual(['Personal', 'Kernel Labs']);
  });

  it('is flagged as a project, and only the PERSONAL fold is flagged personal', () => {
    const groups = sidebarGroups([account, local, project], []);
    expect(groups.map((g) => [g.name, g.personal])).toEqual([['Personal', true], ['Kernel Labs', false]]);
  });

  it('does NOT carry the shared badge — nobody has been invited to it yet', () => {
    // `kind: 'shared'` only means "not your private space". Reading the badge off `kind` is what
    // made every new project claim to be shared the moment it was created.
    const group = sidebarGroups([account, project], [])[1]!;
    expect(group.shared).toBe(false);
  });

  it('carries its own pages, and not the personal ones', () => {
    const notes = [note('spec', project.id), note('groceries', account.id)];
    const groups = sidebarGroups([account, project], notes);
    expect(groups[0]!.notes.map((n) => n.id)).toEqual(['groceries']);
    expect(groups[1]!.notes.map((n) => n.id)).toEqual(['spec']);
  });

  it('renders as an empty section when it has no pages — the state it is created in', () => {
    const groups = sidebarGroups([account, project], []);
    expect(groups[1]!.notes).toEqual([]);
  });

  it('still reads as shared when it is a space someone else administers', () => {
    // the distinction the badge is actually for: `role`, not `kind` — both of these are 'shared'
    const theirs = ws('ws-theirs', { name: 'Their Space', kind: 'shared', role: 'member' });
    const groups = sidebarGroups([account, project, theirs], []);
    expect(groups.map((g) => [g.name, g.shared])).toEqual([
      ['Personal', false], ['Kernel Labs', false], ['Their Space', true],
    ]);
  });

  it('is hidden once you leave it, like any other space', () => {
    const left = ws('ws-gone', { name: 'Gone', kind: 'shared', role: 'admin', membership: 'left' });
    // sidebarGroups is handed `visibleWorkspaces`, which is where the filter lives — assert the
    // contract it relies on rather than re-implementing it here
    const visible = [account, project, left].filter((w) => (w.membership ?? 'active') === 'active');
    expect(sidebarGroups(visible, []).map((g) => g.name)).toEqual(['Personal', 'Kernel Labs']);
  });
});

describe('pinned pages', () => {
  const project = ws('ws-kernel', { name: 'Kernel Labs', kind: 'shared', role: 'member' });

  it('go to the top of their own group, the rest keeping their order', () => {
    const notes = [
      note('a', project.id), note('b', project.id), note('c', project.id, { favorite: 1 }), note('d', project.id),
    ];
    const kernel = sidebarGroups([account, project], notes)[1]!;
    expect(kernel.notes.map((n) => [n.id, n.pinned])).toEqual([['c', true], ['a', false], ['b', false], ['d', false]]);
  });

  it('rise across the whole PERSONAL fold, not just within one of its rows', () => {
    const notes = [note('mine', local.id), note('theirs', account.id), note('pinned', local.id, { favorite: 1 })];
    expect(sidebarGroups([account, local], notes)[0]!.notes.map((n) => n.id)).toEqual(['pinned', 'theirs', 'mine']);
  });

  it('stay in the group they belong to', () => {
    const notes = [note('home', account.id), note('spec', project.id, { favorite: 1 })];
    expect(sidebarGroups([account, project], notes).map((g) => g.notes.map((n) => n.id))).toEqual([['home'], ['spec']]);
  });
});
