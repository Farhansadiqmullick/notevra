/**
 * The layout a person is handed to reconcile by hand.
 *
 * The rule under test is one sentence: **lines the two sides agree on are carried through; anything
 * that differs is marked.** Both halves matter. Merge too little and the author re-types text nobody
 * disputed; merge too much and the app has silently chosen a side, which is exactly the fabrication
 * the conflict dialog exists to avoid.
 */
import { describe, it, expect } from 'vitest';
import { mergeText, hasConflictMarkers, MARK_MINE, MARK_SPLIT, MARK_THEIRS } from './mergeText';

/** the marked region, so tests read as "what is contested" rather than as string surgery */
function hunk(text: string) {
  const lines = text.split('\n');
  const a = lines.indexOf(MARK_MINE);
  const b = lines.indexOf(MARK_SPLIT);
  const c = lines.indexOf(MARK_THEIRS);
  return { mine: lines.slice(a + 1, b), theirs: lines.slice(b + 1, c) };
}

describe('agreement is not a conflict', () => {
  it('identical text comes back untouched, with nothing to decide', () => {
    expect(mergeText('Ship the scheduler', 'Ship the scheduler')).toEqual({
      text: 'Ship the scheduler',
      hunks: 0,
    });
  });

  it('shared opening lines are kept out of the marked region', () => {
    const { text } = mergeText('Groceries\nOat milk\nCoffee', 'Groceries\nOat milk\nTea');

    expect(text.startsWith('Groceries\nOat milk\n')).toBe(true);
    expect(hunk(text)).toEqual({ mine: ['Coffee'], theirs: ['Tea'] });
  });

  it('shared closing lines too', () => {
    const { text } = mergeText('Coffee\nand milk', 'Tea\nand milk');

    expect(text.endsWith('\nand milk')).toBe(true);
    expect(hunk(text)).toEqual({ mine: ['Coffee'], theirs: ['Tea'] });
  });

  it('a shared line is never emitted twice when it is both prefix and suffix', () => {
    // "A" matches at the front; the tail scan must not claim it again from the back
    const { text } = mergeText('A\nB', 'A\nC');

    expect(text.split('\n').filter((l) => l === 'A')).toHaveLength(1);
  });
});

describe('what is contested is shown, not resolved', () => {
  it('wraps both sides in the markers everyone already knows', () => {
    const { text, hunks } = mergeText('mine', 'theirs');

    expect(hunks).toBe(1);
    expect(text).toBe([MARK_MINE, 'mine', MARK_SPLIT, 'theirs', MARK_THEIRS].join('\n'));
  });

  it('keeps each side whole rather than interleaving them line by line', () => {
    // one region to read, not five — block text is short and a shredded result is unusable
    const { text } = mergeText('one\ntwo\nthree', 'uno\ndos\ntres');

    expect(hunk(text)).toEqual({ mine: ['one', 'two', 'three'], theirs: ['uno', 'dos', 'tres'] });
  });

  it('an added line is a difference, not an agreement', () => {
    const { text } = mergeText('Ship it', 'Ship it\nby Friday');

    expect(hunk(text)).toEqual({ mine: [], theirs: ['by Friday'] });
  });

  it('handles one side being empty without pretending the other won', () => {
    const { text, hunks } = mergeText('', 'their words');

    expect(hunks).toBe(1);
    expect(hunk(text).theirs).toEqual(['their words']);
  });
});

describe('markers left behind', () => {
  it('are detected', () => {
    expect(hasConflictMarkers(mergeText('a', 'b').text)).toBe(true);
  });

  it('are not reported for ordinary text', () => {
    expect(hasConflictMarkers('a\nb\nc')).toBe(false);
  });

  it('do not false-positive on a line that merely starts with angle brackets', () => {
    // the check is whole-line, so a quoted email or a diff pasted into a note stays quiet
    expect(hasConflictMarkers('<<<<<<< this is my heading')).toBe(false);
    expect(hasConflictMarkers('======= not a marker, a rule')).toBe(false);
  });

  it('a finished merge reports clean', () => {
    expect(hasConflictMarkers('Ship it\nby Friday')).toBe(false);
  });
});
