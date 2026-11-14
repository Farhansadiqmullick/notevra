import { test, expect, type Page, type Browser } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { openNote, outboxDepth } from './helpers';

// Needs `npm run db:seed:users`; unlike sync.spec.ts this never truncates, so the seeded space survives.
const PSQL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const PASSWORD = 'devpass123';
const PAGE = 'Sync engine spec';
const NOTE = '5eed0000-0000-4000-8000-000000000002';

function sql(query: string): string {
  return execFileSync('psql', [PSQL, '-tAq', '-c', query], { env: { ...process.env, PGPASSWORD: 'postgres' } })
    .toString()
    .trim();
}

function seeded(): boolean {
  try {
    return sql(`select count(*) from public.notes where id = '${NOTE}'`) === '1';
  } catch {
    return false;
  }
}

const checkedOnServer = (text: string) => sql(`select checked from public.blocks where note_id = '${NOTE}' and text = '${text}'`);

async function openSync(page: Page) {
  await page.locator('.sidebar .foot-btn', { hasText: 'Settings' }).click();
  await expect(page.locator('.nav-label')).toHaveText('SETTINGS');
  await page.locator('.nav .nav-row', { hasText: 'Sync & Storage' }).click();
}

async function closeSettings(page: Page) {
  await page.locator('.bar button', { hasText: 'Done' }).click();
}

async function signInAs(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  // a fresh install starts empty now, so wait for the shell rather than openApp's seeded row
  await page.goto('/');
  await page.locator('.sidebar .foot-btn', { hasText: 'Settings' }).click();
  await page.locator('.content .body button', { hasText: /^Sign in$/ }).click();
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill(PASSWORD);
  await page.locator('.dialog .foot button', { hasText: /^Sign in$/ }).click();
  await expect(page.locator('.content .body')).toContainText(email, { timeout: 20_000 });
  await page.locator('.nav .nav-row', { hasText: 'Sync & Storage' }).click();
  await page.locator('.syncnow').click();
  await expect(page.locator('.syncnow')).toHaveText('Sync now', { timeout: 30_000 });
  await closeSettings(page);
  await openNote(page, PAGE);
  return page;
}

async function syncNow(page: Page) {
  await openSync(page);
  await page.locator('.syncnow').click();
  await expect(page.locator('.syncnow')).toHaveText('Sync now', { timeout: 30_000 });
}

test.describe('roles in a shared space', () => {
  test.beforeEach(({}, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== 'desktop', 'not width-dependent');
    test.skip(!seeded(), 'run npm run db:seed:users first');
  });

  test('a guest can open the page, but their edit is refused and explained', async ({ browser }) => {
    const page = await signInAs(browser, 'guest@example.com');
    await expect(page.getByRole('checkbox', { name: 'Write the RFC' })).toBeVisible();

    await page.getByRole('checkbox', { name: 'Write the RFC' }).click();
    await expect.poll(() => outboxDepth(page), { timeout: 10_000 }).toBeGreaterThan(0);
    await syncNow(page);

    await expect(page.locator('.stalled-card')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.stalled-card .reason')).toContainText('permission denied');
    expect(checkedOnServer('Write the RFC')).toBe('f');
    await page.context().close();
  });

  test('a member can tick a task but cannot delete the page', async ({ browser }) => {
    const page = await signInAs(browser, 'member1@example.com');

    await page.getByRole('checkbox', { name: 'Review the migration' }).click();
    await expect.poll(() => outboxDepth(page), { timeout: 10_000 }).toBeGreaterThan(0);
    await syncNow(page);
    await expect.poll(() => checkedOnServer('Review the migration'), { timeout: 15_000 }).toBe('t');
    await expect(page.locator('.stalled-card')).toHaveCount(0);

    // put the seed back as it was
    await closeSettings(page);
    await page.getByRole('checkbox', { name: 'Review the migration' }).click();
    await expect.poll(() => outboxDepth(page), { timeout: 10_000 }).toBeGreaterThan(0);
    await syncNow(page);
    await expect.poll(() => checkedOnServer('Review the migration'), { timeout: 15_000 }).toBe('f');

    await closeSettings(page);
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('button', { name: 'Delete page' }).click();
    await expect.poll(() => outboxDepth(page), { timeout: 10_000 }).toBeGreaterThan(0);
    await syncNow(page);

    await expect(page.locator('.stalled-card .reason')).toContainText('only an admin can delete a page', { timeout: 15_000 });
    expect(sql(`select deleted_at is null from public.notes where id = '${NOTE}'`)).toBe('t');
    await page.context().close();
  });
});
