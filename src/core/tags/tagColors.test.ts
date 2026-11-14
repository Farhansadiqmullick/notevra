import { describe, expect, it } from 'vitest';
import { defaultRole, renameInList, resolveRole, TAG_ROLES } from './tagColors';

describe('defaultRole', () => {
  it('gives well-known names their matching role, in any case', () => {
    expect(defaultRole('urgent')).toBe('urgent');
    expect(defaultRole(' Blocked ')).toBe('blocked');
    expect(defaultRole('Household')).toBe('personal');
    expect(defaultRole('meeting')).toBe('work');
  });

  it('is the same for the same name, on every call', () => {
    expect(defaultRole('groceries')).toBe(defaultRole('Groceries'));
    expect(TAG_ROLES).toContain(defaultRole('groceries'));
  });

  it('never hands an unknown name an alarming or neutral role', () => {
    for (const name of ['alpha', 'beta', 'gamma', 'q3-launch', 'reading', 'travel', 'x', 'zz top']) {
      expect(['urgent', 'blocked', 'neutral']).not.toContain(defaultRole(name));
    }
  });
});

describe('resolveRole', () => {
  it('a picked colour wins, keyed by lower-cased name', () => {
    expect(resolveRole('Groceries', { groceries: 'urgent' })).toBe('urgent');
  });

  it('ignores a value that is not a role (old hex, junk)', () => {
    expect(resolveRole('urgent', { urgent: '#ef4444' })).toBe('urgent');
    expect(resolveRole('groceries', { groceries: 'banana' })).toBe(defaultRole('groceries'));
  });
});

describe('renameInList', () => {
  it('renames case-insensitively and keeps the order', () => {
    expect(renameInList(['a', 'Urgent', 'b'], 'urgent', 'asap')).toEqual(['a', 'asap', 'b']);
  });

  it('merges without leaving a duplicate', () => {
    expect(renameInList(['urgent', 'asap'], 'urgent', 'ASAP')).toEqual(['ASAP']);
  });

  it('folds case variants into one spelling', () => {
    expect(renameInList(['Urgent', 'urgent'], 'Urgent', 'urgent')).toEqual(['urgent']);
  });
});
