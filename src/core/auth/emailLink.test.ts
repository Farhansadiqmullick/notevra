import { describe, expect, it } from 'vitest';
import { readEmailLink } from './emailLink';

describe('readEmailLink', () => {
  it('reads a reset link', () => {
    expect(readEmailLink('?token_hash=h1&type=recovery')).toEqual({ tokenHash: 'h1', type: 'recovery' });
  });

  it('reads a confirm link', () => {
    expect(readEmailLink('?token_hash=h2&type=email')).toEqual({ tokenHash: 'h2', type: 'email' });
  });

  it('ignores a type the templates never send', () => {
    expect(readEmailLink('?token_hash=h3&type=invite')).toBeNull();
  });

  it('ignores a page that is not an email link', () => {
    expect(readEmailLink('')).toBeNull();
    expect(readEmailLink('?code=c1')).toBeNull();
    expect(readEmailLink('?type=recovery')).toBeNull();
  });
});
