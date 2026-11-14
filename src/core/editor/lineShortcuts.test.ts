import { describe, expect, it } from 'vitest';
import { lineShortcut } from './lineShortcuts';

describe('lineShortcut', () => {
  it.each([
    ['- ', 'bulleted'],
    ['* ', 'bulleted'],
    ['1. ', 'numbered'],
    ['1) ', 'numbered'],
    ['[] ', 'task'],
    ['[ ] ', 'task'],
    ['> ', 'quote'],
    ['# ', 'heading'],
    ['## ', 'heading'],
    ['### ', 'heading'],
    ['```', 'code'],
    ['---', 'divider'],
  ])('%j in a Text block becomes %s', (text, type) => {
    expect(lineShortcut(text, 'paragraph')?.type).toBe(type);
  });

  it('[x] starts a ticked task, either case; [] and [ ] start an open one', () => {
    expect(lineShortcut('[x] ', 'paragraph')).toEqual({ type: 'task', props: {}, checked: 1 });
    expect(lineShortcut('[X] ', 'paragraph')?.checked).toBe(1);
    expect(lineShortcut('[ ] ', 'paragraph')?.checked).toBeUndefined();
  });

  it('lists start with one empty line, so the caret has somewhere to go', () => {
    expect(lineShortcut('- ', 'paragraph')?.props).toEqual({ items: [''] });
  });

  it('# is the large heading; ## and ### are the section size', () => {
    expect(lineShortcut('# ', 'paragraph')?.props).toEqual({ level: 1 });
    expect(lineShortcut('## ', 'paragraph')?.props).toEqual({ level: 2 });
    expect(lineShortcut('### ', 'paragraph')?.props).toEqual({ level: 2 });
  });

  it('a code block starts empty, not with the // code placeholder', () => {
    expect(lineShortcut('```', 'paragraph')?.props.code).toBe('');
  });

  it.each(['-x', '- x', 'a - ', '1.5', '2. ', '#hashtag', '#### ', '``', '--', ' - ', '>> '])(
    '%j does not convert',
    (text) => {
      expect(lineShortcut(text, 'paragraph')).toBeNull();
    },
  );

  it('works from a Task block too, except [] which it already is', () => {
    expect(lineShortcut('- ', 'task')?.type).toBe('bulleted');
    expect(lineShortcut('[] ', 'task')).toBeNull();
  });

  it('other blocks never convert', () => {
    expect(lineShortcut('- ', 'quote')).toBeNull();
    expect(lineShortcut('- ', 'heading')).toBeNull();
  });
});
