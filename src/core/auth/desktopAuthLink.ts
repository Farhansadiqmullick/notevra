// Desktop Google sign-in: Google refuses embedded webviews, so the system browser signs in and returns via notevra://.
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/core/logging/logger';
import { authRedirectUrl } from './siteUrl';

const log = logger.scoped('auth');

export const DESKTOP_AUTH_CALLBACK = 'notevra://auth/callback';

export type AuthCallback = { kind: 'code'; code: string } | { kind: 'error'; message: string };

export const isDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Read the PKCE code or an error out of a callback link; null when the link is not ours. */
export function parseAuthCallback(url: string): AuthCallback | null {
  if (!url.startsWith(DESKTOP_AUTH_CALLBACK)) return null;
  const hashAt = url.indexOf('#');
  const queryAt = url.indexOf('?');
  const params = new URLSearchParams();
  // GoTrue puts the code in the query and errors in either place
  if (queryAt >= 0) new URLSearchParams(url.slice(queryAt + 1, hashAt > queryAt ? hashAt : undefined)).forEach((v, k) => params.set(k, v));
  if (hashAt >= 0) new URLSearchParams(url.slice(hashAt + 1)).forEach((v, k) => params.set(k, v));

  const error = params.get('error_description') ?? params.get('error');
  if (error) return { kind: 'error', message: error };
  // tokens are ignored on purpose: a link carrying someone else's tokens must not sign this app in
  const code = params.get('code');
  return code ? { kind: 'code', code } : null;
}

/** Open Google sign-in in the system browser. */
export async function openGoogleInBrowser(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    // a web page first, so the browser tab can say it's done before handing the code to notevra://
    options: { redirectTo: `${authRedirectUrl()}/desktop-signed-in.html`, skipBrowserRedirect: true },
  });
  if (error || !data.url) return error?.message ?? 'Could not start Google sign-in';
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(data.url);
  return null;
}

/** Turn incoming notevra:// links into a session; also handles the link that launched the app. */
export async function listenForAuthLinks(client: SupabaseClient, onError: (message: string) => void): Promise<void> {
  const { onOpenUrl, getCurrent } = await import('@tauri-apps/plugin-deep-link');
  const handle = async (urls: string[] | null) => {
    for (const url of urls ?? []) {
      const cb = parseAuthCallback(url);
      if (!cb) continue;
      if (cb.kind === 'error') return onError(cb.message);
      // fails unless this app started the sign-in, since only it holds the code verifier
      const { error } = await client.auth.exchangeCodeForSession(cb.code);
      if (error) onError(error.message);
      else log.info('signed in from desktop link');
      return;
    }
  };
  await handle(await getCurrent().catch(() => null));
  await onOpenUrl((urls) => void handle(urls));
}
