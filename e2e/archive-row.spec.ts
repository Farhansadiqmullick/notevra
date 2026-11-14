import { test, expect } from '@playwright/test';
import { openApp, selectRow, rowByText, FIRST_ITEM } from './helpers';

/**
 * The Archive row's two jobs — SELECT and EDIT — and the fact that one pointer has to serve both.
 *
 * The rule this suite encodes (and the app must follow):
 *   1. a click anywhere on an unselected row SELECTS it, and never puts a caret in the text
 *   2. a click on the TEXT of an already-selected row starts editing
 *   3. the editable surface is only as wide as its text, so the dead space beside a short item
 *      belongs to the row, not to the text field
 *
 * Without (1) the row is unusable: the first click lands in a contenteditable, so selecting an item
 * and typing into it are the same gesture and neither is reliable.
 */
test.describe('Archive row — select before edit', () => {
  /**
   * Desktop and tablet only. Below 720px the list and detail stop being two panes, so a tap opens
   * the item's detail view instead of selecting in place, and renaming happens on the title there.
   * That path is covered in responsive.spec.ts under `mobile`.
   */
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'a tap opens the detail view at this width');
    await openApp(page);
  });

  test('clicking an unselected row selects it without starting an edit', async ({ page }) => {
    const row = rowByText(page, 'Oat milk');
    await expect(row).not.toHaveClass(/selected/);

    // click the row's own padding, away from the text
    await selectRow(page, row);

    await expect(row).toHaveClass(/selected/);
    // the caret must NOT have landed in the text
    const editing = await page.evaluate(() => document.activeElement?.classList.contains('editable') ?? false);
    expect(editing, 'a first click should select, not open the editor').toBe(false);
  });

  test('clicking the text of an unselected row selects it — it does not jump straight to editing', async ({ page }) => {
    const row = rowByText(page, 'Oat milk');
    await row.locator('.editable').click();

    await expect(row).toHaveClass(/selected/);
    const editing = await page.evaluate(() => document.activeElement?.classList.contains('editable') ?? false);
    expect(editing, 'the text is part of the row until the row is selected').toBe(false);
  });

  test('clicking the text of a SELECTED row starts editing', async ({ page }) => {
    const row = rowByText(page, 'Oat milk');
    await selectRow(page, row); // select
    await expect(row).toHaveClass(/selected/);

    await row.locator('.editable').click(); // now edit

    await expect(row.locator('.editable')).toBeFocused();
  });

  test('typing after entering edit changes the text and it survives a reload', async ({ page }) => {
    const row = rowByText(page, 'Oat milk');
    await selectRow(page, row);
    await row.locator('.editable').click();
    await expect(row.locator('.editable')).toBeFocused();

    await page.keyboard.press('End');
    await page.keyboard.type(' PLEASE');
    await page.waitForTimeout(500); // the 300ms debounce, plus room to write

    await page.reload();
    await expect(rowByText(page, 'Oat milk × 4 PLEASE')).toBeVisible({ timeout: 15_000 });
  });

  test('the editable surface hugs its text instead of filling the row', async ({ page }) => {
    const row = rowByText(page, 'Oat milk'); // short text — a full-width field is unmistakable here
    const editable = row.locator('.editable');

    const [fieldBox, bodyBox] = await Promise.all([
      editable.boundingBox(),
      row.locator('.body').boundingBox(),
    ]);
    expect(fieldBox && bodyBox).toBeTruthy();

    // a short label must not claim the whole column; 80% is generous and still catches display:block
    expect(
      fieldBox!.width,
      `the text field is ${Math.round(fieldBox!.width)}px inside a ${Math.round(bodyBox!.width)}px row — ` +
        'clicking the empty space beside a short item should hit the ROW, not the editor',
    ).toBeLessThan(bodyBox!.width * 0.8);
  });

  test('the space beside a short item selects the row rather than focusing the field', async ({ page }) => {
    const row = rowByText(page, 'Oat milk');
    const box = (await row.boundingBox())!;

    // far right of the row, before the delete button's gutter
    await page.mouse.click(box.x + box.width - 60, box.y + box.height / 2);

    await expect(row).toHaveClass(/selected/);
    const editing = await page.evaluate(() => document.activeElement?.classList.contains('editable') ?? false);
    expect(editing, 'empty space beside the text belongs to the row').toBe(false);
  });

  test('selecting a different row deselects the first and drops its edit', async ({ page }) => {
    const first = rowByText(page, 'Oat milk');
    const second = rowByText(page, 'Filters for the AeroPress');

    await selectRow(page, first);
    await first.locator('.editable').click();
    await expect(first.locator('.editable')).toBeFocused();

    await selectRow(page, second);

    await expect(second).toHaveClass(/selected/);
    await expect(first).not.toHaveClass(/selected/);
    await expect(first.locator('.editable')).not.toBeFocused();
  });

  test('the checkbox toggles done without selecting or editing', async ({ page }) => {
    const row = rowByText(page, 'Filters for the AeroPress');
    await row.locator('input[type="checkbox"], [role="checkbox"]').first().click();

    await expect(row).toHaveClass(/done/);
    const editing = await page.evaluate(() => document.activeElement?.classList.contains('editable') ?? false);
    expect(editing).toBe(false);
  });

  test('Escape leaves editing and returns to a plain selected row', async ({ page }) => {
    const row = rowByText(page, FIRST_ITEM);
    await selectRow(page, row);
    await row.locator('.editable').click();
    await expect(row.locator('.editable')).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(row.locator('.editable')).not.toBeFocused();
    await expect(row).toHaveClass(/selected/); // still the current item, just not being typed into
  });
});

/**
 * Deleting a row is instant, with Undo on the bar that follows — the same as every other block.
 *
 * Mobile is INCLUDED: nothing hovers on a touch screen, so the 🗑 is always visible on a phone,
 * which is where an accidental delete is most likely and Undo most has to work.
 */
test.describe('Archive row — delete at once, Undo to bring it back', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  const TARGET = 'Filters for the AeroPress';

  test('the trash button deletes at once and offers Undo', async ({ page }) => {
    const row = rowByText(page, TARGET);
    await row.hover();
    await row.locator('.del').click();

    await expect(page.locator('.arow').filter({ hasText: TARGET })).toHaveCount(0);
    await expect(page.locator('.notice')).toContainText('Block deleted');
    await expect(page.locator('.notice__action')).toHaveText('Undo');
  });

  test('Undo on the bar brings it back', async ({ page }) => {
    const row = rowByText(page, TARGET);
    await row.hover();
    await row.locator('.del').click();
    await page.locator('.notice__action').click();

    await expect(rowByText(page, TARGET)).toBeVisible();
    await expect(page.locator('.notice')).toHaveCount(0, { timeout: 2_000 });
  });

  test('Ctrl/⌘Z brings it back while the bar is showing', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'no keyboard shortcut on a phone');
    const row = rowByText(page, TARGET);
    await row.hover();
    await row.locator('.del').click();
    await expect(page.locator('.arow').filter({ hasText: TARGET })).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(rowByText(page, TARGET)).toBeVisible();
  });
});

/**
 * The DONE group is a second list, and it was wired differently from the first.
 *
 * Every test above targets an OPEN row, which is exactly why the whole suite stayed green while
 * this was broken. `ArchiveRow` is rendered TWICE in `ArchiveList` — once for `visibleItems` and
 * once for the DONE group — and only the first had `@delete` on it. A Vue emit with no listener is
 * silent: you pressed the trash and nothing happened, with nothing warning or throwing.
 *
 * So these assert the OUTCOME — the row is gone — not just that something appeared on screen.
 */
test.describe('Archive row — the DONE group deletes too', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  /** the one seeded done item (blk-g5), so it starts under the DONE · 1 heading */
  const DONE_ITEM = 'Bin bags + dish soap';

  test('the trash on a done row actually removes it', async ({ page }) => {
    const row = rowByText(page, DONE_ITEM);
    await expect(row).toHaveClass(/done/);
    const before = await page.locator('.arow').count();

    await row.hover();
    await row.locator('.del').click();

    // both halves matter: the row is gone AND the list actually shrank. Asserting only that the
    // named row disappeared would still pass if the whole group stopped rendering for some
    // unrelated reason.
    await expect(page.locator('.arow').filter({ hasText: DONE_ITEM })).toHaveCount(0);
    await expect(page.locator('.arow')).toHaveCount(before - 1);
  });

  test('the DONE heading count follows the deletion', async ({ page }) => {
    await expect(page.locator('.done-label')).toContainText('DONE · 1');

    const row = rowByText(page, DONE_ITEM);
    await row.hover();
    await row.locator('.del').click();

    // the group empties, so its heading goes with it — a "DONE · 0" label is a lie about the list
    await expect(page.locator('.done-label')).toHaveCount(0);
  });

  test('a done item is listed once under All, not twice', async ({ page }) => {
    /*
     * The DONE group used to render whenever the filter was not "done", and under "All" the main
     * list already contains checked items — so every done row appeared twice. The copies were not
     * equivalent (only one of them could be deleted), which is what made it confusing rather than
     * merely untidy.
     */
    await page.locator('.list .filters').getByText('All', { exact: true }).click();
    await expect(page.locator('.arow').filter({ hasText: DONE_ITEM })).toHaveCount(1);
    // and the group's heading has no business being there when the list is already showing them
    await expect(page.locator('.done-label')).toHaveCount(0);
  });

  test('no filter shows the same item twice', async ({ page }) => {
    // the general form of the bug above, so a future third list cannot reintroduce it quietly
    for (const f of ['Open', 'All', 'Done']) {
      await page.locator('.list .filters').getByText(f, { exact: true }).click();
      const titles = (await page.locator('.arow .title').allInnerTexts()).map((t) => t.trim());
      expect(new Set(titles).size, `"${f}" renders a duplicate row: ${titles.join(' | ')}`).toBe(titles.length);
    }
  });

  test('a done item can still be deleted from the Done filter', async ({ page }) => {
    // the same item through the OTHER code path — under "Done" it comes from `visibleItems`
    await page.locator('.list .filters').getByText('Done', { exact: true }).click();
    const row = rowByText(page, DONE_ITEM);
    await row.hover();
    await row.locator('.del').click();

    await expect(page.locator('.arow').filter({ hasText: DONE_ITEM })).toHaveCount(0);
  });
});
