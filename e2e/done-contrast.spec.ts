/**
 * A completed item has to stay readable — including one that was never given any text.
 *
 * The bug this locks down was invisible in the only sense that matters: the row was there, the
 * checkbox was ticked, and the words were not. `EditableText` draws its placeholder in
 * `--ink-ghost` on purpose, and a parent `opacity: 0.45` multiplied on top of it, so an empty done
 * item finished at 1.45:1 against the dark surface and 1.40:1 against the light one. Below 3:1
 * there is nothing to see at all.
 *
 * ── Two things these tests do deliberately ───────────────────────────────────────────────────────
 *
 * **The empty row is CREATED here, not looked for.** The first version of this spec measured
 * whichever done row happened to be first, which in the seeded library has text — so the assertion
 * that the placeholder matches the written colour passed while the bug was present, because
 * `.editable:empty::before` does not apply to a non-empty element and the pseudo simply inherits.
 * A test that passes for a reason unrelated to the thing it names is worse than no test.
 *
 * **The assertion is a computed contrast ratio, not a colour string.** The colour is allowed to
 * change; the legibility is not. A screenshot test would have passed throughout — the pixels were
 * exactly what the CSS asked for.
 */
import { test, expect, type Page } from '@playwright/test';
import { openApp } from './helpers';

/** relative luminance and contrast, per WCAG */
function contrast(fg: string, bg: string): number {
  const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
  const lum = (rgb: number[]) => {
    const [r, g, b] = rgb.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const f = parse(fg);
  const b = parse(bg);
  const alpha = f[3] ?? 1;
  // flatten the alpha onto the ground, the way the screen does
  const flat = [0, 1, 2].map((i) => f[i]! * alpha + b[i]! * (1 - alpha));
  const [hi, lo] = [lum(flat), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * What a person actually sees on that line.
 *
 * Every `opacity` between the text and the page is multiplied in, because an ancestor's opacity does
 * not appear in the element's own computed colour — reading `color` alone would have reported a
 * perfectly healthy value for the whole life of this bug.
 */
async function seen(page: Page, selector: string, nth: number, pseudo?: string) {
  return page.evaluate(
    ({ sel, index, pseudoEl }) => {
      const el = document.querySelectorAll(sel)[index];
      if (!el) return null;
      const style = getComputedStyle(el, pseudoEl || undefined);

      let alpha = 1;
      let ground = '';
      for (let node: Element | null = el; node; node = node.parentElement) {
        const s = getComputedStyle(node);
        alpha *= Number(s.opacity);
        if (!ground && s.backgroundColor && !/rgba?\([\d\s,]*,\s*0\)/.test(s.backgroundColor)) {
          ground = s.backgroundColor;
        }
      }
      const rgb = (style.color.match(/[\d.]+/g) ?? []).slice(0, 3).join(', ');
      return { ink: `rgba(${rgb}, ${alpha})`, ground: ground || 'rgb(255, 255, 255)', raw: style.color };
    },
    { sel: selector, index: nth, pseudoEl: pseudo ?? '' },
  );
}

/**
 * Add a row, leave it empty, and tick it — the exact state the bug was reported in.
 *
 * Every step waits for the state it depends on rather than for a proxy of it. The first version
 * waited on `.done-label`, which is already on screen because the seeded library ships one completed
 * item, so it returned instantly and measured a row that had not moved yet. The second version
 * added a poll at the end and went from failing to FLAKY — the race had simply moved earlier, to
 * the row being created. A test that passes on the second attempt is not evidence of anything.
 */
async function emptyDoneRow(page: Page): Promise<number> {
  const doneBefore = await page.locator('.arow.done').count();

  await page.locator('.add').click();

  /*
   * `:empty` on the editable, not `hasText: /^$/` on the row.
   *
   * The row is never textually empty — it carries a 🗑 button — so the text predicate matched
   * nothing and the helper timed out against an app that was working. `:empty` is also the exact
   * state the CSS under test keys on (`.editable:empty::before`), so the test and the rule agree
   * on what "an empty row" means instead of approximating it.
   */
  const emptyOpen = page.locator('.arow:not(.done)').filter({ has: page.locator('.editable:empty') });
  await expect(emptyOpen).toHaveCount(1);
  await emptyOpen.locator('.cbx').click();

  // and it has arrived when the done group is one longer than it was
  await expect(page.locator('.arow.done')).toHaveCount(doneBefore + 1);

  const index = await page.evaluate(() =>
    [...document.querySelectorAll('.arow.done')].findIndex(
      (r) => !(r.querySelector('.editable')?.textContent ?? '').trim(),
    ),
  );
  expect(index, 'an empty done row must exist for this test to mean anything').toBeGreaterThanOrEqual(0);
  return index;
}

test.describe('a completed item stays readable', () => {
  test('written text clears the 3:1 floor', async ({ page }) => {
    await openApp(page);
    await page.locator('.arow').first().locator('.cbx').click();
    await expect(page.locator('.done-label')).toBeVisible();

    const measured = await seen(page, '.arow.done .title', 0);

    expect(measured).not.toBeNull();
    expect(contrast(measured!.ink, measured!.ground)).toBeGreaterThanOrEqual(3);
  });

  test('AN EMPTY COMPLETED ITEM IS STILL VISIBLE', async ({ page }) => {
    await openApp(page);
    const i = await emptyDoneRow(page);

    const measured = await seen(page, '.arow.done .title .editable', i, '::before');

    expect(measured).not.toBeNull();
    expect(
      contrast(measured!.ink, measured!.ground),
      'the row was on screen, ticked, and the words were not',
    ).toBeGreaterThanOrEqual(3);
  });

  test('the placeholder is the same colour as written text', async ({ page }) => {
    // the literal ask: an empty done row must not read as a different kind of thing
    await openApp(page);
    const i = await emptyDoneRow(page);

    const placeholder = await seen(page, '.arow.done .title .editable', i, '::before');
    const text = await seen(page, '.arow.done .title', i);

    expect(placeholder!.raw).toBe(text!.raw);
  });
});
