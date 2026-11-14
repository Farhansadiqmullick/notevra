import { describe, it, expect } from 'vitest';
import { slashAt, withoutCommand } from './useSlashMenu';

describe('slashAt', () => {
  it('opens at the start of the line, as before', () => {
    expect(slashAt('/ta')).toEqual({ start: 0, query: 'ta' });
  });

  it('opens after words already written', () => {
    expect(slashAt('Buy milk /task')).toEqual({ start: 9, query: 'task' });
    expect(slashAt('Buy milk /')).toEqual({ start: 9, query: '' });
  });

  it('stays shut inside a word, a path or a URL', () => {
    expect(slashAt('and/or')).toBeNull();
    expect(slashAt('see https://x.com/a')).toBeNull();
  });

  it('closes once a space follows the command', () => {
    expect(slashAt('ratio 1 / 2')).toBeNull();
  });
});

describe('withoutCommand', () => {
  it('drops the command at the end', () => {
    expect(withoutCommand('Buy milk /task', 9, 'task')).toBe('Buy milk ');
  });

  it('drops a command typed mid-line without leaving two spaces', () => {
    expect(withoutCommand('Buy /qu milk', 4, 'qu')).toBe('Buy milk');
  });

  it('leaves the text alone when there is no slash there', () => {
    expect(withoutCommand('Hello', 0, '')).toBe('Hello');
  });
});
