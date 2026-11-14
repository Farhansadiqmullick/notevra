/**
 * The auth error translations.
 *
 * The security-relevant case is first, and it is the reason this file exists at all: the sign-in
 * failure must not reveal whether the account exists. That is easy to break by being helpful — a
 * future "no account with that email, want to sign up?" would be a user-enumeration oracle bolted
 * onto the login form, and it would look like an improvement in review.
 */
import { describe, it, expect } from 'vitest';
import { friendlyAuthError } from './authErrors';

describe('sign-in failure does not say which half was wrong', () => {
  it('translates the credentials error without naming email or password as the culprit', () => {
    const msg = friendlyAuthError(new Error('Invalid login credentials'));

    expect(msg).toBe('That email and password don’t match. Check both and try again.');
    // the leak would be a message that singles out one of them
    expect(msg).not.toMatch(/no account|not found|does not exist|unknown email|wrong password|incorrect password/i);
  });
});

describe('translations', () => {
  it.each([
    ['Email not confirmed', /confirm your email/i],
    ['User already registered', /already has an account/i],
    ['Password should be at least 6 characters', /longer password/i],
    ['Unable to validate email address: invalid format', /doesn’t look like an email/i],
    ['Email rate limit exceeded', /too many emails/i],
    ['For security purposes, you can only request this after 51 seconds', /wait a moment/i],
  ])('%s', (raw, expected) => {
    expect(friendlyAuthError(new Error(raw))).toMatch(expected);
  });

  it('is case-insensitive, because GoTrue changes capitalisation between versions', () => {
    expect(friendlyAuthError(new Error('INVALID LOGIN CREDENTIALS'))).toMatch(/don’t match/);
  });

  it('reassures rather than alarms when the server is unreachable', () => {
    const msg = friendlyAuthError(new TypeError('Failed to fetch'));

    // the honest advice is the opposite of the usual: nothing was lost, nothing needs retrying
    expect(msg).toMatch(/notes are safe on this device/i);
  });
});

describe('unknown errors', () => {
  it('passes an unrecognised message through instead of replacing it with an apology', () => {
    // a message we have not seen is more useful to the user and to a bug report than "Oops"
    expect(friendlyAuthError(new Error('Provider is disabled'))).toBe('Provider is disabled');
  });

  it('handles a non-Error and a null without throwing', () => {
    expect(friendlyAuthError('plain string')).toBe('plain string');
    expect(friendlyAuthError(null)).toBe('');
    expect(friendlyAuthError(undefined)).toBe('');
  });
});
