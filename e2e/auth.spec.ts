import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp } from './helpers';

/**
 * Auth, from the outside.
 *
 * Split deliberately into two blocks, because the two states are both real and the first one is the
 * one most likely to be broken by accident:
 *
 *   - **Unconfigured** — no VITE_SUPABASE_* in the environment. This is a SUPPORTED way to run
 *     BlocNote, not a broken build: every note still saves, and nothing may gate the app. These
 *     tests always run, including in CI where no server exists.
 *   - **Configured** — pointed at the local Supabase stack. Skipped when it isn't there, because a
 *     suite that fails on a machine without Docker running teaches people to ignore red.
 */

/**
 * Is the app under test actually configured?
 *
 * Not the same question as "is it in my shell". Vite loads `.env.local` and `.env` **from disk**, so
 * a run with no exported variables still gets a fully configured app if `.env.local` exists — which
 * is the normal state of a development machine. Reading only `process.env` made the unconfigured
 * test run against a configured app and fail on a bug that was not there.
 *
 * So this asks the same sources Vite does, in the same precedence order.
 */
function isConfigured(): boolean {
  const fromShell = process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY;
  if (fromShell) return true;

  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const name of ['.env.local', '.env']) {
    // `.env.local` wins over `.env`, the same way Vite resolves them
    const file = join(root, name);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const url = /^VITE_SUPABASE_URL\s*=\s*(.+)$/m.exec(text)?.[1]?.trim();
    const key = /^VITE_SUPABASE_ANON_KEY\s*=\s*(.+)$/m.exec(text)?.[1]?.trim();
    if (url && key) return true;
  }
  return false;
}

const CONFIGURED = isConfigured();

/** Settings is behind the sidebar footer; the pane it opens is the same at every width above 900. */
async function openSettings(page: import('@playwright/test').Page) {
  await page.locator('.sidebar .foot-btn', { hasText: 'Settings' }).click();
  await expect(page.locator('.nav-label')).toHaveText('SETTINGS');
}

test.describe('the app is never gated behind an account', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'not width-dependent');
    await openApp(page);
  });

  test('no sign-in dialog appears on load', async ({ page }) => {
    // openApp already waited for seeded rows, so the app is fully booted by now
    await expect(page.locator('.scrim')).toHaveCount(0);
    await expect(page.locator('#auth-h')).toHaveCount(0);
  });

  test('notes can be written with nobody signed in', async ({ page }) => {
    const first = page.locator('.arow .editable').first();
    await first.click();
    await page.keyboard.type('!');
    // the write lands locally regardless of auth — that is the whole premise of the app
    await expect(page.locator('.arow .editable').first()).toContainText('!');
  });
});

test.describe('Settings › Profile reflects the auth state honestly', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'not width-dependent');
    await openApp(page);
    await openSettings(page);
  });

  test('an unconfigured build says Local only and offers no sign-in', async ({ page }) => {
    test.skip(CONFIGURED, 'a server is configured for this run');

    await expect(page.locator('.content .body')).toContainText('Local only');
    // the rule this project keeps returning to: no control that cannot work
    await expect(page.locator('.content .body button', { hasText: /^Sign in$/ })).toHaveCount(0);
    await expect(page.locator('.content .body button', { hasText: /^Sign out$/ })).toHaveCount(0);
  });

  test('a configured build offers a sign-in that opens the dialog', async ({ page }) => {
    test.skip(!CONFIGURED, 'no Supabase configured — run npm run db:start and set .env.local');

    await page.locator('.content .body button', { hasText: /^Sign in$/ }).click();
    await expect(page.locator('#auth-h')).toHaveText('Sign in');
  });
});

test.describe('the sign-in dialog', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'not width-dependent');
    test.skip(!CONFIGURED, 'no Supabase configured — run npm run db:start and set .env.local');
    await openApp(page);
    await openSettings(page);
    await page.locator('.content .body button', { hasText: /^Sign in$/ }).click();
    await expect(page.locator('#auth-h')).toBeVisible();
  });

  test('it can be dismissed — signing in is optional', async ({ page }) => {
    await page.locator('.dialog .foot button', { hasText: 'Not now' }).click();
    await expect(page.locator('#auth-h')).toHaveCount(0);
  });

  test('the submit button stays disabled until the form could possibly succeed', async ({ page }) => {
    const submit = page.locator('.dialog .foot button', { hasText: 'Sign in' });
    await expect(submit).toBeDisabled();

    await page.locator('#auth-email').fill('not-an-email');
    await page.locator('#auth-password').fill('password123');
    await expect(submit, 'a malformed address should not reach the server').toBeDisabled();

    await page.locator('#auth-email').fill('someone@example.com');
    await expect(submit).toBeEnabled();

    await page.locator('#auth-password').fill('short');
    await expect(submit, 'GoTrue requires 6 characters; say so before the round trip').toBeDisabled();
  });

  test('a wrong password does not reveal whether the account exists', async ({ page }) => {
    await page.locator('#auth-email').fill(`nobody-${Date.now()}@example.com`);
    await page.locator('#auth-password').fill('definitely-wrong');
    await page.locator('.dialog .foot button', { hasText: 'Sign in' }).click();

    const err = page.locator('.err[role="alert"]');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/don’t match/);
    await expect(err, 'this would be a user-enumeration oracle').not.toContainText(/no account|not found|does not exist/i);
  });

  test('sign up, then sign out, and the notes are still there', async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`;

    await page.locator('.swap button', { hasText: 'Create one' }).click();
    await expect(page.locator('#auth-h')).toHaveText('Create an account');

    await page.locator('#auth-email').fill(email);
    await page.locator('#auth-password').fill('password123');
    await page.locator('#auth-password-confirm').fill('password123');
    await page.locator('.dialog .foot button', { hasText: 'Create account' }).click();

    /*
     * `.content .body`, not `.body`.
     *
     * The Settings pane and this dialog's own <form> BOTH carry `class="body"`, so a bare `.body`
     * is a strict-mode violation for as long as the dialog is on screen — which is exactly the
     * window this assertion waits in. It surfaced as an intermittent failure rather than a constant
     * one because it only fires while both exist, so the test passed whenever the dialog happened to
     * close first.
     *
     * The generous timeout is separate and still warranted: creating an account is a real round trip
     * to GoTrue, and under a parallel suite it can outlast Playwright's 5s default.
     *
     * Local Supabase has email confirmation off, so a successful signup signs straight in and the
     * address appears in Settings behind the dialog.
     */
    await expect(page.locator('.content .body')).toContainText(email, { timeout: 15_000 });
    await expect(page.locator('#auth-h'), 'the dialog should close once signed in').toHaveCount(0);

    const rowsBefore = await page.locator('.arow').count();

    await page.locator('.content .body button', { hasText: /^Sign out$/ }).click();
    await expect(page.locator('.content .body button', { hasText: /^Sign in$/ })).toBeVisible();

    // THE assertion of this whole file: signing out is not a data-loss event
    await page.locator('.bar button', { hasText: 'Done' }).click();
    expect(await page.locator('.arow').count(), 'signing out deleted local notes').toBe(rowsBefore);
  });
});
