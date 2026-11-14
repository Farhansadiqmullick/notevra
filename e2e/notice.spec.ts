import { test, expect, type Page } from '@playwright/test';
import { openApp, rowByText, rows, selectRow } from './helpers';

/**
 * "Move to → Archive", and the notification bar that tells you it happened.
 *
 * Two things are under test and they are the same bug seen from two sides. The write always landed
 * — `props.archived = 1` was in IndexedDB every time — but on a phone the detail pane IS the screen,
 * so archiving produced no visible change whatsoever: same task, same title, and no list on screen
 * to watch a row disappear from. A correct write with no feedback is indistinguishable from a dead
 * button (design/ui-test-plan.md §M).
 *
 * So the fix has two halves, and so does this file: LEAVE the item's screen, and SAY what happened.
 */

const ITEM = 'Oat milk';

/** Open an item's detail. A tap opens it below 720px; wider, the panes sit side by side. */
async function openDetail(page: Page, text: string): Promise<void> {
  const narrow = page.viewportSize()!.width < 720;
  const row = rowByText(page, text);
  if (narrow) await row.click();
  else await selectRow(page, row);
  await expect(page.locator('.detail .title')).toContainText(text);
}

async function moveTo(page: Page, where: 'Archive' | 'Trash'): Promise<void> {
  await page.getByText('Move to…').click();
  await page.locator('.menu button', { hasText: where }).click();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test.describe('Move to → Archive', () => {
  test('the item leaves the open list', async ({ page }) => {
    const before = await rows(page).count();
    await openDetail(page, ITEM);
    await moveTo(page, 'Archive');

    // on a phone we are back on the list; on desktop it never left
    await expect(rowByText(page, ITEM)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(before - 1);
  });

  test('it says so', async ({ page }) => {
    await openDetail(page, ITEM);
    await moveTo(page, 'Archive');

    const notice = page.locator('.notice');
    await expect(notice).toHaveText(/Moved to Archive/);
    await expect(notice).toHaveClass(/notice--info/);
  });

  test('the confirmation goes away on its own', async ({ page }) => {
    await openDetail(page, ITEM);
    await moveTo(page, 'Archive');
    await expect(page.locator('.notice')).toBeVisible();
    // 4s auto-dismiss + the leave transition; a bar that outstays this is in the way
    await expect(page.locator('.notice')).toHaveCount(0, { timeout: 8_000 });
  });

  test('it can be dismissed by hand', async ({ page }) => {
    await openDetail(page, ITEM);
    await moveTo(page, 'Archive');
    await page.locator('.notice__close').click();
    await expect(page.locator('.notice')).toHaveCount(0, { timeout: 2_000 });
  });

  test('the detail does not stay on the task that just left', async ({ page }) => {
    await openDetail(page, ITEM);
    await moveTo(page, 'Archive');
    // The pane either shows a DIFFERENT item or is gone entirely (a phone goes back to the list),
    // so read whatever titles exist rather than asserting on one element — `not.toContainText`
    // fails on a locator that matches nothing, which is one of the two correct outcomes here.
    await expect
      .poll(async () => (await page.locator('.detail .title').allTextContents()).join(' '))
      .not.toContain(ITEM);
  });
});

test.describe('Move to → Trash', () => {
  test('offers Undo, and Undo brings the task back', async ({ page }) => {
    await openDetail(page, ITEM);
    await moveTo(page, 'Trash');
    const notice = page.locator('.notice');
    await expect(notice).toContainText('Block deleted');
    await notice.locator('.notice__action').click();
    await expect(rowByText(page, ITEM)).toBeVisible();
  });

  test('a phone is not stranded on an empty detail', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'only below 720px is the list swapped out for the detail');
    await openDetail(page, ITEM);
    await moveTo(page, 'Trash');

    // the list is back, and it is the list — not a dead-end pane with no control that leads anywhere
    await expect(rows(page).first()).toBeVisible();
    await expect(rowByText(page, ITEM)).toHaveCount(0);
  });
});

test.describe('where the bar sits', () => {
  test('desktop: top-right; phone and tablet: bottom, clear of the tab bar', async ({ page }, info) => {
    await openDetail(page, ITEM);
    await moveTo(page, 'Archive');

    const box = (await page.locator('.notice').boundingBox())!;
    const vw = page.viewportSize()!.width;
    const vh = page.viewportSize()!.height;

    if (info.project.name === 'desktop') {
      expect(box.y, 'a mouse is already at the top of the screen').toBeLessThan(vh / 2);
      expect(box.x + box.width, 'sits in the right-hand corner').toBeGreaterThan(vw * 0.7);
    } else {
      // bottom half, where a thumb reaches — and clear of everything already parked down there
      expect(box.y, 'a thumb does not stretch to the top of a phone').toBeGreaterThan(vh / 2);
      const tb = await page.locator('.tabbar, nav').last().boundingBox().catch(() => null);
      if (tb) expect(box.y + box.height, 'must not hide behind the tab bar').toBeLessThanOrEqual(tb.y + 1);
    }
  });

  test('it does not sit on top of the FAB', async ({ page }, info) => {
    test.skip(info.project.name === 'desktop', 'no FAB above 900px');
    await openDetail(page, ITEM);
    await moveTo(page, 'Archive');

    const notice = (await page.locator('.notice').boundingBox())!;
    const fab = await page.locator('.fab').boundingBox();
    test.skip(!fab, 'no FAB rendered at this width');

    // The notice wins on z-index, so an overlap does not look like an overlap — it looks like the
    // FAB disappeared for four seconds. Rectangles must not intersect at all.
    const overlaps =
      notice.x < fab!.x + fab!.width &&
      notice.x + notice.width > fab!.x &&
      notice.y < fab!.y + fab!.height &&
      notice.y + notice.height > fab!.y;
    expect(overlaps, 'the notification is covering the New page button').toBe(false);
  });

  test('it is on top of the page, not tucked behind it', async ({ page }) => {
    await openDetail(page, ITEM);
    await moveTo(page, 'Archive');

    const notice = page.locator('.notice');
    const box = (await notice.boundingBox())!;
    // hit-test the middle of the bar: whatever is drawn there must be the bar itself
    const owns = await page.evaluate(([x, y]) => {
      const hit = document.elementFromPoint(x!, y!);
      return !!hit?.closest('.notice');
    }, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(owns, 'something is covering the notification').toBe(true);
  });
});

/**
 * The `.notice` class itself, measured rather than described.
 *
 * Injected directly instead of driven through the app: the point is that the CLASS carries the
 * colour, so any future caller — an inline notice in a dialog, a form error — gets the same meaning
 * without re-deriving it. Injection is also the only way to see all three variants at once.
 */
test.describe('the .notice variants', () => {
  test('each variant is a light background with legible text of its own hue', async ({ page }) => {
    const measured = await page.evaluate(() => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset-block-start:0;inset-inline-start:0;z-index:9999';
      for (const v of ['', 'notice--warning', 'notice--danger']) {
        const el = document.createElement('div');
        el.className = `notice ${v}`.trim();
        el.dataset.v = v || 'notice--info';
        el.textContent = 'measure me';
        host.appendChild(el);
      }
      document.body.appendChild(host);

      const lum = (c: string) => {
        const [r, g, b] = c.match(/[\d.]+/g)!.slice(0, 3).map(Number) as [number, number, number];
        const f = (u: number) => {
          const s = u / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };

      const out = Array.from(host.children).map((el) => {
        const s = getComputedStyle(el);
        const bgL = lum(s.backgroundColor);
        const fgL = lum(s.color);
        const [hi, lo] = bgL > fgL ? [bgL, fgL] : [fgL, bgL];
        return {
          variant: (el as HTMLElement).dataset.v!,
          background: s.backgroundColor,
          color: s.color,
          borderColor: s.borderTopColor,
          bgLuminance: bgL,
          contrast: (hi + 0.05) / (lo + 0.05),
        };
      });
      host.remove();
      return out;
    });

    expect(measured).toHaveLength(3);
    for (const m of measured) {
      // "light and easy on the eye": a pale tint, never a saturated slab
      expect(m.bgLuminance, `${m.variant} background should be light`).toBeGreaterThan(0.6);
      // and the text on it still has to be readable — WCAG AA for normal text
      expect(m.contrast, `${m.variant} text contrast`).toBeGreaterThan(4.5);
      // the variant has to actually differ from the plain surface, or it says nothing
      expect(m.borderColor, `${m.variant} needs its own edge`).not.toBe(m.background);
    }

    // and the three must be distinguishable from each other
    const backgrounds = new Set(measured.map((m) => m.background));
    expect(backgrounds.size, 'info, warning and danger must not look the same').toBe(3);
  });
});
