import { expect, type Page, type Locator } from '@playwright/test';

/** The Archive page the app boots into — seeded, so every test starts from the same five rows. */
export const GROCERIES = 'Groceries';
export const FIRST_ITEM = 'Coffee beans — the Ethiopian one';

/**
 * Open the app and wait for the seed to render.
 *
 * Waiting on a row rather than on `load` matters: seeding is async (Dexie + a migration pass), so
 * the shell paints before there is anything in it and an immediate click lands on empty space.
 */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.arow').first()).toBeVisible({ timeout: 15_000 });
  /*
   * Wait for the webfonts before any measurement.
   *
   * The app self-hosts Plus Jakarta Sans, and until it swaps in, every row is laid out in a
   * fallback with different metrics — rows are shorter, so gaps between controls are smaller. A
   * layout assertion that runs in that window measures a page that existed for 80ms and never
   * again, which shows up as a test that fails once in ten runs for no visible reason.
   */
  await page.evaluate(() => document.fonts.ready);
}

/** Every Archive row, in visual order. */
export const rows = (page: Page): Locator => page.locator('.arow');

/**
 * Open a page from the sidebar by title.
 *
 * There is still no router, so a page cannot be reached by URL and every test that needs one has to
 * click its way there. On mobile the sidebar is a drawer behind the Notes tab.
 */
export async function openNote(page: Page, title: string): Promise<void> {
  const row = page.locator('.row.page-row').filter({ hasText: title }).first();
  // `isVisible()` is true for a closed drawer — it is laid out, just translated off-screen. Ask
  // where it actually IS instead, or the click waits forever for an element nobody can reach.
  const box = await row.boundingBox().catch(() => null);
  if (!box || box.x < 0 || box.x > page.viewportSize()!.width) {
    await page.locator('.tab').filter({ hasText: 'Notes' }).click();
    await settledDrawer(page, 'open');
  }
  await row.click();
  // `.bar` matches progress tracks too — the breadcrumb is the one header every page type has
  await expect(page.locator('.crumb .cr-cur').first()).toContainText(title.slice(0, 6));
  // Selecting closes the drawer over 200ms. Left un-awaited, the NEXT call measures a half-closed
  // drawer, decides it needs opening, and restarts the slide — so the row it wants to click never
  // holds still and Playwright fails it as "element is not stable".
  await settledDrawer(page, 'closed');
}

/** Wait until the drawer has finished sliding, in whichever direction. */
async function settledDrawer(page: Page, state: 'open' | 'closed'): Promise<void> {
  await page
    .waitForFunction(
      (want) => {
        const col = document.querySelector('.sidebar-col');
        if (!col) return true; // desktop: no drawer to wait for
        // Ask where it IS, not what its transform string says: `.open` sets `transform: none` but
        // Chrome reports the settled value as an identity `matrix(1, 0, 0, 1, 0, 0)`, so a string
        // comparison never matches and every wait silently burns its whole timeout.
        const r = col.getBoundingClientRect();
        return want === 'open' ? r.left >= 0 : r.right <= 0;
      },
      state,
      { timeout: 5_000 },
    )
    .catch(() => undefined); // desktop never animates; don't fail a test over a wait that can't apply
}

/** The row whose text starts with `text`. */
export const rowByText = (page: Page, text: string): Locator =>
  page.locator('.arow').filter({ hasText: text }).first();

/**
 * Click a row on part of the row ITSELF — not its text, its checkbox, or its delete button.
 *
 * A fixed offset like (6, 8) used to serve, but on a coarse pointer the checkbox's 44px tap zone
 * reaches over the row's left padding (correctly — that is the point of the enlarged target), so
 * the top-left corner now belongs to the checkbox. This picks the gap between the end of the text
 * and the delete button, which is row and only row at every width.
 */
export async function selectRow(page: Page, row: Locator): Promise<void> {
  const box = (await row.boundingBox())!;
  await page.mouse.click(box.x + box.width - 60, box.y + box.height / 2);
}

/**
 * Put the caret after the last character of a contenteditable, then type.
 *
 * Neither of the obvious ways works reliably. `keyboard.press('End')` moves to the end of the
 * visual LINE, so a click that landed mid-word leaves the caret where it was; and clicking the
 * field's right edge lands on whatever line the vertical centre falls on, which on a 390px screen
 * is the middle of a wrapped title. Both produce text spliced into the middle of the string — a
 * test failure that looks exactly like a save bug and is not one.
 *
 * Collapsing a range to the end of the node's contents is the same thing EditableText.focus() does.
 */
export async function typeAtEnd(page: Page, field: Locator, text: string): Promise<void> {
  await field.evaluate((el) => {
    (el as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  await page.keyboard.type(text);
}

/** What the app has actually persisted for blocks whose text contains `needle`. */
export async function storedBlocks(page: Page, needle: string): Promise<{ text: string; checked: number }[]> {
  return page.evaluate(async (n) => {
    const req = indexedDB.open('modern_todo');
    const dbi: IDBDatabase = await new Promise((res) => { req.onsuccess = () => res(req.result); });
    const r = dbi.transaction('blocks').objectStore('blocks').getAll();
    const all: { text?: string; checked?: number }[] = await new Promise((res) => { r.onsuccess = () => res(r.result); });
    return all.filter((b) => (b.text ?? '').includes(n)).map((b) => ({ text: b.text ?? '', checked: b.checked ?? 0 }));
  }, needle);
}

/**
 * What the app has actually persisted under a `meta` key.
 *
 * Settings writes preferences on a 300ms debounce, so a `reload()` fired straight after typing
 * races the write and the assertion fails on a bug that isn't there. Poll this until the value
 * lands, then reload — wait on the observable effect, never on a timeout.
 */
export async function storedMeta(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async (k) => {
    const req = indexedDB.open('modern_todo');
    const dbi: IDBDatabase = await new Promise((res) => { req.onsuccess = () => res(req.result); });
    const r = dbi.transaction('meta').objectStore('meta').get(k);
    const row: { value?: unknown } | undefined = await new Promise((res) => { r.onsuccess = () => res(r.result); });
    return row?.value ?? null;
  }, key);
}

/**
 * The name on a profile, read straight out of IndexedDB.
 *
 * Profiles are keyed by account — the Supabase user id, or `'local'` when nobody is signed in —
 * because a single global key meant one identity per device, and signing in as somebody else showed
 * you the previous person's name and photograph. Tests that are not signed in want `'local'`.
 */
export async function storedProfileName(page: Page, id = 'local'): Promise<unknown> {
  return page.evaluate(async (key) => {
    const req = indexedDB.open('modern_todo');
    const dbi: IDBDatabase = await new Promise((res) => { req.onsuccess = () => res(req.result); });
    const r = dbi.transaction('profiles').objectStore('profiles').get(key);
    const row: { displayName?: unknown } | undefined = await new Promise((res) => { r.onsuccess = () => res(r.result); });
    return row?.displayName ?? null;
  }, id);
}

/**
 * Does the page scroll sideways?
 *
 * The single most common responsive break, and invisible in a screenshot of the top of the page.
 * 1px of slack absorbs sub-pixel rounding at fractional device pixel ratios.
 */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

/** Elements wider than the viewport — the thing that CAUSED the overflow above. */
export async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).join('.') : '';
        out.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} (${Math.round(r.left)}→${Math.round(r.right)} vs ${vw})`);
      }
    }
    return [...new Set(out)].slice(0, 12);
  });
}

/**
 * Controls that are too small to hit reliably with a finger.
 *
 * 44×44 CSS px is the WCAG 2.5.5 / iOS HIG target. Reported rather than asserted per-element so one
 * run tells you every offender instead of stopping at the first.
 *
 * Measured by HIT-TESTING, not by `getBoundingClientRect`. The standard way to enlarge a touch
 * target is a transparent absolutely-positioned `::after` — the drawn control stays 18px while the
 * tappable region becomes 44px — and a pseudo-element is invisible to the element's own rect. So
 * this probes what a finger would actually land on: `elementFromPoint` at the four edge midpoints
 * of a 44×44 box centred on the control. A control passes only if all four resolve to it.
 */
export async function smallTouchTargets(page: Page, min = 44): Promise<string[]> {
  return page.evaluate((minSize) => {
    const out: string[] = [];
    const sel = 'button, [role="button"], a[href], input[type="checkbox"], summary';
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // not rendered
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.opacity === '0') continue;
      // A closed drawer is still laid out, just translated off-screen — its buttons are real
      // elements with real sizes that nobody can tap. Only score what is actually on screen.
      if (r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) continue;

      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const half = minSize / 2;
      const probes: [number, number][] = [
        [cx, cy - half + 1], // top edge of the 44-box
        [cx, cy + half - 1], // bottom
        [cx - half + 1, cy], // left
        [cx + half - 1, cy], // right
      ];

      // a probe that falls off-screen can't be tapped either, so it counts as a miss
      const reaches = probes.every(([x, y]) => {
        if (x < 0 || y < 0 || x > vw || y > vh) return false;
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === el || el.contains(hit));
      });

      if (!reaches) {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28);
        const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).join('.') : '';
        out.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} "${label}" drawn ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return [...new Set(out)];
  }, min);
}

/**
 * How many rows are still waiting to go up.
 *
 * The one honest way to ask "has it synced yet" from the outside. It used to count `sync_queue`,
 * where an operation left only on a confirmed ACK — but that table could also hold operations the
 * engine had given up on, so a non-zero depth meant either "in progress" or "never again", and the
 * two were indistinguishable from here.
 *
 * `dirty` cannot be ambiguous in that way: it is an index over `version > syncedVersion`, so 0 means
 * every row on this device has been acknowledged by the server. Polling it beats sleeping — the
 * round trip is a real network call whose duration nobody can predict.
 */
export async function outboxDepth(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const req = indexedDB.open('modern_todo');
    const dbi: IDBDatabase = await new Promise((res) => { req.onsuccess = () => res(req.result); });
    const count = (store: string) =>
      new Promise<number>((res) => {
        // `dirty` is indexed on every syncable table; a table missing from an older database counts 0
        try {
          const r = dbi.transaction(store).objectStore(store).index('dirty').count(1);
          r.onsuccess = () => res(r.result);
          r.onerror = () => res(0);
        } catch {
          res(0);
        }
      });
    const parts = await Promise.all(['workspaces', 'notes', 'blocks', 'tombstones'].map(count));
    return parts.reduce((a, b) => a + b, 0);
  });
}
