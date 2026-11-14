/**
 * usePwa — service worker registration, the update prompt, install, and persistent storage.
 *
 * Module-level state, not per-component: there is exactly one service worker registration per
 * page, and `beforeinstallprompt` fires ONCE — if a component owned it, the event would be lost
 * the moment that component unmounted. Every caller sees the same refs.
 *
 * The one rule this file exists to enforce:
 *
 *     a new version NEVER takes over the page by itself.
 *
 * `registerType: 'prompt'` leaves the new worker in `waiting`, and nothing changes until
 * `applyUpdate()` is called. That matters more here than in most apps: this one has a text editor
 * (a reload mid-sentence loses the caret and whatever hasn't been debounced to Dexie yet) and a
 * durable outbox whose schema can change between builds.
 */
import { ref, readonly } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import { logger } from '@/core/logging/logger';
import { useDesktopUpdate } from '@/composables/useDesktopUpdate';

const log = logger.scoped('pwa');

/** a new version is downloaded and waiting for the user to accept it */
const needRefresh = ref(false);
/** the shell is cached — the app will now launch with no network */
const offlineReady = ref(false);
/** true once we're running from the home screen / an installed window rather than a browser tab */
const installed = ref(false);
/** set when the browser tells us the app is installable; null means "no offer available" */
const canInstall = ref(false);
/** IndexedDB is exempt from eviction under storage pressure */
const persisted = ref<boolean | null>(null);
// shared by the ?install= landing link and the Settings "How to install" button
const installSheetOpen = ref(false);

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let started = false;

/**
 * The event Chromium fires when it decides the app qualifies for installation. It is not in
 * lib.dom, and it is the only way to trigger an install from our own UI rather than a browser menu.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Tauri injects this global into the desktop (.dmg / .exe) build
function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** standalone = launched from the home screen. iOS uses a non-standard navigator flag. */
function detectInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  if (isDesktopApp()) return true;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone === true;
}

/**
 * Ask the browser to exempt our data from eviction.
 *
 * This is not a nice-to-have. IndexedDB IS the database in this app (ARCHITECTURE.md §15 — "the
 * read source"), and a browser clearing "cache" under storage pressure would take the user's notes
 * with it. Chromium usually grants this silently once the app is installed or engaged with;
 * Safari's grant is tied to installation. A refusal is not an error — we surface the state in
 * Settings and carry on.
 */
async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) {
      persisted.value = true;
      return true;
    }
    const granted = await navigator.storage.persist();
    persisted.value = granted;
    log.debug('storage.persist', { granted });
    return granted;
  } catch {
    persisted.value = false;
    return false;
  }
}

/** Register the worker and start listening. Call once, from main.ts. */
function init(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  installed.value = detectInstalled();
  // the landing page's download buttons arrive with ?install=ios|android|desktop
  if (!installed.value && new URLSearchParams(window.location.search).has('install')) installSheetOpen.value = true;

  // the desktop build ships its files inside the app; new versions come from the Tauri updater
  if (isDesktopApp()) {
    offlineReady.value = true;
    void requestPersistence();
    useDesktopUpdate().start();
    return;
  }

  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // a newer build is cached and waiting — the user decides when it takes over
      needRefresh.value = true;
      log.info('update available');
    },
    onOfflineReady() {
      offlineReady.value = true;
      log.info('shell cached — offline ready');
    },
    onRegisterError(e) {
      // an unregistered worker is a degraded app, not a broken one: everything still works online
      log.warn('service worker registration failed', { message: String(e) });
    },
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // stop Chrome's own mini-infobar; we offer it in Settings instead
    deferredPrompt = e as BeforeInstallPromptEvent;
    canInstall.value = true;
  });

  window.addEventListener('appinstalled', () => {
    installed.value = true;
    canInstall.value = false;
    deferredPrompt = null;
    // an installed app is the moment Safari and Chromium are most willing to grant this
    void requestPersistence();
  });

  void requestPersistence();
}

/** Accept the waiting version. This DOES reload the page — it's the user's explicit choice. */
async function applyUpdate(): Promise<void> {
  needRefresh.value = false;
  await updateSW?.(true);
}

/** Dismiss the update for this session; it stays waiting and is offered again next launch. */
function dismissUpdate(): void {
  needRefresh.value = false;
}

/** Show the browser's install dialog. Resolves false when there was nothing to show. */
async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  // the event is single-use: once shown, the browser will fire a fresh one if still eligible
  deferredPrompt = null;
  canInstall.value = false;
  return outcome === 'accepted';
}

function openInstallSheet(): void {
  installSheetOpen.value = true;
}

/** Close the sheet and drop ?install= so a reload never reopens it. */
function closeInstallSheet(): void {
  installSheetOpen.value = false;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('install')) return;
  url.searchParams.delete('install');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

export function usePwa() {
  return {
    needRefresh: readonly(needRefresh),
    offlineReady: readonly(offlineReady),
    installed: readonly(installed),
    canInstall: readonly(canInstall),
    persisted: readonly(persisted),
    installSheetOpen: readonly(installSheetOpen),
    init,
    applyUpdate,
    dismissUpdate,
    promptInstall,
    requestPersistence,
    openInstallSheet,
    closeInstallSheet,
  };
}
