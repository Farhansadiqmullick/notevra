import { describe, it, expect } from 'vitest';
import { isExistingAccount } from './existingAccount';

describe('isExistingAccount', () => {
  it('spots the hidden case: no error, a user with no identities', () => {
    expect(isExistingAccount({ identities: [] }, null)).toBe(true);
  });

  it('spots the explicit error, by code or by wording', () => {
    expect(isExistingAccount(null, { code: 'user_already_exists', message: '' })).toBe(true);
    expect(isExistingAccount(null, { message: 'User already registered' })).toBe(true);
  });

  it('treats a real new account as new', () => {
    expect(isExistingAccount({ identities: [{ provider: 'email' }] }, null)).toBe(false);
  });

  it('leaves other failures alone', () => {
    expect(isExistingAccount(null, { message: 'Password should be at least 6 characters' })).toBe(false);
    expect(isExistingAccount(null, null)).toBe(false);
  });
});
