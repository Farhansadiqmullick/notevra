/**
 * Reading an assignee off a block.
 *
 * The first case is the regression this file exists for: an assignee written by the properties
 * panel is an object, and `BlockTask` used to cast it to `string` and hand it straight to the
 * avatar, which rendered `[object Object]` on the task chip. A cast asserts a shape instead of
 * checking one, so nothing failed at build time and nothing failed at run time — it was only
 * visible on screen, on the one path where someone had actually assigned a task.
 */
import { describe, it, expect } from 'vitest';
import { readAssignee } from './assignee';

describe('the shape that put [object Object] on screen', () => {
  it('reads initials out of the object the properties panel writes', () => {
    const a = readAssignee({ id: 'u-maya', name: 'Maya K.', initials: 'MK' });

    expect(a).toEqual({ id: 'u-maya', name: 'Maya K.', initials: 'MK' });
    // the failure was stringifying the object rather than reaching into it
    expect(a?.initials).not.toMatch(/object/i);
  });
});

describe('both shapes on disk', () => {
  it('treats a bare string as initials, and as the only name that row knows', () => {
    expect(readAssignee('MK')).toEqual({ id: undefined, name: 'MK', initials: 'MK' });
  });

  it('fills a missing half from the other rather than rendering a blank avatar', () => {
    expect(readAssignee({ initials: 'ST' })?.name).toBe('ST');
    expect(readAssignee({ name: 'Sam T.' })?.initials).toBe('Sam T.');
  });

  it('keeps the id when there is one, because that is what will resolve to an account', () => {
    expect(readAssignee({ id: 'u-sam', name: 'Sam T.', initials: 'ST' })?.id).toBe('u-sam');
    expect(readAssignee('ST')?.id).toBeUndefined();
  });
});

describe('nobody is assigned', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['an empty object', {}],
    ['an object with blank fields', { name: '  ', initials: '' }],
    ['a number', 42],
  ])('returns undefined for %s', (_label, value) => {
    expect(readAssignee(value)).toBeUndefined();
  });

  it('does not invent an assignment from a malformed row', () => {
    // rendering an empty avatar here would be indistinguishable from a real person with no name
    expect(readAssignee({ id: 'u-ghost' })).toBeUndefined();
  });
});
