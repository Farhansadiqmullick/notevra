/**
 * The Supabase client — and the decision that it is allowed to be absent.
 *
 * BlocNote is offline-first, which here means something stricter than "works on a plane": **the app
 * is fully usable with no account, no server, and no Supabase configured at all.** Writing notes is
 * not a feature of being signed in. Auth buys you sync and, later, sharing — nothing else — so a
 * missing `.env` must degrade to a local-only app, never to a login wall or a crash on boot.
 *
 * That is why this exports `null` rather than throwing when the environment is empty. Every caller
 * checks `isAuthConfigured` first, and the UI says "sync isn't set up" instead of offering controls
 * that cannot work — the same rule the rest of the project follows about buttons wired to nothing.
 *
 * ── On the anon key being in the bundle ──────────────────────────────────────────────────────────
 * It is public by design, and shipping it in client JavaScript is how Supabase is meant to be used.
 * It identifies the project; it grants nothing on its own. What stops a stranger reading your notes
 * is Row Level Security (migration 0001) plus the fact that `anon` was deliberately granted no DML
 * at all — see design/local-database.md. The key that must never reach a browser is the SERVICE ROLE
 * key, which bypasses RLS; it is not read here and has no `VITE_` name anywhere in this repo.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** Is there a server to talk to? False means local-only, which is a supported way to run this app. */
export const isAuthConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isAuthConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        // the session lives in localStorage and is restored on load, so a refresh doesn't sign you out
        persistSession: true,
        autoRefreshToken: true,
        /**
         * Required for password recovery. The reset email lands the user back on the app with the
         * token in the URL, and this is what reads it and turns it into a session — without it the
         * link appears to work, drops the user on a normal page, and "set a new password" is
         * unreachable.
         */
        detectSessionInUrl: true,
        // links carry a one-time code that only this client can redeem, never the tokens themselves
        flowType: 'pkce',
      },
    })
  : null;

/**
 * The client, or a thrown error naming the actual problem.
 *
 * Callers that have already checked `isAuthConfigured` use this so the rest of the file isn't
 * written against `SupabaseClient | null`. The message is for a developer — a user should never
 * reach a code path that calls this, because the UI hides those controls entirely.
 */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and fill in ' +
        'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (npm run db:status prints both).',
    );
  }
  return supabase;
}
