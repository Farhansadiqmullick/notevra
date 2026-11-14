import { describe, it, expect } from 'vitest';
import { markdownToBlocks, markdownToTasks, isMultiLine, isMarkdownLine } from './pasteMarkdown';

const shape = (text: string) => markdownToBlocks(text).map(({ type, text: t, checked, props }) => ({ type, text: t, checked, props }));

describe('markdownToBlocks', () => {
  it('joins consecutive bullets into one list, either marker', () => {
    expect(shape('- milk\n* eggs\n- **bread**')).toEqual([
      { type: 'bulleted', text: '', checked: 0, props: { items: ['milk', 'eggs', '**bread**'] } },
    ]);
  });

  it('joins numbered lines, with . or )', () => {
    expect(shape('1. one\n2) two\n10. ten')).toEqual([
      { type: 'numbered', text: '', checked: 0, props: { items: ['one', 'two', 'ten'] } },
    ]);
  });

  it('starts a new list after something else', () => {
    expect(shape('- a\nText\n- b').map((b) => b.type)).toEqual(['bulleted', 'paragraph', 'bulleted']);
  });

  it('flattens indented sub-items into the same list', () => {
    expect(shape('- a\n  - b')[0]!.props.items).toEqual(['a', 'b']);
  });

  it('makes tasks, ticked for [x]', () => {
    expect(shape('- [ ] open\n- [x] done\n[] bare\n[X] caps')).toEqual([
      { type: 'task', text: 'open', checked: 0, props: {} },
      { type: 'task', text: 'done', checked: 1, props: {} },
      { type: 'task', text: 'bare', checked: 0, props: {} },
      { type: 'task', text: 'caps', checked: 1, props: {} },
    ]);
  });

  it('maps # to the large heading and ## / ### to the section heading', () => {
    expect(shape('# A\n## B\n### C').map((b) => b.props.level)).toEqual([1, 2, 2]);
  });

  it('makes one quote per line', () => {
    expect(shape('> first\n>second').map((b) => [b.type, b.text])).toEqual([['quote', 'first'], ['quote', 'second']]);
  });

  it('keeps a code fence whole, with its language and indentation', () => {
    expect(shape('```ts\nconst a = 1;\n  - not a list\n```\nafter')).toEqual([
      { type: 'code', text: '', checked: 0, props: { language: 'ts', filename: 'snippet', code: 'const a = 1;\n  - not a list' } },
      { type: 'paragraph', text: 'after', checked: 0, props: {} },
    ]);
  });

  it('runs an unclosed fence to the end, and defaults the language', () => {
    expect(shape('```\nx\ny')[0]!.props).toEqual({ language: 'text', filename: 'snippet', code: 'x\ny' });
  });

  it('makes dividers, Text for the rest, and skips blank lines', () => {
    expect(shape('Hello\n\n---\n\n| a | b |').map((b) => b.type)).toEqual(['paragraph', 'divider', 'paragraph']);
  });

  it('keeps inline markers and Bengali text as typed', () => {
    expect(shape('- **জরুরি** কাজ\nদেখো [লিংক](https://example.com)').map((b) => b.text || b.props.items)).toEqual([
      ['**জরুরি** কাজ'],
      'দেখো [লিংক](https://example.com)',
    ]);
  });

  it('does not treat mid-word or spaceless starts as markdown', () => {
    expect(shape('-x\n1.5 litres\n#tag').map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  });

  it('reads Windows line endings', () => {
    expect(shape('- a\r\n- b')[0]!.props.items).toEqual(['a', 'b']);
  });
});

describe('markdownToTasks', () => {
  const tasks = (text: string) => markdownToTasks(text).map((b) => [b.type, b.text, b.checked]);

  it('makes every line a task, list markers dropped and [x] ticked', () => {
    expect(tasks('- milk\n* eggs\n1. first\n- [ ] call\n- [x] paid')).toEqual([
      ['task', 'milk', 0], ['task', 'eggs', 0], ['task', 'first', 0], ['task', 'call', 0], ['task', 'paid', 1],
    ]);
  });

  it('keeps headings, quotes and Text as plain task text, and skips dividers', () => {
    expect(tasks('# Plan\n> note\n---\nJust a line')).toEqual([['task', 'Plan', 0], ['task', 'note', 0], ['task', 'Just a line', 0]]);
  });

  it('keeps a code fence as one task', () => {
    expect(tasks('```\na\nb\n```')).toEqual([['task', 'a\nb', 0]]);
  });
});

describe('isMarkdownLine', () => {
  it.each(['---', '# Title', '- item', '1. item', '[x] done', '- [ ] open', '> note', '  ---  \n'])('%j is a block on its own', (t) => {
    expect(isMarkdownLine(t)).toBe(true);
  });

  it.each(['Just a sentence', 'https://', '**bold** words', '#tag', '-x', 'a\n- b'])('%j is not', (t) => {
    expect(isMarkdownLine(t)).toBe(false);
  });
});

describe('isMultiLine', () => {
  it('needs two non-blank lines, or a fence', () => {
    expect(isMultiLine('one line')).toBe(false);
    expect(isMultiLine('one line\n\n')).toBe(false);
    expect(isMultiLine('a\nb')).toBe(true);
    expect(isMultiLine('```js')).toBe(true);
  });
});
