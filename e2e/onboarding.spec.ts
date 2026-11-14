import { test, expect, type Page } from '@playwright/test';
import { openApp, openNote } from './helpers';

/**
 * The first thirty seconds of a new page.
 *
 * Creating one used to drop you on a blank screen called "Untitled" with no caret and no clue that
 * `/` existed — the only place the app taught it was a placeholder you had to find the "Add a
 * block" button to see. Two things fix that, and this file is both of them:
 *
 *   1. the page asks for its name once, and remembers if you decline
 *   2. it hands you a block with the type menu already open
 *
 * (2) is deliberately a DEMONSTRATION rather than a tip. `slash-select` converts the current block
 * and clears its text, so a message promising that `/` "adds" a block would be teaching a gesture
 * that destroys writing. On a fresh empty block there is nothing to lose and converting is exactly
 * what is wanted — so the menu is shown where it is safe, and never described where it would lie.
 */

type TypeName = 'Archive' | 'Planning' | 'Single';

/** Create a page of `type` and stop at the naming prompt. */
async function newPage(page: Page, type: TypeName): Promise<void> {
  const fab = page.locator('.fab');
  if (await fab.count()) await fab.click();
  else await page.getByRole('button', { name: /New page/i }).first().click();

  // a Single page is created from the Blank card now
  await page.locator('.grid .card').filter({ hasText: type === 'Single' ? 'Blank page' : type }).click();
  await page.getByRole('button', { name: /^Create / }).click();
  await expect(page.locator('#tp-input')).toBeVisible();
}

const prompt = (page: Page) => page.locator('#tp-input');
const crumb = (page: Page) => page.locator('.crumb .cr-cur').first();
/** what the caret is actually in */
const activeClass = (page: Page) => page.evaluate(() => document.activeElement?.className ?? '');

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test.describe('naming a new page', () => {
  test('it asks, and the question names the type', async ({ page }) => {
    await newPage(page, 'Planning');
    await expect(page.getByRole('dialog')).toContainText('Name your Planning page');
  });

  test('the name reaches the breadcrumb and the sidebar', async ({ page }) => {
    await newPage(page, 'Planning');
    await prompt(page).fill('Launch checklist');
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(crumb(page)).toHaveText('Launch checklist');
    await expect(page.locator('.row.page-row').filter({ hasText: 'Launch checklist' })).toHaveCount(1);
  });

  test('…and the page title, on the types that show one', async ({ page }) => {
    // Single and Archive render NoteTitle twice — breadcrumb and an h1 in the document. Both are
    // separate components bound to the same row, so "it updated" has to be asserted on each.
    await newPage(page, 'Single');
    await prompt(page).fill('Deposit dispute');
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(crumb(page)).toHaveText('Deposit dispute');
    // NoteTitle puts the caller's class on EditableText's wrapper, so the heading itself is the
    // `h1.editable` inside it — assert on the h1, which is what a reader actually sees
    await expect(page.locator('.doc h1')).toHaveText('Deposit dispute');
  });

  test('Enter saves — the field is the whole form', async ({ page }) => {
    await newPage(page, 'Single');
    await prompt(page).fill('Typed and entered');
    await prompt(page).press('Enter');

    await expect(prompt(page)).toHaveCount(0);
    await expect(crumb(page)).toHaveText('Typed and entered');
  });

  test('Done with an empty name keeps the page Untitled', async ({ page }) => {
    await newPage(page, 'Single');
    await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(crumb(page)).toHaveText('Untitled');
  });
});

test.describe('skipping', () => {
  test('leaves the page usable and does not ask again', async ({ page }) => {
    await newPage(page, 'Single');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(prompt(page)).toHaveCount(0);
    await expect(crumb(page)).toHaveText('Untitled');

    // leave and come back — the answer was "no", and it has to stay answered
    await openNote(page, 'Groceries');
    await openNote(page, 'Untitled');
    await expect(prompt(page)).toHaveCount(0);
  });

  test('survives a reload, because the flag is on the row and not in memory', async ({ page }) => {
    await newPage(page, 'Single');
    await page.getByRole('button', { name: 'Done' }).click();
    // Wait for the WRITE, not for the click. Skipping clears the flag and then prepares the first
    // block, so a visible block means both landed; reloading straight off the click races the tab
    // teardown against Dexie and the flag can still be true when the page comes back.
    await expect(page.locator('.blk')).toHaveCount(1);

    await page.reload();
    await expect(page.locator('.arow').first()).toBeVisible({ timeout: 15_000 });
    await openNote(page, 'Untitled');
    await expect(prompt(page)).toHaveCount(0);
  });

  test('but an UNANSWERED prompt does come back after a reload', async ({ page }) => {
    // the page exists at this point; if the flag only lived in memory it would be stranded as
    // "Untitled" with nothing ever asking about it again
    await newPage(page, 'Single');
    await page.reload();
    // a reload boots on the default page, so reopening it is part of the question being asked here
    await expect(page.locator('.arow').first()).toBeVisible({ timeout: 15_000 });
    await openNote(page, 'Untitled');
    await expect(prompt(page)).toBeVisible();
  });
});

test.describe('the page hands you somewhere to start', () => {
  for (const type of ['Planning', 'Single'] as TypeName[]) {
    test(`${type}: a first block holds the caret, with the block menu open`, async ({ page }) => {
      await newPage(page, type);
      await prompt(page).fill('Starting point');
      await page.getByRole('button', { name: 'Done' }).click();

      await expect(page.locator('.slash')).toBeVisible();
      // every convertible type, not a filtered subset — nothing has been typed to filter by
      await expect(page.locator('.slash .row')).toHaveCount(13);
      for (const label of ['Task', 'Heading', 'Text', 'Callout', 'Table']) {
        await expect(page.locator('.slash .label', { hasText: label })).toHaveCount(1);
      }
      expect(await activeClass(page)).toContain('editable');
    });
  }

  test('picking a type converts the block and leaves you typing in it', async ({ page }) => {
    await newPage(page, 'Single');
    await prompt(page).fill('Starting point');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.slash')).toBeVisible();

    await page.locator('.slash').getByText('Task', { exact: true }).click();

    await expect(page.locator('.slash'), 'the menu should close once used').toHaveCount(0);
    await expect(page.locator('.blk .cbx').first(), 'the block is a task now').toBeVisible();
    await page.keyboard.type('Ship it');
    await expect(page.locator('.blk')).toContainText('Ship it');
  });

  test('skipping the name still prepares the block — it declines a name, not the page', async ({ page }) => {
    await newPage(page, 'Single');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.slash')).toBeVisible();
  });

  test('the menu steps aside for anyone who just wants to write', async ({ page }) => {
    await newPage(page, 'Single');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.slash')).toBeVisible();

    await page.keyboard.type('Just prose');
    await expect(page.locator('.slash')).toHaveCount(0);
    await expect(page.locator('.blk')).toContainText('Just prose');
  });

  test('Archive gets a focused item and NO menu — its rows are tasks already', async ({ page }) => {
    await newPage(page, 'Archive');
    await prompt(page).fill('Hardware store');
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page.locator('.arow')).toHaveCount(1);
    await expect(
      page.locator('.slash'),
      'ArchiveRow passes no slash prop, and a list of tasks has nothing to convert to',
    ).toHaveCount(0);
  });
});

test.describe('pages that must never be asked', () => {
  test('a seeded page opens straight into work', async ({ page }) => {
    await expect(prompt(page)).toHaveCount(0);
    await openNote(page, 'Flat inspection');
    await expect(prompt(page)).toHaveCount(0);
  });

  test('a duplicate already has a name', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'the ⋯ menu is the same at every width');
    await openNote(page, 'Flat inspection');
    await page.locator('.content .bar .more').click();
    await page.locator('.menu button', { hasText: 'Duplicate page' }).click();

    await expect(crumb(page)).toContainText('(copy)');
    await expect(prompt(page)).toHaveCount(0);
  });
});

test('the prompt fits the screen and its buttons are reachable', async ({ page }) => {
  await newPage(page, 'Planning');
  const save = page.getByRole('button', { name: 'Done' });
  const box = (await save.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
