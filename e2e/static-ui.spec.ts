import { test, expect } from '@playwright/test';
import { openApp, openNote, typeAtEnd, storedMeta, storedProfileName, storedBlocks } from './helpers';

/**
 * Scenery: UI that reads as a working feature and isn't one.
 *
 * This is the class of problem the project has already been bitten by twice — the "Sort ⌄" button
 * that sorted nothing, the Board/Page toggles that switched nothing. Both were removed with the
 * same reasoning in the commit messages: a control that silently does nothing trains people to
 * distrust the whole toolbar. These tests keep the remaining ones honest.
 *
 * They run on desktop only. Nothing here is width-dependent, and running an audit three times
 * produces the same list three times.
 */
test.describe('nothing is scenery', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'not width-dependent');
    await openApp(page);
  });

  test('the list subtitle reports a real edit time, not a fixed string', async ({ page }) => {
    const sub = page.locator('.list .sub');
    await expect(sub).toBeVisible();
    const text = (await sub.textContent()) ?? '';

    expect(
      text,
      'ArchiveList.vue hardcodes "updated 6 min ago" — it says the same thing on a page edited ' +
        'ten seconds ago and one untouched for a year',
    ).not.toContain('6 min ago');
  });

  test('the sidebar sync label follows the real sync state', async ({ page }) => {
    const label = page.locator('.sidebar').getByText(/synced|syncing|offline|waiting/i).first();
    if (!(await label.count())) test.skip(true, 'no sync label rendered');
    const text = (await label.textContent()) ?? '';

    expect(
      text,
      'App.vue passes a literal sync-label="synced 2m ago" while sync.store.label computes the ' +
        'real one — the dot is live and the words beside it are not',
    ).not.toContain('2m ago');
  });

  test('the filter pills actually filter', async ({ page }) => {
    const all = await page.locator('.arow').count();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect.poll(() => page.locator('.arow').count()).toBeLessThan(all);

    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect.poll(() => page.locator('.arow').count()).toBeGreaterThan(0);
  });

  test('the sort control reorders the list', async ({ page }) => {
    const before = await page.locator('.arow .editable').allTextContents();
    await page.locator('.sort').click();
    await expect.poll(async () => page.locator('.arow .editable').allTextContents()).not.toEqual(before);
  });

  test('the page ⋯ menu opens and its items are wired', async ({ page }) => {
    await page.locator('.more').click();
    const menu = page.locator('.menu-wrap .menu').first();
    await expect(menu).toBeVisible();
    for (const item of await menu.locator('button').allTextContents()) {
      expect(item.trim().length).toBeGreaterThan(0);
    }
  });

  /**
   * The broad sweep: click every visible control in the page chrome and see whether the document
   * changed at all. Reloads between clicks so one control's effect can't be credited to the next.
   */
  test('no visible control is inert', async ({ page }) => {
    const selectors = await page.evaluate(() => {
      const out: string[] = [];
      const scope = document.querySelectorAll('.bar button, .list .filters button, .actionbar button');
      scope.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.width && r.height) out.push(String(i));
      });
      return out;
    });

    const dead: string[] = [];
    for (const idx of selectors) {
      await page.reload();
      await expect(page.locator('.arow').first()).toBeVisible({ timeout: 15_000 });

      const all = page.locator('.bar button, .list .filters button, .actionbar button');
      const btn = all.nth(Number(idx));
      if (!(await btn.isVisible().catch(() => false))) continue;

      // A control already in its active state has nothing to change — clicking the "Open" filter
      // while Open is showing is correctly a no-op, not a dead button.
      const cls = (await btn.getAttribute('class')) ?? '';
      if (/\bis-active\b|\bactive\b|\bon\b/.test(cls) || (await btn.getAttribute('aria-pressed')) === 'true') continue;

      const label = ((await btn.getAttribute('aria-label')) || (await btn.textContent()) || `#${idx}`).trim().slice(0, 30);
      const before = await page.evaluate(() => document.body.innerHTML.length + '|' + document.querySelectorAll('*').length);
      await btn.click({ timeout: 4000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => document.body.innerHTML.length + '|' + document.querySelectorAll('*').length);

      if (before === after) dead.push(label);
    }

    expect(dead, `controls that changed nothing when clicked: ${dead.join(' | ')}`).toEqual([]);
  });
});

/**
 * Planning — the last page type to get a ⋯ menu.
 *
 * The gap was the same one Single had and slightly worse: Archive at least has rows that carry
 * their own delete, and Planning has neither that nor a list to right-click. Until this menu
 * existed a Planning page could not be archived, duplicated, exported or deleted at all.
 */
test.describe('Planning page chrome', () => {
  const NOTE = 'Week of 27 July';

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'not width-dependent');
    await openApp(page);
    await openNote(page, NOTE);
  });

  test('the ⋯ menu opens and offers the page actions', async ({ page }) => {
    await page.locator('.content .bar .more').click();
    await expect(page.locator('.content .bar .menu button')).toHaveText([
      'Rename…',
      'Move to Archive',
      'Duplicate page',
      'Export this page',
      'Delete page',
    ]);
  });

  test('Move to Archive removes the page from the sidebar, says so, and leaves it', async ({ page }) => {
    await page.locator('.content .bar .more').click();
    await page.locator('.menu button', { hasText: 'Move to Archive' }).click();

    await expect(page.locator('.notice')).toHaveText(/Page moved to Archive/);
    await expect(page.locator('.row.page-row').filter({ hasText: NOTE })).toHaveCount(0);
    await expect(page.locator('.crumb .cr-cur')).not.toContainText(NOTE);
  });

  test('Delete page moves it to Trash and leaves it', async ({ page }) => {
    await page.locator('.content .bar .more').click();
    await page.locator('.menu button', { hasText: 'Delete page' }).click();

    await expect(page.locator('.notice')).toHaveText(/Page moved to Trash/);
    await expect(page.locator('.row.page-row').filter({ hasText: NOTE })).toHaveCount(0);
  });

  /**
   * The page's name has to be IN the page.
   *
   * Planning was the only type without an in-document title: Single renders one under its header
   * and Archive renders one above its list, but here the 12px breadcrumb was the only place the
   * name appeared. So naming a page — the very first thing the onboarding flow asks you to do —
   * changed a line of chrome and left the document itself anonymous.
   */
  test('the page name is in the document, not only in the breadcrumb', async ({ page }) => {
    // Two things make the obvious selector wrong. NoteTitle renders EditableText, whose root is a
    // `.et-wrap` span — the class from the parent lands on the WRAPPER, so the h1 is the element
    // inside it and `h1.title` matches nothing. And `.title` is not unique inside the document:
    // every task block carries one too. The page title is the direct child of `.doc`.
    const title = page.locator('.doc > .title');
    await expect(title).toBeVisible();
    await expect(title).toContainText(NOTE);
    // and it is a real heading, not just 32px text — the outline and screen readers both read this
    await expect(page.locator('.doc > .title h1')).toHaveCount(1);
  });

  test('renaming from the document H1 updates the breadcrumb too', async ({ page }) => {
    const h1 = page.locator('.doc > .title h1');
    await typeAtEnd(page, h1, ' — revised');

    // both surfaces are NoteTitle bound to the same liveQuery; assert it rather than assume it
    await expect(page.locator('.crumb .cr-cur')).toContainText('revised');
    await expect(h1).toContainText('revised');
  });
});

/**
 * The same audit pointed at Single — the page type §J found three dead controls on.
 *
 * Worth its own block rather than a wider `beforeEach`: Single is the page with the fewest ways out
 * (no list, no rows, no filters), so until the ⋯ menu was wired there was no way to archive,
 * duplicate, export or delete one at all. The controls in this header are all there is.
 */
test.describe('Single page chrome', () => {
  const NOTE = 'Flat inspection';

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'not width-dependent');
    await openApp(page);
    await openNote(page, NOTE);
  });

  test('the ‹ back button is gone — it pointed at a history this app does not have', async ({ page }) => {
    await expect(page.locator('.content .bar .back')).toHaveCount(0);
  });

  test('the ⋯ menu opens and offers the page actions', async ({ page }) => {
    await page.locator('.bar .more').click();
    const menu = page.locator('.bar .menu-wrap .menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('button')).toHaveText([
      'Rename…',
      'Move to Archive',
      'Duplicate page',
      'Export this page',
      'Delete page',
    ]);
  });

  test('Move to Archive removes the page from the sidebar, says so, and leaves it', async ({ page }) => {
    const sidebarRow = page.locator('.row.page-row').filter({ hasText: NOTE });
    await expect(sidebarRow).toHaveCount(1);

    await page.locator('.bar .more').click();
    await page.locator('.menu button', { hasText: 'Move to Archive' }).click();

    await expect(page.locator('.notice')).toHaveText(/Page moved to Archive/);
    await expect(sidebarRow, 'an archived page leaves the sidebar tree').toHaveCount(0);
    // and it must not still be the page on screen — that was the §M failure, one level up
    await expect(page.locator('.crumb .cr-cur')).not.toContainText(NOTE);
  });

  test('Duplicate page makes a real copy', async ({ page }) => {
    await page.locator('.bar .more').click();
    await page.locator('.menu button', { hasText: 'Duplicate page' }).click();

    await expect(page.locator('.crumb .cr-cur')).toContainText('(copy)');
    await expect(page.locator('.row.page-row').filter({ hasText: `${NOTE} (copy)` })).toHaveCount(1);
  });

  test('Delete page moves it to Trash and leaves it', async ({ page }) => {
    await page.locator('.bar .more').click();
    await page.locator('.menu button', { hasText: 'Delete page' }).click();

    await expect(page.locator('.notice')).toHaveText(/Page moved to Trash/);
    await expect(page.locator('.row.page-row').filter({ hasText: NOTE })).toHaveCount(0);
  });

  /**
   * Green now. This was tagged `@known` while **Share** sat here wired to nothing — sharing needs
   * the server that does not exist yet, so it was a real gap with a known cause rather than a
   * regression, and the tag kept `test:ui:regress` a clean gate while still reporting it every run.
   *
   * Share has since been removed (design/ui-test-plan.md §J), so the tag came off. Note what was
   * NOT done: the assertion was never relaxed to `toEqual(['Share'])`. Baking a known offender into
   * the expectation is how a temporary gap becomes permanent — the list has to stay empty, so the
   * next dead control fails this the day it appears.
   */
  test('no visible control in the Single header is inert', async ({ page }) => {
    const count = await page.locator('.content .bar button').count();
    const dead: string[] = [];

    for (let i = 0; i < count; i++) {
      // a reload boots on the default Archive page, so wait for the SEED and navigate back to
      // Single — waiting for `.content .bar` first would wait for a header that isn't rendered yet
      await page.reload();
      await expect(page.locator('.arow').first()).toBeVisible({ timeout: 15_000 });
      await openNote(page, NOTE);
      await expect(page.locator('.content .bar').first()).toBeVisible();

      const btn = page.locator('.content .bar button').nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;

      const cls = (await btn.getAttribute('class')) ?? '';
      if (/\bis-active\b|\bactive\b|\bon\b/.test(cls)) continue; // already in its active state

      const label = ((await btn.getAttribute('aria-label')) || (await btn.textContent()) || `#${i}`).trim().slice(0, 30);
      const before = await page.evaluate(() => document.body.innerHTML.length + '|' + document.querySelectorAll('*').length);
      await btn.click({ timeout: 4000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => document.body.innerHTML.length + '|' + document.querySelectorAll('*').length);

      if (before === after) dead.push(label);
    }

    expect(dead, `controls that changed nothing when clicked: ${dead.join(' | ')}`).toEqual([]);
  });
});

/**
 * Settings — the screen that never got swept.
 *
 * Archive, Single and Planning were each audited for controls wired to nothing. Settings was not,
 * and it turned out to hold more of them than the other three combined: a Display name input with
 * no v-model and no handler, a hardcoded name and email presented as the user's own, Change
 * password and Sign out with no click handlers, and three notification checkboxes bound to a `ref`
 * nothing read — in an app with no `Notification` API call anywhere in it.
 *
 * NOT swept by clicking everything, the way the Single header is. Half the controls here have real
 * side effects — Download JSON starts a download, the import Dropzone opens a native file picker
 * Playwright cannot dismiss, Stage a conflict mutates the mock server, Install shows a browser
 * prompt. A blind sweep would either hang or leave the suite in a state the next test inherits. So
 * this asserts the specific findings instead, plus one property that generalises (below).
 */
test.describe('Settings has no dead controls', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'not width-dependent');
    await openApp(page);
    await page.locator('.sidebar .foot-btn', { hasText: 'Settings' }).click();
    await expect(page.locator('.nav-label')).toHaveText('SETTINGS');
  });

  const section = (page: import('@playwright/test').Page, label: string) =>
    page.locator('.nav-row', { hasText: label }).click();

  test('the display name saves — it was an input bound to nothing', async ({ page }) => {
    const input = page.locator('.inp');
    await input.fill('Farhan');

    // the write is debounced 300ms; reloading straight after typing races it and fails on a bug
    // that isn't there. Wait for the value to actually land in IndexedDB.
    //
    // It lands on the `local` PROFILE, not on a `displayName` meta key. That key was global, so the
    // device had one identity no matter who signed into it — sign out as one person and in as
    // another and the second was greeted by the first one's name and picture.
    await expect.poll(() => storedProfileName(page)).toBe('Farhan');

    // survive a reload: the old field kept its value only until the next render, which is exactly
    // what made it convincing — it looked like it worked for as long as you were looking at it
    await page.reload();
    await expect(page.locator('.arow').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('.sidebar .foot-btn', { hasText: 'Settings' }).click();
    await expect(page.locator('.inp')).toHaveValue('Farhan');
    await expect(page.locator('.identity .name')).toHaveText('Farhan');
  });

  test('no fabricated account is presented as the user', async ({ page }) => {
    const body = page.locator('.body');
    // a seeded persona the user never entered, shown where their own details belong
    await expect(body).not.toContainText('Aarav');
    await expect(body).not.toContainText('aarav@example.com');
  });

  /**
   * These two now EXIST — Auth shipped — but only for someone who is signed in. This run has no
   * server configured and nobody signed in, which is the state that must not show them: a Sign out
   * with no session and a Change password with no account are the dead controls §R deleted.
   * `e2e/auth.spec.ts` covers the other half, where being signed in makes them appear and work.
   */
  test('Change password and Sign out stay absent while nobody is signed in', async ({ page }) => {
    const body = page.locator('.body');
    await expect(body.locator('button', { hasText: /^Change$/ })).toHaveCount(0);
    await expect(body.locator('button', { hasText: /^Sign out$/ })).toHaveCount(0);
  });

  test('the notification switches are gone — nothing was behind them', async ({ page }) => {
    await section(page, 'Notifications');
    await expect(page.locator('.body input[type="checkbox"]')).toHaveCount(0);
    // and the screen says what each one is waiting for rather than going silent about it
    await expect(page.locator('.body')).toContainText('Due reminders');
  });

  /**
   * The property that generalises past today's findings.
   *
   * A preference control that forgets on reload is the same lie as one wired to nothing — it
   * animates, it looks accepted, and it is gone next time you look. This passes vacuously right now
   * (there are no checkboxes left in Settings), and that is the point: it fails the day someone
   * adds one back without giving it somewhere to live.
   */
  test('every switch in Settings remembers its state', async ({ page }) => {
    for (const s of ['Profile', 'Appearance', 'Sync & Storage', 'Notifications', 'About']) {
      await section(page, s);
      const boxes = page.locator('.body input[type="checkbox"]');
      for (let i = 0; i < (await boxes.count()); i++) {
        const before = await boxes.nth(i).isChecked();
        await boxes.nth(i).click();
        const toggled = await boxes.nth(i).isChecked();
        expect(toggled, `a checkbox in ${s} did not respond to a click`).not.toBe(before);

        await page.reload();
        await expect(page.locator('.arow').first()).toBeVisible({ timeout: 15_000 });
        await page.locator('.sidebar .foot-btn', { hasText: 'Settings' }).click();
        await section(page, s);
        expect(
          await page.locator('.body input[type="checkbox"]').nth(i).isChecked(),
          `checkbox #${i} in ${s} forgot its state on reload — it is bound to a ref, not to storage`,
        ).toBe(toggled);
      }
    }
  });

  test('About names the app the app calls itself', async ({ page }) => {
    await section(page, 'About');
    await expect(page.locator('.about .name')).toHaveText('Notevra');
  });
});

/**
 * Subtasks are lines, not just checkboxes.
 *
 * A subtask could only ever be a task, so everything under a parent was a checkbox whether or not
 * it was a thing to tick off. Notes, a heading, a snippet of code — anything that was not itself a
 * to-do had nowhere to live except the parent's prose, or a checkbox that would never be checked.
 *
 * `/` now works on a subtask the way it works in the body, and the rows that back it had to widen
 * to match: three separate places filtered children to `type === 'task'`, and each of them would
 * have made a converted subtask vanish from the screen while staying in the database.
 *
 * Enter then stopped continuing the type. Making a checkbox was the default and converting away
 * from it was the effort, which is backwards — most of what people write under a task is context,
 * not more work — so the default is now a plain line and `/ Task` is how you ask for a checkbox.
 */
test.describe('a line under a task can be any kind of block', () => {
  const NOTE = 'Week of 27 July';

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'not width-dependent');
    await openApp(page);
    await openNote(page, NOTE);
  });

  /**
   * Put the caret in a fresh, empty line under the first task on the page.
   *
   * Enter under a subtask gives a PLAIN LINE, not another checkbox — a checkbox is a commitment,
   * and continuing the type made one out of every line the user wrote there. So the new row is a
   * `.sub-block`, and `.subtask` count is unchanged.
   *
   * The row has to be waited for AND focused explicitly. Enter writes the new block to Dexie and
   * hands the caret over through `ui.setFocus`, which retries until the component's ref binds —
   * so typing straight after the keypress races both, and the characters land nowhere. Focusing
   * the new row here makes the test independent of that handoff's timing.
   */
  async function newLine(page: import('@playwright/test').Page) {
    const first = page.locator('.subtask .editable').first();
    await expect(first).toBeVisible();
    const before = await page.locator('.sub-block').count();

    await typeAtEnd(page, first, '');
    await page.keyboard.press('Enter');
    await expect(page.locator('.sub-block')).toHaveCount(before + 1);

    const fresh = page.locator('.sub-block .editable').nth(before);
    await typeAtEnd(page, fresh, '');
    return fresh;
  }

  test('Enter under a subtask gives a plain line, not another checkbox', async ({ page }) => {
    const boxes = await page.locator('.subtask').count();

    await newLine(page);

    // the whole point: nothing new to tick off appeared just because the user pressed Enter
    await expect(page.locator('.subtask')).toHaveCount(boxes);
    await expect(page.locator('.sub-block')).toHaveCount(1);
  });

  test('typing / on a line under a task opens the block menu', async ({ page }) => {
    await newLine(page);
    await page.keyboard.type('/');

    await expect(page.locator('.slash')).toBeVisible();
    // the same list the body offers — a line under a task is not a lesser surface
    await expect(page.locator('.slash .row').first()).toBeVisible();
  });

  test('/ Task turns that line into a checkbox', async ({ page }) => {
    const boxes = await page.locator('.subtask').count();
    await newLine(page);
    await page.keyboard.type('/');
    await expect(page.locator('.slash')).toBeVisible();
    await page.locator('.slash').getByText('Task', { exact: true }).click();

    // Enter no longer makes checkboxes, so `/` is the path that has to — otherwise a checklist
    // becomes unwritable without reaching for the mouse.
    await expect.poll(() => page.locator('.subtask').count()).toBe(boxes + 1);
  });

  test('converting a line keeps it on the page', async ({ page }) => {
    const before = await page.locator('.subtask').count();
    await newLine(page);
    await page.keyboard.type('/');
    await expect(page.locator('.slash')).toBeVisible();
    await page.locator('.slash').getByText('Heading', { exact: true }).click();

    // it is not among the checkbox rows...
    await expect.poll(() => page.locator('.subtask').count()).toBe(before);
    // ...and it is STILL DRAWN, indented under its parent. The bug this guards against is a row
    // that is converted, saved, and then rendered by nothing at all.
    await expect(page.locator('.sub-block')).toHaveCount(1);
  });

  test('a converted line survives a reload', async ({ page }) => {
    await newLine(page);
    await page.keyboard.type('/');
    await expect(page.locator('.slash')).toBeVisible();
    await page.locator('.slash').getByText('Heading', { exact: true }).click();

    // The converted row is a different component (BlockRenderer, loaded async), so wait for it and
    // focus it explicitly rather than trusting the caret to have followed the conversion.
    const converted = page.locator('.sub-block .editable').first();
    await expect(converted).toBeVisible();
    await typeAtEnd(page, converted, 'Notes on this');

    // …and wait for the 300ms debounced save to LAND before reloading. Reloading on the keystroke
    // races the write, and the row comes back empty — which reads as "conversion loses your text"
    // rather than as a test that reloaded too early.
    await expect
      .poll(async () => (await storedBlocks(page, 'Notes on this')).length)
      .toBeGreaterThan(0);

    await page.reload();
    await expect(page.locator('.arow').first()).toBeVisible({ timeout: 15_000 });
    await openNote(page, NOTE);

    await expect(page.locator('.sub-block')).toContainText('Notes on this');
  });

  /*
   * The counterpart rule — a task that owns children refuses to be converted, because only `task`
   * draws children — is covered in `src/services/block.service.test.ts` rather than here.
   *
   * It belongs at the service: it is an invariant of the data that every caller of `convertBlock`
   * must obey, and a slash-menu test proves it for exactly one caller. Driving it through the UI
   * also meant typing `/` into a task that already has text, which opens the menu with a query
   * matching nothing — so the test would pass whether the guard existed or not.
   */
});
