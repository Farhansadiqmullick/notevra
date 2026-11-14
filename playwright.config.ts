import { defineConfig, devices } from '@playwright/test';

/**
 * UI regression suite — the layer vitest cannot reach.
 *
 * The unit suite proves the engine, the services and the database. None of it renders anything, so
 * every layout and pointer-interaction bug in this app has so far been found by a human opening it
 * on a phone. That is what this covers: does the thing appear, at this width, and does clicking it
 * do what a person expects.
 *
 * Three viewports, because the bugs differ by width rather than by feature:
 *   desktop  1440×900 — two-pane Archive, sidebar, properties rail
 *   tablet    834×1112 — sidebar still present, panes narrow (the least-tested width)
 *   mobile    390×844 — sidebar becomes a drawer, tab bar appears, detail must be reachable
 *
 * Runs against the dev server: the service worker is off there by design (vite.config.ts
 * devOptions), and a worker serving a stale shell mid-suite would produce failures that have
 * nothing to do with the code under test.
 */
/**
 * `E2E_TARGET=preview` runs the same suite against the PRODUCTION build on :4173 instead of the dev
 * server — the bundle people actually load from a phone. Worth having as a switch rather than a
 * second suite: a bug that only appears in the build (minification, prod-mode Vue, the service
 * worker) is invisible to a dev-server run, and "it works on my machine" usually means "it works
 * unminified".
 */
const PREVIEW = process.env.E2E_TARGET === 'preview';
/**
 * `E2E_BASE_URL` points the suite at an origin already being served — in practice the LAN address a
 * phone uses, e.g. `E2E_BASE_URL=http://192.168.0.130:4173`.
 *
 * That origin is NOT a secure context, and the difference is not cosmetic: service workers,
 * `navigator.storage.persist()` and `crypto.subtle` are all unavailable there while IndexedDB is
 * not. Running the persistence suite against it is the only way to tell "the app loses writes" from
 * "the browser threw the database away".
 */
const BASE = process.env.E2E_BASE_URL ?? (PREVIEW ? 'http://localhost:4173' : 'http://localhost:5173');

export default defineConfig({
  testDir: './e2e',
  // a UI failure is worth one retry — a genuine layout bug fails twice, a slow first paint doesn't
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'e2e-report', open: 'never' }]],

  use: {
    baseURL: BASE,
    // artefacts only for failures — this suite is meant to be run often
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1112 }, hasTouch: true } },
    /**
     * iPhone 13 metrics on Chromium rather than `devices['iPhone 13']`, which would pull WebKit and
     * make `npm run test:ui` need a second browser download to run at all. Everything this suite
     * asserts — widths, hit targets, whether a pane is reachable — is engine-independent. Real
     * Safari behaviour (install, standalone chrome, the Share sheet) can't be emulated by either
     * engine and is covered manually in DEVICE_TESTING.md.
     */
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  // an explicit base URL means the server is already running; starting another would fight for the port
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: PREVIEW ? 'npm run pwa' : 'npm run dev',
    url: BASE,
    // a preview run must serve a FRESH build, so never reuse a server that may hold an old dist/
    reuseExistingServer: !process.env.CI && !PREVIEW,
    timeout: 120_000,
  },
});
