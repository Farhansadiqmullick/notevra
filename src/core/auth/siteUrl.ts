/**
 * Where an auth email is allowed to send someone back to.
 *
 * Every link Supabase mails out — confirm your address, reset your password — needs an absolute URL
 * to return to, and all three senders in auth.store must agree on it. This is that one answer.
 *
 * ── Why this is configured rather than derived ───────────────────────────────────────────────────
 * The obvious implementation is `window.location.origin`, and it was. It is right nearly always and
 * silently wrong in the case that matters: Supabase does not simply obey the URL it is handed. It
 * checks the value against the project's **Redirect URLs** allow-list, and when there is no match it
 * does not error — it quietly substitutes the project's **Site URL** and sends the mail anyway. A
 * default-configured project has a Site URL of `http://localhost:3000`, so a production confirmation
 * link lands the user on a dead localhost address with a real, working token in the fragment.
 *
 * Nothing in the browser can detect that happening. The request looked fine, the email arrived, and
 * the failure only shows up in the recipient's address bar.
 *
 * Reading it from the environment makes the value explicit per build, which means it can be checked
 * against the dashboard by eye instead of inferred from whatever host the page happened to load on.
 *
 * ⚠️ **This is one half of a pair.** Setting VITE_SITE_URL does nothing on its own — the same string
 * must also be listed in Supabase → Authentication → URL Configuration → Redirect URLs, or Supabase
 * will substitute the Site URL exactly as described above. Change one, change the other.
 *
 * ── Why the fallback is still the current origin ─────────────────────────────────────────────────
 * Unset, this returns `window.location.origin`, which keeps `npm run dev`, `npm run preview` and
 * Cloudflare branch previews working with no configuration at all — each on whatever host it is
 * actually being served from. That matches the rest of the project's stance that a missing `.env`
 * degrades rather than breaks. The variable exists to *pin* the value for a real deployment, not to
 * become another thing that must be set before anything works.
 */

/** Configured target, trailing slash removed — Supabase compares these as strings, so `/` matters. */
const configured = import.meta.env.VITE_SITE_URL?.trim().replace(/\/+$/, '');

/**
 * The absolute URL auth emails should return to.
 *
 * Call this rather than reading the variable directly: it is evaluated per call so that the
 * fallback reflects the origin at the time of the request, and so there is a single place to change
 * if this ever needs a path as well as an origin.
 */
export function authRedirectUrl(): string {
  return configured || window.location.origin;
}
