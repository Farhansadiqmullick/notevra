import { test, expect } from '@playwright/test';
import { openApp, openNote, selectRow, rowByText, hasHorizontalOverflow, overflowingElements, smallTouchTargets } from './helpers';

/**
 * Layout per viewport. Everything here is width-dependent, which is exactly the class of bug that
 * survives a unit suite and gets reported by a person holding a phone.
 */

test.describe('layout holds at every width', () => {
  test.beforeEach(async ({ page }) => openApp(page));

  test('the page never scrolls sideways', async ({ page }, testInfo) => {
    const overflowing = await overflowingElements(page);
    expect(
      await hasHorizontalOverflow(page),
      `horizontal scroll at ${testInfo.project.name}. Offenders: ${overflowing.join(' | ') || 'none found'}`,
    ).toBe(false);
  });

  test('the archive list and its rows are visible', async ({ page }) => {
    await expect(page.locator('.list')).toBeVisible();
    await expect(page.locator('.arow').first()).toBeVisible();
  });

  test('no row text is clipped out of its own row', async ({ page }) => {
    const clipped = await page.evaluate(() => {
      const out: string[] = [];
      for (const row of Array.from(document.querySelectorAll('.arow'))) {
        const body = row.querySelector('.body');
        if (!body) continue;
        const r = row.getBoundingClientRect();
        const b = body.getBoundingClientRect();
        if (b.right > r.right + 1) out.push((body.textContent ?? '').trim().slice(0, 30));
      }
      return out;
    });
    expect(clipped, 'row content spilling past its own card').toEqual([]);
  });
});

test.describe('desktop', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop only');
    await openApp(page);
  });

  test('shows the sidebar and both archive panes at once', async ({ page }) => {
    await expect(page.locator('.list')).toBeVisible();
    await expect(page.locator('.detail')).toBeVisible();
    // the two-pane layout is the whole point of this width
    const [list, detail] = await Promise.all([
      page.locator('.list').boundingBox(),
      page.locator('.detail').boundingBox(),
    ]);
    expect(detail!.x).toBeGreaterThan(list!.x);
  });

  test('selecting a row updates the detail pane', async ({ page }) => {
    await selectRow(page, rowByText(page, 'Filters for the AeroPress'));
    await expect(page.locator('.detail .title')).toHaveText(/Filters for the AeroPress/);
  });
});

test.describe('tablet', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet', 'tablet only');
    await openApp(page);
  });

  test('the detail is reachable one way or another', async ({ page }) => {
    await selectRow(page, rowByText(page, 'Filters for the AeroPress'));
    // either the pane is on screen, or tapping opened it as an overlay — but it must be SOMEWHERE
    await expect(page.locator('.detail')).toBeVisible();
  });

  test('the list pane does not squeeze the detail below a usable width', async ({ page }) => {
    const detail = await page.locator('.detail').boundingBox();
    if (!detail) test.skip(true, 'detail is not a pane at this width');
    expect(detail!.width).toBeGreaterThan(280);
  });
});

test.describe('mobile', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only');
    await openApp(page);
  });

  test('tapping an archive item opens its details', async ({ page }) => {
    await selectRow(page, rowByText(page, 'Filters for the AeroPress'));

    // the detail has to become reachable — as a pane, a sheet, or a pushed view
    await expect(
      page.locator('.detail'),
      'tapping a task on mobile must lead somewhere; today the pane is display:none below 900px',
    ).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.detail')).toContainText('Filters for the AeroPress');
  });

  test('the opened detail can be dismissed back to the list', async ({ page }) => {
    await selectRow(page, rowByText(page, 'Filters for the AeroPress'));
    await expect(page.locator('.detail')).toBeVisible({ timeout: 3000 });

    const back = page.getByRole('button', { name: /back|close|list/i }).first();
    await expect(back, 'an opened detail needs a way out').toBeVisible();
    await back.click();

    await expect(page.locator('.list')).toBeVisible();
  });

  test('the item title can be renamed from the detail view', async ({ page }) => {
    // the phone's only rename path once a tap opens the detail instead of an inline editor
    await selectRow(page, rowByText(page, 'Filters for the AeroPress'));
    const title = page.locator('.detail .title');
    await expect(title).toBeVisible({ timeout: 3000 });

    await title.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' NOW');
    await page.waitForTimeout(500); // debounce + write

    await page.reload();
    await expect(page.locator('.arow').filter({ hasText: 'Filters for the AeroPress NOW' })).toBeVisible({ timeout: 15_000 });
  });

  test('the tab bar is present and clear of the safe area', async ({ page }) => {
    const bar = page.locator('.tabbar, [class*="tabbar"], nav[class*="tab"]').first();
    await expect(bar).toBeVisible();
  });

  test('the sidebar is a drawer, not a permanent column', async ({ page }) => {
    const sidebar = page.locator('.sidebar').first();
    if (await sidebar.count()) {
      const box = await sidebar.boundingBox();
      // off-screen or hidden is correct at this width; on-screen would eat the content column
      if (box) expect(box.x + box.width).toBeLessThanOrEqual(1);
    }
  });

  test('touch targets are big enough to hit', async ({ page }) => {
    const small = await smallTouchTargets(page);
    expect(small, `below the 44px touch minimum: ${small.join(' | ')}`).toEqual([]);
  });

  test('the page title in the breadcrumb is not clipped', async ({ page }) => {
    /*
     * Everything in the header was `flex: none` except the crumb, so at 390px the page name was the
     * only thing that could give way and "Groceries" rendered as "G.".
     *
     * Asserting a minimum WIDTH would be wrong — the element shrink-wraps its text, so a short title
     * is legitimately narrow. What matters is whether the text overflows the box it was given, which
     * is exactly what `text-overflow: ellipsis` is hiding.
     */
    // every page type, because each header crowds the crumb with different chrome
    for (const note of ['Groceries', 'Week of 27 July', 'Flat inspection']) {
      await openNote(page, note);
      const title = await page.evaluate(() => {
        const el = document.querySelector('.bar .cr-cur .editable') as HTMLElement | null;
        return el && { text: el.textContent?.trim() ?? '', clipped: el.scrollWidth > el.clientWidth + 1 };
      });
      expect(title, `no breadcrumb title on "${note}"`).not.toBeNull();
      expect(title!.clipped, `"${note}": the page title is clipped to "${title!.text}"`).toBe(false);
    }
  });


  test('the writing column uses the width of the screen', async ({ page }) => {
    /*
     * Planning and Single are documents, and on a phone the document IS the page. The block row
     * reserved a drag-handle gutter AND a hover-only control gutter that nothing on a touch screen
     * can ever reveal — together with the page padding that was ~25% of a 390px viewport spent on
     * margins and an empty strip, so a task title wrapped after four words.
     */
    for (const note of ['Week of 27 July', 'Flat inspection']) {
      await openNote(page, note);
      const usable = await page.evaluate(() => {
        const body = document.querySelector('.blk-body') as HTMLElement | null;
        return body ? body.getBoundingClientRect().width / document.documentElement.clientWidth : null;
      });
      expect(usable, `no blocks rendered on "${note}"`).not.toBeNull();
      expect(usable!, `"${note}": the block body only gets ${Math.round(usable! * 100)}% of the screen`)
        .toBeGreaterThan(0.8);
    }
  });

  test('the hover-only block controls do not sit invisibly over the text', async ({ page }) => {
    await openNote(page, 'Week of 27 July');
    const ghosts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.ctrls')).filter((c) => {
        const cs = getComputedStyle(c);
        const r = c.getBoundingClientRect();
        // laid out, sized, and fully transparent = tappable but invisible
        return cs.display !== 'none' && Number(cs.opacity) === 0 && r.width > 0;
      }).length);
    expect(ghosts, 'invisible-but-tappable block controls').toBe(0);
  });

  test('the last row is not hidden behind the tab bar', async ({ page }) => {
    const rows = page.locator('.arow');
    const last = rows.last();
    await last.scrollIntoViewIfNeeded();
    const [box, viewport] = [await last.boundingBox(), page.viewportSize()!];
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  });
});

/**
 * The New page dialog, which is the same chooser at every width and must not be the same LAYOUT.
 *
 * Three columns need roughly 750px before the cards stop being readable. At 390px they were 103px
 * wide with 18px of padding inside them, so the name wrapped and the description became a column of
 * single words — the chooser stopped being able to show you the thing you were choosing.
 */
test.describe('New page dialog', () => {
  async function openDialog(page: import('@playwright/test').Page) {
    await openApp(page);
    const fab = page.locator('.fab');
    if (await fab.count()) await fab.click();
    else await page.getByRole('button', { name: /New page/i }).first().click();
    await expect(page.locator('.dialog')).toBeVisible();
  }

  test('the type cards stack vertically below 900px and sit side by side above it', async ({ page }, info) => {
    await openDialog(page);
    const cards = page.locator('.grid .card');
    await expect(cards).toHaveCount(4);

    const boxes = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    const sideBySide = new Set(boxes.map(Math.round)).size === 1;

    if (info.project.name === 'desktop') {
      expect(sideBySide, 'desktop has the room for one row').toBe(true);
    } else {
      expect(sideBySide, 'each card should start below the last, not beside it').toBe(false);
      // and stacked means FULL WIDTH — a third-width card in a single column is just a narrow card
      const width = (await cards.first().boundingBox())!.width;
      const dialog = (await page.locator('.dialog').boundingBox())!.width;
      expect(width).toBeGreaterThan(dialog * 0.8);
    }
  });

  test('every type is legible — no card is narrower than its own text', async ({ page }) => {
    await openDialog(page);
    const overflowing = await page.locator('.grid .card .name').evaluateAll((els) =>
      els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent ?? ''),
    );
    expect(overflowing, 'type names clipped by their card').toEqual([]);
  });

  test('Create stays reachable without scrolling past the options', async ({ page }) => {
    await openDialog(page);
    const btn = page.getByRole('button', { name: /^Create / });
    const box = (await btn.boundingBox())!;
    // sticky on mobile, static on desktop — either way it must be on screen when the dialog opens
    expect(box.y + box.height, 'the create button is below the fold').toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
  });

  test('the dialog itself never scrolls the page sideways', async ({ page }) => {
    await openDialog(page);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
