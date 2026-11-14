import { test, expect } from '@playwright/test';
import { openApp, openNote, typeAtEnd, storedBlocks } from './helpers';

/**
 * Does a write actually land?
 *
 * The unit suite proves `blockService` writes to Dexie and the sync engine queues an operation. It
 * cannot prove that the checkbox on screen is wired to that service, or that the caret you typed
 * into belongs to the block you were looking at. Everything here does the only check that settles
 * it: change something, RELOAD, and see whether it survived.
 *
 * Reported from a phone against the LAN preview build: "the task completed action" and edits to a
 * task's text were not saving.
 */
const WEEK = 'Week of 27 July';
const TASK = 'Finish the sync queue flush + backoff';

test.describe('writes survive a reload', () => {
  test.beforeEach(async ({ page }) => openApp(page));

  test('Planning: ticking a task stays ticked', async ({ page }) => {
    await openNote(page, WEEK);

    const task = page.locator('.task').filter({ hasText: 'Finish the sync queue' }).first();
    await expect(task).toBeVisible();
    await expect(task).not.toHaveClass(/done/);

    await task.locator('[role="checkbox"]').first().click();
    await expect(task).toHaveClass(/done/);
    await page.waitForTimeout(400);

    await page.reload();
    await openNote(page, WEEK);
    await expect(
      page.locator('.task').filter({ hasText: 'Finish the sync queue' }).first(),
      'the tick did not survive the reload',
    ).toHaveClass(/done/);
  });

  test('Planning: the tasks-done counter follows the tick', async ({ page }) => {
    await openNote(page, WEEK);
    const before = await page.locator('.prog-head strong, .count').first().textContent();

    await page.locator('.task').filter({ hasText: 'Finish the sync queue' }).first()
      .locator('[role="checkbox"]').first().click();

    await expect.poll(async () => page.locator('.prog-head strong, .count').first().textContent())
      .not.toBe(before);
  });

  test('Planning: editing a task title stays edited', async ({ page }) => {
    await openNote(page, WEEK);

    const field = page.locator('.task').filter({ hasText: 'Finish the sync queue' }).first().locator('.editable').first();
    await typeAtEnd(page, field, ' XYZ');
    await page.waitForTimeout(500); // 300ms debounce + the write

    // fail on the WRITE, not on the typing: prove the character reached storage before reloading
    expect((await storedBlocks(page, 'sync queue flush'))[0]?.text).toContain('XYZ');

    await page.reload();
    await openNote(page, WEEK);
    await expect(
      page.locator('.task').filter({ hasText: 'Finish the sync queue flush + backoff XYZ' }).first(),
      'the edit did not survive the reload',
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Planning: a subtask tick stays ticked', async ({ page }) => {
    await openNote(page, WEEK);

    const sub = page.locator('.subtask, .sub-row').filter({ hasText: 'Jittered backoff' }).first();
    await expect(sub).toBeVisible();
    await sub.locator('[role="checkbox"]').first().click();
    await page.waitForTimeout(400);

    await page.reload();
    await openNote(page, WEEK);
    const after = page.locator('.subtask, .sub-row').filter({ hasText: 'Jittered backoff' }).first();
    await expect(after.locator('[role="checkbox"]').first()).toHaveAttribute('aria-checked', 'true');
  });

  test('Archive: ticking an item stays ticked', async ({ page }) => {
    const row = page.locator('.arow').filter({ hasText: 'Filters for the AeroPress' }).first();
    await row.locator('[role="checkbox"]').first().click();
    await expect(row).toHaveClass(/done/);
    await page.waitForTimeout(400);

    await page.reload();
    await expect(
      page.locator('.arow').filter({ hasText: 'Filters for the AeroPress' }).first(),
      'the tick did not survive the reload',
    ).toHaveClass(/done/, { timeout: 10_000 });
  });
});

/**
 * Enlarged touch targets must not reach into each other.
 *
 * `.tap-target` grows a control's hit area to 44px with a transparent ::after. On the Archive's
 * roomy rows that is free; Planning's task rows are tighter (8px padding, 2px block margin), so two
 * stacked checkboxes could overlap and a tap meant for one would tick the other — silently, on
 * exactly the control where a wrong write is hardest to notice.
 */
test.describe('touch targets do not collide', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'desktop', 'fine pointers get no overlay');
    await openApp(page);
  });

  test('Planning: each checkbox hit area belongs to its own task', async ({ page }) => {
    await openNote(page, WEEK);

    const wrong = await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('.task [role="checkbox"], .subtask [role="checkbox"]'));
      const bad: string[] = [];
      for (const el of boxes) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        for (const [dy, edge] of [[-21, 'above'], [21, 'below']] as const) {
          const hit = document.elementFromPoint(cx, r.top + r.height / 2 + dy);
          // landing on nothing, or on this control, is fine; landing on ANOTHER checkbox is not
          if (hit && hit !== el && !el.contains(hit) && hit.getAttribute('role') === 'checkbox') {
            bad.push(`${(el.getAttribute('aria-label') || '').slice(0, 24)} → ${edge} hits another checkbox`);
          }
        }
      }
      return bad;
    });

    expect(wrong, `overlapping tap zones: ${wrong.join(' | ')}`).toEqual([]);
  });

  test('Planning: ticking a task ticks THAT task', async ({ page }) => {
    await openNote(page, WEEK);
    const target = page.locator('.task').filter({ hasText: 'Flat inspection' }).first();

    await target.locator('[role="checkbox"]').first().click();
    await page.waitForTimeout(400);

    const stored = await storedBlocks(page, 'Flat inspection');
    expect(stored[0]?.checked, 'the tap ticked a different task').toBe(1);
    // and nothing else moved
    expect((await storedBlocks(page, 'sync queue flush'))[0]?.checked).toBe(0);
  });
});
