import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// Minimal Vite config. '@' → /src, matching every import in the codebase.
export default defineConfig({
  plugins: [
    vue(),
    /**
     * PWA — ARCHITECTURE.md §12 "PWA specifics for mobile", Phase 4.
     *
     * The service worker precaches the app SHELL only. It has nothing to do with the user's data:
     * that lives in IndexedDB and was already offline-first before any of this existed. The shell
     * is the part that used to need a network — HTML, JS, CSS, fonts, icons — and this is what
     * removes that last dependency.
     */
    VitePWA({
      /**
       * PROMPT, never autoUpdate. `autoUpdate` swaps the bundle and reloads the page on its own.
       * In an app with a text editor and a durable outbox that is not a convenience, it's a
       * hazard: a reload mid-sentence loses the caret and the un-debounced keystroke, and a new
       * bundle can carry a Dexie schema upgrade. Upgrades should happen when the user says so.
       */
      registerType: 'prompt',
      /** we call registerSW ourselves in composables/usePwa.ts, so the UI owns the prompt */
      injectRegister: null,

      /**
       * NOTE: no `includeAssets`. Everything in public/ is already copied into dist/ and matched by
       * globPatterns below, so listing the icons again only added duplicate precache entries.
       *
       * (The three MANIFEST icons still appear twice in sw.js — the plugin appends them itself on
       * top of the glob. Both copies carry the same revision hash, so Workbox dedupes them; it only
       * errors when one URL arrives with two different revisions. Left alone rather than papered
       * over with globIgnores, which would silently drop the icons if that behaviour ever changed.)
       */
      manifest: {
        name: 'Notevra',
        short_name: 'Notevra',
        description: 'Offline first, Sync Later. Notes, tasks and planning that live on your device.',
        /** '/' + scope '/' — the app is a single route today (App.vue is still pre-router) */
        start_url: '/',
        scope: '/',
        display: 'standalone',
        /**
         * The splash screen behind the icon while the shell boots. Static, so it cannot follow the
         * user's light/dark choice — this is --page from the light theme. The runtime
         * <meta name="theme-color"> DOES follow the theme (see usePwa/useTheme).
         */
        background_color: '#eeeff4',
        theme_color: '#5b6cf0', // --accent, indigo preset
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Android crops this to its own shape — the mark sits inside the safe zone
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

      workbox: {
        /**
         * woff2 is the entry people forget, and it's the one that makes an offline launch look
         * broken: the shell loads, and every heading renders in a system fallback.
         */
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
        /** single-page app: any navigation resolves to the shell, which then reads IndexedDB */
        navigateFallback: 'index.html',
        // its own page: serving the shell here would strand the desktop sign-in code in the web app
        navigateFallbackDenylist: [/^\/desktop-signed-in/],
        /** drop precaches from older builds instead of letting them accumulate in the user's quota */
        cleanupOutdatedCaches: true,
        /**
         * NOT set: `clientsClaim` / `skipWaiting`. The new worker waits until the user accepts the
         * update — the whole point of registerType 'prompt'. usePwa triggers the swap.
         */
      },

      devOptions: {
        /**
         * Off in dev on purpose. A service worker in front of the dev server serves stale modules
         * and turns a normal HMR edit into a "why isn't my change showing" hunt. Test the PWA with
         * `npm run build && npm run preview`.
         */
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  /**
   * Testing the installed app on a real phone (design/pwa.md §8).
   *
   * `host: true` binds every interface instead of localhost, so a device on the same Wi-Fi can
   * reach it. Note that a LAN address alone is NOT enough to test the PWA: service workers need a
   * secure context, and http://192.168.x.x is not one — the page loads, but nothing installs. Use
   * an HTTPS tunnel or Chrome's USB port-forwarding for that.
   *
   * `allowedHosts` is the part that isn't obvious. Vite 5.4 rejects requests whose Host header it
   * doesn't recognise (a DNS-rebinding defence), and a tunnel's hostname is exactly that — so
   * ngrok returns "Blocked request. This host is not allowed" and looks like a broken tunnel.
   * A leading dot allows the domain and its subdomains.
   */
  preview: {
    host: true,
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.trycloudflare.com', '.loca.lt'],
  },
  server: {
    host: true,
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.trycloudflare.com', '.loca.lt'],
  },
});
