/**
 * auth.store — who is signed in, if anyone.
 *
 * "If anyone" is the operative part. Signed-out is a **supported, permanent state**, not a lobby you
 * pass through: the app writes to IndexedDB either way, and this store exists to gate sync and
 * sharing, never editing. Every screen must render correctly with `user === null` and with
 * `configured === false`.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────────────────────────
 * **It never touches the local database.** Not on sign-in, not on sign-out. That restraint is the
 * single most important line in this file:
 *
 *   - Clearing IndexedDB on sign-out would delete a local-only user's entire library the first time
 *     they experimented with an account. Their notes were never the server's to take away.
 *   - Clearing it on sign-in would discard everything written before the account existed — the exact
 *     data they signed in hoping to keep.
 *
 * Reconciling a local library with a server one ("claiming" it) is real work with real conflict
 * cases, and it belongs to the transport phase, not here. Until then the rule is: **auth changes who
 * you are, never what is on this device.**
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isAuthConfigured, requireSupabase } from '@/core/auth/supabase';
import { friendlyAuthError } from '@/core/auth/authErrors';
import { authRedirectUrl } from '@/core/auth/siteUrl';
import { EXISTING_ACCOUNT, isExistingAccount } from '@/core/auth/existingAccount';
import { isDesktopApp, listenForAuthLinks, openGoogleInBrowser } from '@/core/auth/desktopAuthLink';
import { consumeEmailLink } from '@/core/auth/emailLink';
import { useNoticeStore } from '@/stores/notice.store';
import { logger } from '@/core/logging/logger';

// set before leaving for Google, so the return trip can say how it went
const OAUTH_FLAG = 'notevra:oauth-pending';
const googleName = (s: Session) => (s.user.user_metadata?.full_name as string | undefined) || s.user.email || '';

const log = logger.scoped('auth');

/** what an action gives back — never throws, so callers render a message instead of catching */
export interface AuthResult {
  ok: boolean;
  /** already translated for a human (core/auth/authErrors) */
  error?: string;
  /**
   * Sign-up only: the account exists but has no session yet, because the project requires email
   * confirmation. The UI has to say "check your inbox" rather than assuming it just signed you in.
   */
  needsConfirmation?: boolean;
  // sign-up only: the email already has an account, so the dialog should switch to sign in
  exists?: boolean;
}

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null);
  const user = ref<User | null>(null);
  /**
   * Has the initial session been restored yet?
   *
   * Restoring from localStorage is asynchronous, so for the first moments after boot `user` is null
   * for a signed-IN person too. Anything that would otherwise flash "Sign in" at someone who is
   * already signed in waits on this.
   */
  const ready = ref(!isAuthConfigured); // nothing to wait for when there is no server
  /**
   * The user arrived from a password-reset email. Set by the PASSWORD_RECOVERY event and cleared
   * once they set a new password — this is what makes the reset screen appear at all.
   */
  const recovering = ref(false);

  const signedIn = computed(() => !!user.value);
  /**
   * Unconfirmed users can still be signed in when the project allows it, so this is separate from
   * `signedIn` — it decides whether to nag, not whether to let them in.
   */
  const emailVerified = computed(() => !!user.value?.email_confirmed_at);
  const email = computed(() => user.value?.email ?? '');

  function adopt(next: Session | null) {
    session.value = next;
    user.value = next?.user ?? null;
  }

  /** Restore a persisted session and subscribe to changes. Safe to call when unconfigured. */
  async function init() {
    if (!supabase) return;
    try {
      const { data } = await supabase.auth.getSession();
      adopt(data.session);
    } catch (e) {
      log.warn('could not restore session', e); // a broken session must not stop the app booting
    } finally {
      ready.value = true;
    }

    reportOAuthReturn();
    if (isDesktopApp()) {
      void listenForAuthLinks(supabase, (message) => useNoticeStore().danger(friendlyAuthError(message)))
        .catch((e) => log.warn('desktop auth links unavailable', e));
    }

    supabase.auth.onAuthStateChange((event, next) => {
      // desktop: the session arrives later via setSession, not on load
      if (event === 'SIGNED_IN' && !session.value && next?.user.app_metadata?.provider === 'google') {
        useNoticeStore().info(`Signed in as ${googleName(next)}`);
      }
      adopt(next);
      // Fired when the app is opened from a reset link. The user is momentarily signed in with a
      // recovery session whose only purpose is to authorise one password change.
      if (event === 'PASSWORD_RECOVERY') recovering.value = true;
      if (event === 'SIGNED_OUT') recovering.value = false;
      log.info('auth state', { event, signedIn: !!next });
    });

    // after subscribing, so a reset link's PASSWORD_RECOVERY event is heard
    const linkError = await consumeEmailLink(supabase).catch((e: unknown) => String(e));
    if (linkError) useNoticeStore().danger(friendlyAuthError(linkError));
  }

  /** Web leaves the page for Google; desktop opens the system browser and waits for notevra://. */
  async function signInWithGoogle(): Promise<AuthResult> {
    try {
      const client = requireSupabase();
      if (isDesktopApp()) {
        const error = await openGoogleInBrowser(client);
        return error ? { ok: false, error: friendlyAuthError(error) } : { ok: true };
      }
      try { sessionStorage.setItem(OAUTH_FLAG, '1'); } catch { /* private mode: just no return notice */ }
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: authRedirectUrl() },
      });
      return error ? { ok: false, error: friendlyAuthError(error) } : { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e) };
    }
  }

  // Google sends a refusal (e.g. "Access blocked", cancelled consent) back as ?error_description=
  function reportOAuthReturn() {
    let pending = false;
    try {
      pending = sessionStorage.getItem(OAUTH_FLAG) === '1';
      sessionStorage.removeItem(OAUTH_FLAG);
    } catch { /* storage blocked */ }
    if (!pending) return;
    if (session.value) return void useNoticeStore().info(`Signed in as ${googleName(session.value)}`);
    const params = new URLSearchParams(window.location.search + '&' + window.location.hash.slice(1));
    const message = params.get('error_description') ?? params.get('error');
    if (message) useNoticeStore().danger(friendlyAuthError(message));
  }

  async function signUp(emailAddr: string, password: string, displayName = ''): Promise<AuthResult> {
    try {
      const { data, error } = await requireSupabase().auth.signUp({
        email: emailAddr.trim(),
        password,
        // where the confirmation link comes back to — see core/auth/siteUrl for why this is not
        // simply the current origin, and for the allow-list entry it has to be paired with
        // `data.display_name` is read by the handle_new_user() trigger, which owns the profile row
        options: { emailRedirectTo: authRedirectUrl(), data: { display_name: displayName.trim() } },
      });
      if (isExistingAccount(data?.user, error)) return { ok: false, exists: true, error: EXISTING_ACCOUNT };
      if (error) return { ok: false, error: friendlyAuthError(error) };
      // No session means the project has email confirmation on: the account exists, but they are
      // not signed in until they click the link.
      return { ok: true, needsConfirmation: !data.session };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e) };
    }
  }

  async function signIn(emailAddr: string, password: string): Promise<AuthResult> {
    try {
      const { error } = await requireSupabase().auth.signInWithPassword({
        email: emailAddr.trim(),
        password,
      });
      return error ? { ok: false, error: friendlyAuthError(error) } : { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e) };
    }
  }

  /** Sign out. Local notes are untouched — see the note at the top of this file. */
  async function signOut(): Promise<AuthResult> {
    try {
      const { error } = await requireSupabase().auth.signOut();
      return error ? { ok: false, error: friendlyAuthError(error) } : { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e) };
    }
  }

  /**
   * Send a reset link.
   *
   * Always reports success, even for an address with no account. Saying "no account with that email"
   * would turn this form into a way to test whether someone has an account here, which is the same
   * enumeration leak `authErrors` avoids on the sign-in form.
   */
  async function sendPasswordReset(emailAddr: string): Promise<AuthResult> {
    try {
      const { error } = await requireSupabase().auth.resetPasswordForEmail(emailAddr.trim(), {
        redirectTo: authRedirectUrl(),
      });
      // a rate-limit message is worth showing; anything else is swallowed on purpose
      if (error && /rate limit|security purposes/i.test(error.message)) {
        return { ok: false, error: friendlyAuthError(error) };
      }
      if (error) log.warn('reset request failed, reported to the user as success', error);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e) };
    }
  }

  /** Set a new password, using the recovery session the email link established. */
  async function updatePassword(password: string): Promise<AuthResult> {
    try {
      const { error } = await requireSupabase().auth.updateUser({ password });
      if (error) return { ok: false, error: friendlyAuthError(error) };
      recovering.value = false;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e) };
    }
  }

  async function resendConfirmation(emailAddr: string): Promise<AuthResult> {
    try {
      const { error } = await requireSupabase().auth.resend({
        type: 'signup',
        email: emailAddr.trim(),
        options: { emailRedirectTo: authRedirectUrl() },
      });
      return error ? { ok: false, error: friendlyAuthError(error) } : { ok: true };
    } catch (e) {
      return { ok: false, error: friendlyAuthError(e) };
    }
  }

  /** null when there is no server to ask — the caller lets an unchecked name through */
  async function isDisplayNameFree(name: string): Promise<boolean | null> {
    if (!isAuthConfigured || !supabase) return null;
    const { data, error } = await supabase.rpc('display_name_available', { name: name.trim() });
    return error ? null : !!data;
  }

  /** the nearest free name: `Milo Member` → `Milo Member 2` */
  async function suggestDisplayName(base: string): Promise<string> {
    if (!isAuthConfigured || !supabase) return base;
    const { data, error } = await supabase.rpc('suggest_display_name', { base: base.trim() });
    return error ? base : (data as string);
  }

  return {
    session, user, ready, recovering,
    signedIn, emailVerified, email,
    configured: isAuthConfigured,
    init, signInWithGoogle, signUp, signIn, signOut, sendPasswordReset, updatePassword, resendConfirmation,
    isDisplayNameFree, suggestDisplayName,
  };
});
