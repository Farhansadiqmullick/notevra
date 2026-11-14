import { describe, expect, it } from 'vitest';
import { createUndoStack, type Snapshot } from './undoStack';

const snap = (text: string): Snapshot => ({ text, start: text.length, end: text.length });

function stack() {
  let clock = 0;
  const s = createUndoStack({ now: () => clock });
  return { s, tick: (ms: number) => (clock += ms) };
}

describe('undo stack', () => {
  it('a burst of typing undoes in one step', () => {
    const { s, tick } = stack();
    s.reset(snap(''));
    for (const t of ['h', 'he', 'hel', 'hell', 'hello']) {
      s.record(snap(t));
      tick(100);
    }
    expect(s.undo()?.text).toBe('');
    expect(s.undo()).toBeNull();
  });

  it('a pause starts a new step', () => {
    const { s, tick } = stack();
    s.reset(snap(''));
    s.record(snap('one'));
    tick(1000);
    s.record(snap('one two'));
    expect(s.undo()?.text).toBe('one');
    expect(s.undo()?.text).toBe('');
  });

  it('formatting is always its own step', () => {
    const { s, tick } = stack();
    s.reset(snap(''));
    s.record(snap('word'));
    tick(10);
    s.record({ text: '**word**', start: 2, end: 6 }, true);
    expect(s.undo()?.text).toBe('word');
  });

  it('redo walks forward, and a new edit drops the redo trail', () => {
    const { s, tick } = stack();
    s.reset(snap('a'));
    tick(1000);
    s.record(snap('ab'));
    s.undo();
    expect(s.redo()?.text).toBe('ab');
    s.undo();
    tick(1000);
    s.record(snap('ax'));
    expect(s.redo()).toBeNull();
  });

  it('keeps the selection with each step', () => {
    const { s } = stack();
    s.reset({ text: 'word', start: 0, end: 4 });
    s.record({ text: '**word**', start: 2, end: 6 }, true);
    expect(s.undo()).toEqual({ text: 'word', start: 0, end: 4 });
  });

  it('records nothing when the text did not change', () => {
    const { s, tick } = stack();
    s.reset(snap('a'));
    tick(1000);
    s.record(snap('a'));
    expect(s.undo()).toBeNull();
  });
});
