/// <reference types="vite/client" />
/** virtual:pwa-register — the module vite-plugin-pwa generates at build time (composables/usePwa) */
/// <reference types="vite-plugin-pwa/client" />

/**
 * Both are OPTIONAL — typed as `string | undefined` on purpose. The app is designed to run with
 * neither set (local-only mode), so anything that reads them has to handle their absence, and
 * pretending they are always present would let a `!` slip in that crashes an unconfigured build.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /**
   * Absolute origin auth emails return to. Optional: unset falls back to the current origin, which
   * is right for dev and branch previews. See core/auth/siteUrl — it must match a Redirect URLs
   * entry in the Supabase dashboard or Supabase silently substitutes the project's Site URL.
   */
  readonly VITE_SITE_URL?: string;
  // 'true' / 'false' forces Settings' sync diagnostics + developer tools on or off; unset = dev only
  readonly VITE_SYNC_DIAGNOSTICS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
