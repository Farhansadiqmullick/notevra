/**
 * GoTrue's error messages, translated into things a person can act on.
 *
 * Two reasons this exists rather than rendering `error.message` directly:
 *
 * 1. **They are developer strings.** "Invalid login credentials" and "For security purposes, you can
 *    only request this after 51 seconds" are accurate and tell the user nothing about what to do.
 * 2. **One of them leaks.** Distinguishing "no such account" from "wrong password" tells anybody who
 *    asks whether a given email has an account here, which is a user-enumeration oracle. GoTrue is
 *    already careful about this — it answers both with the same message — and this must not
 *    helpfully "improve" on it by guessing which case it was.
 *
 * Unknown messages pass through unchanged rather than being replaced with a generic apology: a
 * message we have not seen before is far more useful to a user (and to a bug report) than
 * "Something went wrong".
 */

/** matched case-insensitively as substrings, because GoTrue varies the exact wording by version */
const TRANSLATIONS: [pattern: string, message: string][] = [
  // Deliberately does NOT say which half was wrong — see the note above.
  ['invalid login credentials', 'That email and password don’t match. Check both and try again.'],
  ['email not confirmed', 'Confirm your email first — check your inbox for the link we sent.'],
  ['user already registered', 'That email already has an account. Sign in instead.'],
  ['already been registered', 'That email already has an account. Sign in instead.'],
  ['password should be at least', 'Use a longer password — at least 10 characters.'],
  ['unable to validate email address', 'That doesn’t look like an email address.'],
  ['signups not allowed', 'New accounts are closed at the moment.'],
  ['email rate limit exceeded', 'Too many emails just went out. Wait a minute and try again.'],
  ['for security purposes', 'That was just sent. Wait a moment before asking again.'],
  ['same as the old password', 'That’s the password you already have. Pick a different one.'],
  ['session', 'Your sign-in link has expired. Ask for a new one.'],
];

/**
 * A failure to reach the server at all is worth its own message, because the honest advice is the
 * opposite of the usual: nothing is lost, and there is nothing to retry. Notes are saved locally
 * whether or not this ever succeeds.
 */
const OFFLINE = 'Can’t reach the server. Your notes are safe on this device — try again when you’re back online.';

export function friendlyAuthError(error: unknown): string {
  if (!error) return '';

  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return OFFLINE;
  }

  for (const [pattern, message] of TRANSLATIONS) {
    if (lower.includes(pattern)) return message;
  }
  return raw;
}
