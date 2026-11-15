import { describe, expect, it } from 'vitest';
import type { NoteRow } from '@/core/db/schema';
import { addDays, changedPages, dayStart, monthRange, pagesPerDay, rangeFor } from './changes';

const noon = new Date(2026, 10, 15, 12, 0).getTime();
const at = (daysAgo: number, hour = 10) => {
  const d = new Date(addDays(noon, -daysAgo));
  d.setHours(hour);
  return d.getTime();
};

const note = (id: string, extra: Partial<NoteRow> = {}): NoteRow => ({
  id, workspaceId: 'ws-p', title: id, type: 'planning', archived: 0, favorite: 0, deletedAt: null,
  updatedAt: at(20), version: 1, syncedVersion: 1, dirty: 0, ...extra,
});
const spaces = new Map([['ws-p', 'Personal']]);

describe('rangeFor', () => {
  it('today runs from this midnight to the next', () => {
    const r = rangeFor('today', noon);
    expect(r.from).toBe(dayStart(noon));
    expect(r.to).toBe(addDays(noon, 1));
  });
  it('yesterday ends where today starts', () => {
    expect(rangeFor('yesterday', noon).to).toBe(rangeFor('today', noon).from);
  });
  it('last 7 days includes today and six days before it', () => {
    expect(rangeFor('week', noon).from).toBe(addDays(noon, -6));
  });
});

describe('changedPages', () => {
  it('finds a page by a block edited in the window, even when the page row is older', () => {
    const pages = changedPages([note('a')], [{ noteId: 'a', at: at(0) }], spaces, rangeFor('today', noon));
    expect(pages.map((p) => p.id)).toEqual(['a']);
    expect(pages[0]!.changedAt).toBe(at(0));
  });

  it('lists a page on a past day when one of its blocks was last changed then', () => {
    const touches = [{ noteId: 'a', at: at(1) }, { noteId: 'a', at: at(0) }];
    expect(changedPages([note('a')], touches, spaces, rangeFor('yesterday', noon)).map((p) => p.id)).toEqual(['a']);
  });

  it('marks pages made inside the window as created', () => {
    const pages = changedPages([note('a', { createdAt: at(2), updatedAt: at(2) })], [], spaces, rangeFor('week', noon));
    expect(pages[0]!.created).toBe(true);
  });

  it('leaves out archived and deleted pages', () => {
    const notes = [note('a', { archived: 1, updatedAt: at(0) }), note('b', { deletedAt: at(0), updatedAt: at(0) })];
    expect(changedPages(notes, [], spaces, rangeFor('today', noon))).toEqual([]);
  });

  it('puts the most recent first', () => {
    const notes = [note('old', { updatedAt: at(0, 8) }), note('new', { updatedAt: at(0, 11) })];
    expect(changedPages(notes, [], spaces, rangeFor('today', noon)).map((p) => p.id)).toEqual(['new', 'old']);
  });
});

describe('pagesPerDay', () => {
  it('counts each page once per day it was touched', () => {
    const touches = [{ noteId: 'a', at: at(3, 9) }, { noteId: 'a', at: at(3, 15) }, { noteId: 'b', at: at(3) }, { noteId: 'a', at: at(0) }];
    const days = pagesPerDay([note('a'), note('b')], touches, monthRange(noon));
    expect(days.get(dayStart(at(3)))).toBe(2);
    expect(days.get(dayStart(at(0)))).toBe(1);
  });
});
