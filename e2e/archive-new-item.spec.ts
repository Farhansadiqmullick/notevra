/**
 * A row you just asked for should be a row you can type in.
 *
 * "Add item" creates the block and calls `ui.setFocus(id)`, and `useBlockEdit` answers that by
 * calling `focus()` on the row's field. But an Archive row's text is deliberately inert until the
 * row is being edited — `<EditableText :editable="editing">`, where `editing` is a local ref that
 * only a click on the text ever set. So the caret was requested for an element rendered
 * `contenteditable="false"`, which cannot host one: the row appeared, took the selection ring, and
 * swallowed every keystroke.
 *
 * The inertness itself is right and stays (design/archive-row-interaction.md): a row is both a
 * selectable item and the text of that item, and making the whole thing a live contenteditable
 * turns "pick this" and "retype this" into the same gesture. What was missing is that ASKING for
 * the caret is itself a decision to edit.
 */
import { test, expect, type Page } from '@playwright/test';
import { openApp, storedBlocks } from './helpers';

/**
 * Wait for the caret to arrive in a new, empty field.
 *
 * Creating a row is asynchronous — a Dexie write, then a liveQuery, then a render, then the focus
 * handoff — so keystrokes fired in the same tick as the click or the Enter still land in whatever
 * held focus before. That window is real and is flagged separately; it is not what these tests are
 * about, and typing into it would make them fail for a reason they do not name.
 */
async function caretInNewRow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const a = document.activeElement;
        return !!a?.classList.contains('editable') && !a.textContent?.trim();
      }),
    )
    .toBe(true);
}

test.describe('a new Archive item accepts typing', () => {
  test('“Add item” leaves the caret in the new row', async ({ page }) => {
    await openApp(page);
    const before = await page.locator('.arow').count();

    await page.locator('.add').click();
    await expect(page.locator('.arow')).toHaveCount(before + 1);
    await caretInNewRow(page);

    await page.keyboard.type('Oranges');

    // the text lands in the new row, not in whatever held focus before it
    await expect(page.locator('.arow').filter({ hasText: 'Oranges' })).toHaveCount(1);
  });

  test('what was typed is actually saved, not just painted', async ({ page }) => {
    await openApp(page);
    await page.locator('.add').click();
    await caretInNewRow(page);
    await page.keyboard.type('Oranges');

    // the write is debounced 300ms; reloading straight after typing races it and fails on a bug
    // that isn't there. Wait for it to land, then reload.
    await expect.poll(() => storedBlocks(page, 'Oranges')).toHaveLength(1);
    await page.reload();
    await expect(page.locator('.arow').first()).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('.arow').filter({ hasText: 'Oranges' })).toHaveCount(1);
  });

  test('Enter at the end of a row opens the next one ready to type', async ({ page }) => {
    /*
     * The same handoff, reached a different way: `addAfter` also creates a block and asks for the
     * caret. If only the "Add item" button were fixed, pressing Enter would still produce a row that
     * ignores the keyboard — the bug is in the handoff, not in the button.
     */
    await openApp(page);
    const first = page.locator('.arow').first();
    const firstTextBefore = await first.locator('.editable').innerText();
    await first.locator('.editable').click(); // select
    await first.locator('.editable').click(); // then edit
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    await caretInNewRow(page);

    await page.keyboard.type('Oranges');

    /*
     * Both halves are needed. Asserting only that SOME row says "Oranges" passes when the caret
     * never moved and the word was appended to the row you were already in — which is exactly what
     * this bug does, so the weaker assertion passed while the app was broken.
     */
    await expect(first.locator('.editable')).toHaveText(firstTextBefore);
    await expect(page.locator('.arow').filter({ hasText: 'Oranges' })).toHaveCount(1);
  });
});
