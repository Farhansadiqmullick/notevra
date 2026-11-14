import { test, expect, type Page, type Browser } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, typeAtEnd, selectRow, outboxDepth, openNote } from './helpers';

/**
 * Two browsers, one account, the same notes — the thing the whole sync stack exists to do.
 *
 * Every other test of sync so far has been half of it. `engine.test.ts` proves the outbox against
 * an in-memory server; `npm run db:verify` proves `sync_push` / `sync_pull` and RLS against real
 * Postgres with real JWTs. Neither proves that the two halves speak the same language, and the
 * failures in that gap are the quiet kind: an operation that pushes successfully and arrives with
 * `note_id` where the reader expects `noteId`, a checkbox that comes back unticked because Dexie
 * says `1` and Postgres says `true`. Nothing throws. The only way to catch it is to actually run
 * two browsers.
 *
 * Two separate CONTEXTS, not two tabs: a context is a separate IndexedDB and a separate session, so
 * this is genuinely a second device. Same account, different `sync.deviceId` — which is the axis
 * `sync_pull` filters on, because your other browser is you and its edits must arrive.
 */

/** Same question, and same answer, as e2e/auth.spec.ts — Vite reads .env.local from disk. */
function isConfigured(): boolean {
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) return true;
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const name of ['.env.local', '.env']) {
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
const PASSWORD = 'password123';

async function openSettings(page: Page) {
  await page.locator('.sidebar .foot-btn', { hasText: 'Settings' }).click();
  await expect(page.locator('.nav-label')).toHaveText('SETTINGS');
}

async function closeSettings(page: Page) {
  await page.locator('.bar button', { hasText: 'Done' }).click();
}

/** Create the account, from the dialog, exactly as a person would. */
async function signUp(page: Page, email: string) {
  await openSettings(page);
  await page.locator('.content .body button', { hasText: /^Sign in$/ }).click();
  await page.locator('.swap button', { hasText: 'Create one' }).click();
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill(PASSWORD);
  await page.locator('#auth-password-confirm').fill(PASSWORD);
  await page.locator('.dialog .foot button', { hasText: 'Create account' }).click();
  // local Supabase has confirmations off, so a successful signup signs straight in
  await expect(page.locator('.content .body')).toContainText(email, { timeout: 20_000 });
}

async function signIn(page: Page, email: string) {
  await openSettings(page);
  await page.locator('.content .body button', { hasText: /^Sign in$/ }).click();
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill(PASSWORD);
  await page.locator('.dialog .foot button', { hasText: /^Sign in$/ }).click();
  await expect(page.locator('.content .body')).toContainText(email, { timeout: 20_000 });
}

/**
 * Push everything, then wait for the outbox to be genuinely empty.
 *
 * `Sync now` is used rather than the engine's own debounce because a test should assert on a state,
 * not on a schedule — and the outbox is the state: an operation leaves it only on a confirmed ACK.
 * The generous timeout covers a first push that also carries the backfilled library.
 */
async function syncAndDrain(page: Page) {
  // Sync & Storage is a vertical tab, and Settings opens on Profile
  await page.locator('.nav .nav-row', { hasText: 'Sync & Storage' }).click();
  await page.locator('.syncnow').click();
  await expect.poll(() => outboxDepth(page), { timeout: 30_000 }).toBe(0);
}

/**
 * Wait for a just-typed edit to reach the outbox, BEFORE asking anyone to drain it.
 *
 * `syncAndDrain` polls the outbox down to zero, and an outbox that has not been written to yet is
 * already zero — so calling it straight after typing returns instantly, having pushed nothing. Text
 * is saved on a 300ms debounce, so the operation is enqueued *after* that check, pushed on the
 * engine's own schedule, and lands on the server some time after the other browser has pulled.
 *
 * The test then depends on the 20-second poller firing inside a 20-second assertion window, which
 * is a coin toss — and it fails as "the edit never synced" rather than as "the fixture did not wait
 * for it". Waiting for the queue to become NON-empty first is the precondition that was missing:
 * it asserts the write happened before asserting it was sent.
 */
async function queuedThenDrain(page: Page) {
  await expect.poll(() => outboxDepth(page), { timeout: 10_000 }).toBeGreaterThan(0);
  await openSettings(page);
  await syncAndDrain(page);
}

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/**
 * Empty the server's tables between tests — and why that is necessary rather than tidy.
 *
 * `seedIfEmpty` writes a demo library with FIXED ids: `ws-personal`, `note-groceries`, `blk-g1`.
 * Every install has the same ones, and a primary key in Postgres is global, so the SECOND account
 * to sign in to the same database collides on `workspaces_pkey` and its entire library is rejected.
 * That is a real bug and it is written up in design/ui-test-plan.md §X — it is not what these tests
 * are for, and left in place it would make every case after the first one fail for the wrong reason.
 *
 * `psql` rather than the REST API because this deletes across RLS, which is the point: it is a
 * local-only fixture standing in for a fresh database. The whole block skips if it is unavailable.
 */
const PSQL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
function resetServer(): boolean {
  try {
    execFileSync('psql', [PSQL, '-q', '-c', 'truncate public.workspaces, public.sync_ops cascade;'], {
      stdio: 'ignore',
      env: { ...process.env, PGPASSWORD: 'postgres' },
    });
    return true;
  } catch {
    return false;
  }
}

test.describe('two browsers, one account', () => {
  test.skip(!CONFIGURED, 'no Supabase configured — run npm run db:start and set .env.local');

  // one width is enough: nothing here is about layout, and a second run would race the first for
  // the same account on the same server
  test.beforeEach(({}, testInfo) => {
    test.setTimeout(120_000); // two full signups and two backfill pushes, on a real server
    test.skip(testInfo.project.name !== 'desktop', 'not width-dependent');
    test.skip(!resetServer(), 'psql is not on PATH — cannot give this test a clean database');
  });

  test('a page written in one browser appears in the other', async ({ browser }) => {
    const email = `sync-${Date.now()}@example.com`;
    const TITLE = `Notes from browser A ${Date.now()}`;

    // ---- browser A: sign up, write, push -------------------------------------------------
    const a = await freshPage(browser);
    await openApp(a);
    await signUp(a, email);
    await closeSettings(a);

    // signing in backfills the seeded library into the outbox, which is what makes the workspace
    // exist server-side — without it every note that hangs off it is refused by RLS
    await openSettings(a);
    await syncAndDrain(a);
    await closeSettings(a);

    // an Archive row is inert until it is selected — a first click picks the item, a second puts
    // the caret in its text (design/archive-row-interaction.md)
    const row = a.locator('.arow').first();
    await selectRow(a, row);
    await row.locator('.editable').click();
    await typeAtEnd(a, row.locator('.editable'), ` — ${TITLE}`);
    await expect(row.locator('.editable')).toContainText(TITLE);

    await queuedThenDrain(a);

    // ---- browser B: a different device, same person --------------------------------------
    const b = await freshPage(browser);
    await openApp(b);
    await signIn(b, email);
    await syncAndDrain(b); // push B's own backfill, then pull A's work

    await closeSettings(b);
    /*
     * Open the page rather than assuming B lands on it.
     *
     * This used to work by accident: every install seeded `note-groceries`, and the app opened that
     * exact id, so both browsers happened to start on the same page. Ids are per-install now and a
     * second device adopts the account's library wholesale, so B opens the first page in its own
     * space — which is correct behaviour (the landing page is a per-device preference, not synced
     * state) and simply not the page this assertion is about.
     */
    await openNote(b, 'Groceries');

    // THE assertion. B never typed this.
    await expect(b.locator('.arow').filter({ hasText: TITLE }).first()).toBeVisible({ timeout: 20_000 });

    await a.context().close();
    await b.context().close();
  });

  test('a ticked checkbox arrives ticked, not merely present', async ({ browser }) => {
    /*
     * Its own test because it is its own failure. `checked` is `0 | 1` in Dexie (which cannot index
     * a boolean) and `boolean` in Postgres, so the transport converts both ways. Get it wrong and
     * the task syncs perfectly and arrives unticked — no error, no outcome, nothing to notice
     * except work that quietly came back undone.
     */
    const email = `sync-tick-${Date.now()}@example.com`;

    const a = await freshPage(browser);
    await openApp(a);
    await signUp(a, email);
    await closeSettings(a);

    const row = a.locator('.arow').filter({ hasText: 'Oat milk' }).first();
    await row.locator('[role="checkbox"], input[type="checkbox"]').first().click();
    await expect(row).toHaveClass(/done/);

    await openSettings(a);
    await syncAndDrain(a);

    const b = await freshPage(browser);
    await openApp(b);
    await signIn(b, email);
    await syncAndDrain(b);
    await closeSettings(b);
    // B opens its own first page, not necessarily this one — see the note in the test above
    await openNote(b, 'Groceries');

    // "All" so the assertion doesn't depend on which list a done item lands in
    await b.locator('.filters button, .filters .pill', { hasText: 'All' }).first().click();
    await expect(b.locator('.arow').filter({ hasText: 'Oat milk' }).first()).toHaveClass(/done/, { timeout: 20_000 });

    await a.context().close();
    await b.context().close();
  });

  test('signing in does not flood the user with conflicts about their own library', async ({ browser }) => {
    /*
     * Both devices backfill the SAME seeded rows, so B sends a Create for every row A already sent.
     * Read as a version clash that is one dialog per row, asking a person to arbitrate hundreds of
     * differences that do not exist. `sync_push` acks a Create it already holds instead — this is
     * the test that would catch that rule being lost.
     */
    const email = `sync-dup-${Date.now()}@example.com`;

    const a = await freshPage(browser);
    await openApp(a);
    await signUp(a, email);
    await syncAndDrain(a);

    const b = await freshPage(browser);
    await openApp(b);
    await signIn(b, email);
    await syncAndDrain(b);

    // the conflict banner is what a person would actually see
    await expect(b.locator('.conflict-card')).toHaveCount(0);

    await a.context().close();
    await b.context().close();
  });
});

/**
 * The four answers to a conflict, against the real server.
 *
 * `engine.test.ts` proves each of them over an in-memory transport. What it cannot prove is that a
 * person clicking the button gets the outcome the engine implements — the dialog reads the server's
 * row, which arrives in Postgres's vocabulary, and a rename that survives a unit test dies here.
 *
 * The conflict is staged with the developer control in Settings, which against Supabase pushes a
 * real operation under a different `device_id`. That is not a mock: by every definition the server
 * uses, it is a second device.
 */
test.describe('resolving a conflict', () => {
  test.skip(!CONFIGURED, 'no Supabase configured — run npm run db:start and set .env.local');

  /*
   * A real signup plus a first push that carries the whole backfilled library takes longer than
   * Playwright's 30s default. Raised rather than trimmed: the setup IS the thing under test.
   */
  test.beforeEach(async ({}, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== 'desktop', 'not width-dependent');
    test.skip(!resetServer(), 'psql is not on PATH — cannot give this test a clean database');
  });

  /** signed in, library on the server, and one block in conflict */
  async function staged(browser: Browser): Promise<Page> {
    const page = await freshPage(browser);
    await openApp(page);
    await signUp(page, `conflict-${Date.now()}@example.com`);
    // the block has to exist server-side before another device can edit it
    await syncAndDrain(page);

    await page.locator('.card', { hasText: 'Developer' }).getByRole('button', { name: 'Stage a conflict' }).click();
    await expect(page.locator('.conflict-card')).toBeVisible({ timeout: 20_000 });
    await page.locator('.conflict-card button', { hasText: /^Review/ }).click();
    await expect(page.locator('.dlg[aria-label="Resolve sync conflicts"]')).toBeVisible();
    return page;
  }

  const act = (page: Page, label: string | RegExp) => page.locator('.dlg .acts button', { hasText: label }).click();

  test('the dialog shows both versions, and which is which', async ({ browser }) => {
    const page = await staged(browser);

    await expect(page.locator('.dlg .col.mine')).toContainText('a line you added here');
    await expect(page.locator('.dlg .col.theirs')).toContainText('and a line the other device added');

    await page.context().close();
  });

  test('“Keep mine” wins and the queue drains', async ({ browser }) => {
    const page = await staged(browser);

    await act(page, /^Keep mine$/);
    await expect(page.locator('.dlg[aria-label="Resolve sync conflicts"]')).toHaveCount(0);
    await expect.poll(() => outboxDepth(page), { timeout: 30_000 }).toBe(0);

    // my text is on the page and the conflict is gone — not parked, not silently reverted
    await expect(page.locator('.conflict-card')).toHaveCount(0);
    await page.locator('.bar button', { hasText: 'Done' }).click();
    await expect(page.locator('.arow').filter({ hasText: 'a line you added here' }).first()).toBeVisible();

    await page.context().close();
  });

  test('“Keep theirs” drops my edit and takes the synced copy', async ({ browser }) => {
    const page = await staged(browser);

    await act(page, /^Keep theirs$/);
    await expect.poll(() => outboxDepth(page), { timeout: 30_000 }).toBe(0);

    // the other device's operation is still waiting to be pulled — it came from another device_id,
    // so this one genuinely receives it
    await syncAndDrain(page);
    await page.locator('.bar button', { hasText: 'Done' }).click();

    await expect(
      page.locator('.arow').filter({ hasText: 'and a line the other device added' }).first(),
    ).toBeVisible({ timeout: 20_000 });

    await page.context().close();
  });

  test('“Keep both” leaves two blocks and invents nothing', async ({ browser }) => {
    const page = await staged(browser);
    await page.locator('.dlg .x').click();
    await page.locator('.bar button', { hasText: 'Done' }).click();
    // wait for the list to be BACK before counting it — Settings closing is not instantaneous, and
    // a count of 0 taken mid-transition makes the assertion below expect exactly one row
    await expect(page.locator('.arow').first()).toBeVisible();
    const before = await page.locator('.arow').count();

    await page.locator('.sidebar .foot-btn', { hasText: 'Settings' }).click();
    await page.locator('.nav .nav-row', { hasText: 'Sync & Storage' }).click();
    await page.locator('.conflict-card button', { hasText: /^Review/ }).click();
    await act(page, /^Keep both$/);
    await expect.poll(() => outboxDepth(page), { timeout: 30_000 }).toBe(0);

    await page.locator('.bar button', { hasText: 'Done' }).click();
    // their version on the original row, mine on a new one directly below it
    await expect.poll(() => page.locator('.arow').count(), { timeout: 20_000 }).toBe(before + 1);

    await page.context().close();
  });

  test('“Edit and merge” hands over both sides with markers, and saves what I write', async ({ browser }) => {
    const page = await staged(browser);

    await act(page, 'Edit and merge');

    // `toHaveValue`, not `toContainText`: a textarea's contents are its `value`, and its
    // `textContent` is the empty string the markup was rendered with — the assertion would pass
    // against a blank editor and fail against a correct one.
    const editor = page.locator('.dlg .mtext');
    await expect(editor).toBeVisible();
    // the shared first line is already merged; only the part that differs is marked
    await expect(editor).toHaveValue(/<<<<<<< yours/);
    await expect(editor).toHaveValue(/^=======$/m);
    await expect(editor).toHaveValue(/>>>>>>> theirs \(synced\)/);
    await expect(editor).toHaveValue(/a line you added here/);
    await expect(editor).toHaveValue(/and a line the other device added/);

    await editor.fill('Coffee beans — the Ethiopian one, decided by hand');
    await page.locator('.dlg .acts button', { hasText: 'Save merge' }).click();

    await expect(page.locator('.dlg[aria-label="Resolve sync conflicts"]')).toHaveCount(0);
    await expect.poll(() => outboxDepth(page), { timeout: 30_000 }).toBe(0);

    await page.locator('.bar button', { hasText: 'Done' }).click();
    await expect(page.locator('.arow').filter({ hasText: 'decided by hand' }).first()).toBeVisible();

    await page.context().close();
  });

  test('leaving markers in warns, and still lets it through — it is their document', async ({ browser }) => {
    const page = await staged(browser);
    await act(page, 'Edit and merge');

    await expect(page.locator('.dlg .mwarn')).toBeVisible();
    await expect(page.locator('.dlg .acts button', { hasText: 'Save merge' })).toBeEnabled();

    await page.context().close();
  });
});
